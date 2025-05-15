import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getPromptsInBatch, defaultPrompts } from '@/app/utils/aiPrompts';
import { optimizedQuery } from '@/app/utils/dynamodbHelpers';
import { splitDocumentIfNeeded, createMultiThreadProcessor } from '@/app/utils/documentProcessor';

const SUNDAY_GUIDE_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 移除 updateProgress 函數，不再需要進度表

// 非同步處理文件內容
async function processDocumentAsync(params: {
  assistantId: string;
  vectorStoreId: string;
  fileName: string;
  fileId?: string;
  userId?: string;
  threadId?: string; // 新增參數，允許傳入自定義線程ID
}) {
  const { assistantId, vectorStoreId, fileName, fileId, userId, threadId } = params;
  const effectiveUserId = userId ? String(userId) : 'unknown';
  const processingStartTime = Date.now();
  
  try {
    // 不再更新進度狀態，只記錄日誌
    console.log(`[DEBUG] 開始處理文件: ${fileName}`);
    
    // 創建一個新的線程，或使用提供的線程
    const thread = threadId ? { id: threadId } : await openai.beta.threads.create();
    console.log(`[DEBUG] 使用線程 ID: ${thread.id}`);
    
    // 發送一個初始消息，提供文件名信息
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: `請幫我分析文件 "${fileName}"。我需要獲取文件內容的摘要、全文、靈修指引和查經指引。`
    });
    console.log('[DEBUG] 初始消息已發送到線程');

    // 執行助手，使用明確的指示
    const initialRun = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
      instructions: `請使用文件搜索工具查詢並分析文件 "${fileName}"。你可以從vector store中獲取文件內容。請基於文件內容進行分析。如果找不到任何文件，請明確告知。`
    });
    
    // 等待初始處理完成
    let initialRunStatus = await openai.beta.threads.runs.retrieve(thread.id, initialRun.id);
    console.log(`[DEBUG] 初始處理狀態: ${initialRunStatus.status}`);
    
    while (initialRunStatus.status === 'queued' || initialRunStatus.status === 'in_progress') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      initialRunStatus = await openai.beta.threads.runs.retrieve(thread.id, initialRun.id);
      console.log(`[DEBUG] 初始處理狀態更新: ${initialRunStatus.status}`);
    }
    
    if (initialRunStatus.status !== 'completed') {
      throw new Error(`初始處理失敗: ${initialRunStatus.status}`);
    }
    
    // 获取初步回应，检查是否能访问文件
    const initialMessages = await openai.beta.threads.messages.list(thread.id);
    const initialResponse = initialMessages.data[0].content
      .filter(content => content.type === 'text')
      .map(content => (content.type === 'text' ? content.text.value : ''))
      .join('\n');
    
    console.log(`[DEBUG] 初始回應: ${initialResponse.substring(0, 200)}...`);
    
    // 检查响应中是否包含无法找到文件的信息
    if (initialResponse.includes('找不到文件') || 
        initialResponse.includes('无法访问') || 
        initialResponse.includes('没有找到') ||
        initialResponse.includes('不存在')) {
      console.error('[ERROR] 助手无法访问文件');
      throw new Error('助手无法访问上传的文件，请确保文件已正确上传并与助手关联');    }
    
    console.log('[DEBUG] 初始處理完成，助手可以访问文件，开始處理不同內容類型');
    // 從 AIPrompts 資料表中獲取 prompts
    console.log('[DEBUG] 從 AIPrompts 資料表獲取 prompts');
    const AI_PROMPTS_TABLE = process.env.NEXT_PUBLIC_AI_PROMPTS_TABLE || 'AIPrompts';
    const promptsToFetch = ['summary', 'devotional', 'bibleStudy'];
    
    // 使用批處理和快取方式獲取 prompts
    console.log('[DEBUG] 使用優化的方式獲取所有 prompts');
    const promptsFromDB = await getPromptsInBatch(promptsToFetch, AI_PROMPTS_TABLE);
    
    // 準備處理的內容類型，並確保每個類型都有對應的提示詞
    const contentTypes = [
      { type: 'summary', prompt: promptsFromDB.summary || defaultPrompts.summary },
      // { type: 'fullText', prompt: '請完整保留原文內容，並加入適當的段落分隔。不要省略任何內容。' }, // Disabled fullText processing
      { type: 'devotional', prompt: promptsFromDB.devotional || defaultPrompts.devotional },
      { type: 'bibleStudy', prompt: promptsFromDB.bibleStudy || defaultPrompts.bibleStudy }
    ];
    
    const results: Record<string, string> = {};
    
    // 建立並行處理函數
    async function processContentType({ type, prompt }: { type: string, prompt: string }) {
      console.log(`[DEBUG] 並行處理 ${type} 內容開始...`);
      
      // 建立新執行緒，避免共用執行緒導致的干擾
      const typeThread = await openai.beta.threads.create();
      console.log(`[DEBUG] 為 ${type} 建立執行緒 ID: ${typeThread.id}`);
      
      // 發送初始訊息提供文件名信息
      await openai.beta.threads.messages.create(typeThread.id, {
        role: 'user',
        content: `請幫我分析文件 "${fileName}"。我需要基於此文件提供${type}內容。`
      });
      
      // 發送用戶消息
      await openai.beta.threads.messages.create(typeThread.id, {
        role: 'user',
        content: prompt
      });

      // 執行助手
      const run = await openai.beta.threads.runs.create(typeThread.id, {
        assistant_id: assistantId,
        instructions: `請基於文件 "${fileName}" 的內容回應用戶的請求。使用文件搜索工具確保你能訪問到文件的完整內容。${prompt}`
      });

      // 等待處理完成，使用改進的輪詢間隔
      let runStatus = await openai.beta.threads.runs.retrieve(typeThread.id, run.id);
      console.log(`[DEBUG] ${type} 處理狀態: ${runStatus.status}`);
      
      let attempts = 0;
      const maxAttempts = 60; // 最多等待60次
      
      // 使用自適應輪詢間隔 (方案2實現部分)
      let pollInterval = 1000; // 初始為1秒
      const maxPollInterval = 10000; // 最大間隔為10秒
      
      while ((runStatus.status === 'queued' || runStatus.status === 'in_progress') && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        runStatus = await openai.beta.threads.runs.retrieve(typeThread.id, run.id);
        console.log(`[DEBUG] ${type} 處理狀態更新: ${runStatus.status} (尝试 ${++attempts}/${maxAttempts})`);
        
        // 逐漸增加間隔時間，但不超過最大值
        pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);
      }

      if (runStatus.status !== 'completed') {
        throw new Error(`處理 ${type} 內容失敗: ${runStatus.status}`);
      }

      // 獲取助手回覆
      const messages = await openai.beta.threads.messages.list(typeThread.id);
      const lastMessage = messages.data[0];
      const content = lastMessage.content
        .filter(content => content.type === 'text')
        .map(content => (content.type === 'text' ? content.text.value : ''))
        .join('\n');

      console.log(`[DEBUG] ${type} 內容處理完成, 長度: ${content.length} 字元`);
      return { type, content };
    }
    
    // 並行處理所有內容類型
    console.log(`[DEBUG] 開始並行處理 ${contentTypes.length} 種內容類型`);
    const contentPromises = contentTypes.map(processContentType);
    
    // 等待所有處理完成
    const contentResults = await Promise.all(contentPromises);
    
    // 將結果整合到一個對象中
    contentResults.forEach(({ type, content }) => {
      results[type] = content;
    });
    
    console.log(`[DEBUG] 所有內容類型並行處理完成`);

    // 獲取處理結束時間並計算總處理時間（毫秒）
    const processingEndTime = Date.now();
    const serverProcessingTime = processingEndTime - processingStartTime;
    
    console.log(`[DEBUG] 文件處理完成，總耗時: ${serverProcessingTime / 1000} 秒`);    // 查詢是否已存在檔案記錄
    console.log('[DEBUG] 查詢是否已存在檔案記錄');
    const docClient = await createDynamoDBClient();
    
    // 使用優化的查詢
    const existingRecords = await optimizedQuery({
      tableName: SUNDAY_GUIDE_TABLE,
      keyCondition: {},
      filterExpression: "fileId = :fileId",
      expressionAttributeValues: {
        ":fileId": fileId || vectorStoreId
      }
    });
    
    if (existingRecords.Items && existingRecords.Items.length > 0) {
      // 找到現有記錄，進行更新
      console.log(`[DEBUG] 找到 ${existingRecords.Items.length} 條既有記錄，更新處理結果`);
      const existingItem = existingRecords.Items[0]; // 使用第一條記錄
      
      await docClient.send(new UpdateCommand({
        TableName: SUNDAY_GUIDE_TABLE,
        Key: {
          assistantId: existingItem.assistantId,
          Timestamp: existingItem.Timestamp
        },
        UpdateExpression: "SET summary = :summary, devotional = :devotional, bibleStudy = :bibleStudy, processingTime = :processingTime, completed = :completed",
        ExpressionAttributeValues: {
          ":summary": results.summary,
          ":devotional": results.devotional,
          ":bibleStudy": results.bibleStudy,
          ":processingTime": serverProcessingTime,
          ":completed": true
        }
      }));
      console.log(`[DEBUG] 成功更新現有記錄`);
    } else {
      // 沒找到現有記錄，創建新記錄
      console.log('[DEBUG] 未找到現有記錄，創建新記錄');
      await docClient.send(new PutCommand({
        TableName: SUNDAY_GUIDE_TABLE,
        Item: {
          assistantId,
          vectorStoreId,
          fileName,
          fileId: fileId || vectorStoreId,
          userId: effectiveUserId, // 強制寫入有效 userId
          summary: results.summary,
          // fullText: results.fullText, // Disabled fullText saving
          devotional: results.devotional,
          bibleStudy: results.bibleStudy,
          processingTime: serverProcessingTime,
          completed: true, // 標記完成狀態
          Timestamp: new Date().toISOString()
        }
      }));
    }
    
    console.log('[DEBUG] 處理完成，結果已保存');
    return true;
  } catch (error) {
    console.error('[ERROR] 非同步處理失敗:', error);
    // 記錄錯誤但不更新進度表
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const { assistantId, vectorStoreId, fileName, userId } = await request.json();
    
    console.log('[DEBUG] 處理文件請求:', { assistantId, vectorStoreId, fileName });
    
    if (!assistantId || !vectorStoreId || !fileName) {
      return NextResponse.json(
        { error: '缺少必要參數', details: { assistantId, vectorStoreId, fileName } },
        { status: 400 }
      );
    }
    
    // 獲取助手信息
    const assistant = await openai.beta.assistants.retrieve(assistantId);
    console.log(`[DEBUG] 助手信息:`, {
      名稱: assistant.name,
      模型: assistant.model,
      工具: assistant.tools?.map(t => t.type)
    });

    // 查看当前助手的 vector store 绑定情况
    if (assistant.tool_resources?.file_search?.vector_store_ids) {
      console.log(`[DEBUG] 助手已绑定的 Vector Store:`, 
        assistant.tool_resources.file_search.vector_store_ids);
      
      // 检查是否需要更新绑定
      if (!assistant.tool_resources.file_search.vector_store_ids.includes(vectorStoreId)) {
        console.log(`[DEBUG] 更新助手的 Vector Store 绑定`);
        await openai.beta.assistants.update(
          assistantId,
          {
            tools: [{ type: "file_search" }],
            tool_resources: {
              file_search: {
                vector_store_ids: [vectorStoreId]
              }
            }
          }
        );
        console.log(`[DEBUG] Vector Store 绑定更新成功`);
      }
    } else {
      console.log(`[DEBUG] 助手未绑定 Vector Store，进行绑定`);
      await openai.beta.assistants.update(
        assistantId,
        {
          tools: [{ type: "file_search" }],
          tool_resources: {
            file_search: {
              vector_store_ids: [vectorStoreId]
            }
          }
        }
      );
      console.log(`[DEBUG] Vector Store 绑定成功`);
    }

    // 獲取文件ID - 從數據庫獲取
    console.log('[DEBUG] 查詢數據庫獲取fileId');
    let fileId = null;
    try {
      // 使用優化的查詢
      const result = await optimizedQuery({
        tableName: SUNDAY_GUIDE_TABLE,
        keyCondition: {},
        filterExpression: "vectorStoreId = :vectorStoreId",
        expressionAttributeValues: {
          ":vectorStoreId": vectorStoreId
        }
      });
      
      if (result.Items && result.Items.length > 0) {
        // 找到最新的記錄
        const latestItem = result.Items.sort((a, b) => 
          new Date(b.Timestamp || "").getTime() - new Date(a.Timestamp || "").getTime()
        )[0];
        fileId = latestItem.fileId;
        console.log(`[DEBUG] 從數據庫找到文件 ID: ${fileId}`);
      }
    } catch (dbError) {
      console.error('[ERROR] 數據庫查詢失敗:', dbError);
    }

    // 检查 Vector Store 中的文件
    try {
      const filesInVectorStore = await openai.beta.vectorStores.files.list(vectorStoreId);
      console.log(`[DEBUG] Vector Store 中的文件:`, 
        filesInVectorStore.data.map(f => ({ id: f.id, status: f.status })));
      
      // 如果数据库中没有找到fileId，但Vector Store中有文件，使用第一个文件
      if (!fileId && filesInVectorStore.data.length > 0) {
        fileId = filesInVectorStore.data[0].id;
        console.log(`[DEBUG] 从 Vector Store 获取文件 ID: ${fileId}`);
      }
    } catch (vectorStoreError) {
      console.error('[ERROR] 获取 Vector Store 文件失败:', vectorStoreError);
    }
    
    // 生成一個任務ID
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    
    // 使用setTimeout確保API立即返回，不阻塞請求
    setTimeout(async () => {
      try {
        // 直接使用優化的非同步處理
        console.log('[DEBUG] 開始處理文件');
        await processDocumentAsync({
          assistantId,
          vectorStoreId,
          fileName,
          fileId,
          userId
        });
        console.log('[DEBUG] 文件處理完成');
      } catch (err) {
        console.error('[ERROR] 非同步處理出錯:', err);
      }
    }, 100);

    // 立即返回成功訊息，不返回任務ID
    return NextResponse.json({
      success: true,
      message: '文件處理已啟動，請稍後檢查結果'
    });

  } catch (error) {
    console.error('[ERROR] 文件處理失敗:', error);
    return NextResponse.json(
      { error: '文件處理失敗', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}