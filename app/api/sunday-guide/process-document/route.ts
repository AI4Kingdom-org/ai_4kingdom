import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getPromptsInBatch, defaultPrompts } from '@/app/utils/aiPrompts';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '@/app/config/constants';
import { optimizedQuery } from '@/app/utils/dynamodbHelpers';
import { splitDocumentIfNeeded, createMultiThreadProcessor } from '@/app/utils/documentProcessor';

const SUNDAY_GUIDE_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
const PROGRESS_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_PROGRESS || 'SundayGuideProgress';
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 進度更新：若表不存在則僅記一次警告並停用後續寫入
let progressTableUnavailable = false;
async function updateProgress(docClient: any, {
  vectorStoreId,
  fileName,
  stage,
  status = 'processing',
  progress = 0,
  error
}: { vectorStoreId: string; fileName: string; stage: string; status?: string; progress?: number; error?: string }) {
  if (progressTableUnavailable) return; // 已標記不可用，直接返回
  try {
    await docClient.send(new PutCommand({
      TableName: PROGRESS_TABLE,
      Item: {
        id: `${vectorStoreId}#${fileName}#${stage}`,
        vectorStoreId,
        fileName,
        stage,
        status,
        progress,
        error: error || null,
        updatedAt: new Date().toISOString()
      }
    }));
    // 僅在成功時輸出 debug
    console.log('[DEBUG] 已更新進度表', { stage, status, progress });
  } catch (e: any) {
    if (e?.name === 'ResourceNotFoundException' || e?.__type?.includes('ResourceNotFound')) {
      progressTableUnavailable = true;
      console.warn('[WARN] 進度表不存在，停用後續進度寫入 (僅顯示一次)。建議建立 DynamoDB 表:', PROGRESS_TABLE);
    } else {
      console.warn('[WARN] 寫入進度表失敗（將繼續重試下次階段）', e);
    }
  }
}

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
  // 由於 Agape 現在使用相同的 assistant/vector store，通過其他方式判斷
  // 可以通過 userId 或在請求中添加 unitId 參數來識別
  const isAgape = false; // 暫時停用 Agape 特殊處理，統一使用 3 次重試
  const docClient = await createDynamoDBClient();
  let attemptMetaUpdated = false;

  // 等待向量庫索引完成
  async function waitForVectorStoreReady(vsId: string, timeoutMs = 120000, pollMs = 1000) {
    const start = Date.now();
    let attempt = 0;
    while (Date.now() - start < timeoutMs) {
      attempt++;
      try {
        const list = await openai.beta.vectorStores.files.list(vsId, { limit: 50 });
        const statuses = list.data.map(f => ({ id: f.id, status: f.status }));
        const allReady = list.data.length > 0 && list.data.every(f => f.status === 'completed');
        console.log(`[DEBUG] 向量庫索引檢查 (${attempt})`, statuses);
        if (allReady) return true;
      } catch (err) {
        console.warn('[WARN] 檢查向量庫索引狀態失敗', err);
      }
      await new Promise(r => setTimeout(r, pollMs));
    }
    console.warn('[WARN] 等待向量庫索引超時，將繼續處理（可能導致助手初次無法讀取內容）');
    return false;
  }
  
  try {
    // 不再更新進度狀態，只記錄日誌
    console.log(`[DEBUG] 開始處理文件: ${fileName}`);
    
  // 先等待向量庫完成索引（盡最大努力）
  await waitForVectorStoreReady(vectorStoreId);

  // 移除初始化暖機 run 與初始訊息，改由各內容類型任務自行建立 thread

    // 標記開始 processing（只嘗試一次）
    if (!attemptMetaUpdated) {
      try {
        // 找到對應記錄（可能多筆，取最新）
        const existing = await optimizedQuery({
          tableName: SUNDAY_GUIDE_TABLE,
          keyCondition: {},
          filterExpression: 'fileId = :fid',
          expressionAttributeValues: { ':fid': fileId || vectorStoreId }
        });
        if (existing.Items && existing.Items.length) {
          const latest = existing.Items.sort((a,b)=> new Date(b.Timestamp||'').getTime()-new Date(a.Timestamp||'').getTime())[0];
          await docClient.send(new UpdateCommand({
            TableName: SUNDAY_GUIDE_TABLE,
            Key: { assistantId: latest.assistantId, Timestamp: latest.Timestamp },
            UpdateExpression: 'SET generationStatus = :gs, attemptCount = if_not_exists(attemptCount, :zero) + :one, updatedAt = :now',
            ExpressionAttributeValues: { ':gs':'processing', ':one':1, ':zero':0, ':now': new Date().toISOString() }
          }));
          attemptMetaUpdated = true;
        }
      } catch (e) { console.warn('[WARN] 更新 generationStatus=processing 失敗', e); }
    }

  // 初始化進度（開始產生）
  await updateProgress(docClient, { vectorStoreId, fileName, stage: 'summary', progress: 10 });
    // 從 AIPrompts 資料表中獲取 prompts
    console.log('[DEBUG] 從 AIPrompts 資料表獲取 prompts');
    const AI_PROMPTS_TABLE = process.env.NEXT_PUBLIC_AI_PROMPTS_TABLE || 'AIPrompts';
    const promptsToFetch = ['summary', 'devotional', 'bibleStudy'];
    
    console.log('[DEBUG] 正在批量獲取 prompts...', { table: AI_PROMPTS_TABLE, prompts: promptsToFetch });
    const promptsFromDB = await getPromptsInBatch(promptsToFetch, AI_PROMPTS_TABLE);
    
    // 詳細驗證獲取的 prompts
    console.log('[DEBUG] 獲取 prompts 結果驗證:', {
      summary: { 
        length: promptsFromDB.summary?.length || 0, 
        preview: promptsFromDB.summary?.substring(0, 50) + '...',
        hasContent: !!promptsFromDB.summary && promptsFromDB.summary.length > 20
      },
      devotional: { 
        length: promptsFromDB.devotional?.length || 0, 
        preview: promptsFromDB.devotional?.substring(0, 50) + '...',
        hasContent: !!promptsFromDB.devotional && promptsFromDB.devotional.length > 20
      },
      bibleStudy: { 
        length: promptsFromDB.bibleStudy?.length || 0, 
        preview: promptsFromDB.bibleStudy?.substring(0, 50) + '...',
        hasContent: !!promptsFromDB.bibleStudy && promptsFromDB.bibleStudy.length > 20
      }
    });    // 準備處理的內容類型，並確保每個類型都有對應的提示詞
    const contentTypes = [
      { type: 'summary', prompt: promptsFromDB.summary || defaultPrompts.summary },
      // { type: 'fullText', prompt: '請完整保留原文內容，並加入適當的段落分隔。不要省略任何內容。' }, // Disabled fullText processing
      { type: 'devotional', prompt: promptsFromDB.devotional || defaultPrompts.devotional },
      { type: 'bibleStudy', prompt: promptsFromDB.bibleStudy || defaultPrompts.bibleStudy }
    ];
    
    // 最終驗證使用的 prompts
    console.log('[DEBUG] 最終使用的 prompts 驗證:');
    contentTypes.forEach(({ type, prompt }) => {
      const isUsingDefault = prompt === defaultPrompts[type];
      const isValid = prompt && prompt.length > 20 && !prompt.includes('無法直接訪問文件');
      console.log(`[DEBUG] ${type}: 長度=${prompt.length}, 使用默認=${isUsingDefault}, 有效=${isValid}, 預覽=${prompt.substring(0, 40)}...`);
      
      if (!isValid) {
        console.warn(`[WARN] ${type} prompt 可能無效，將使用 defaultPrompts`);
      }
    });
    
  const results: Record<string, string> = {};

  // 單一內容類型處理函式（保留重試機制）
  async function processContentType({ type, prompt }: { type: string, prompt: string }) {
      console.log(`[DEBUG] 並行處理 ${type} 內容開始...`);
      
      const failurePhrases = ['無法直接訪問', '无法直接访问', '我無法直接訪問', '請提供', '無法讀取'];
  const maxRuns = isAgape ? 5 : 3;
      for (let attempt = 1; attempt <= maxRuns; attempt++) {
        // 建立新執行緒
        const typeThread = await openai.beta.threads.create();
        console.log(`[DEBUG] 為 ${type} 建立執行緒 ID: ${typeThread.id} (嘗試 ${attempt}/${maxRuns})`);

        await openai.beta.threads.messages.create(typeThread.id, {
          role: 'user',
          content: `請幫我分析文件 "${fileName}"。我需要基於此文件提供${type}內容。`
        });
        await openai.beta.threads.messages.create(typeThread.id, {
          role: 'user',
          content: prompt
        });

        // 針對不同內容類型的 token 分配設定
        const tokenConfig = {
          summary: 6000,      // 總結：適中長度
          devotional: 8000,   // 靈修：最詳細，需要5天分量
          bibleStudy: 6000    // 查經：包含遊戲、詩歌、見證等
        };

        const run = await (openai.beta.threads.runs.create as any)(
          typeThread.id,
          {
            assistant_id: assistantId,
            // 在 run 級別綁定 vector store，避免修改 assistant 本體
            tool_resources: { file_search: { vector_store_ids: [vectorStoreId] } },
            // 使用對應類型的 token 配置
            max_completion_tokens: tokenConfig[type as keyof typeof tokenConfig] || 3000,
            max_prompt_tokens: 20000,
            temperature: 0.1  // 極低隨機性，確保基於文檔內容
          } as any
        );

        // 輪詢狀態
        let runStatus = await openai.beta.threads.runs.retrieve(typeThread.id, run.id);
        let poll = 0;
        let pollDelay = 1000;
        while ((runStatus.status === 'queued' || runStatus.status === 'in_progress') && poll < 60) {
          await new Promise(r => setTimeout(r, pollDelay));
          runStatus = await openai.beta.threads.runs.retrieve(typeThread.id, run.id);
          poll++;
          pollDelay = Math.min(pollDelay * 1.5, 10000);
        }
        if (runStatus.status !== 'completed') {
          console.warn(`[WARN] ${type} 執行未完成狀態=${runStatus.status}；嘗試 ${attempt}`);
          if (attempt === maxRuns) throw new Error(`處理 ${type} 內容失敗: ${runStatus.status}`);
          // 輕量回退後重試
          await new Promise(r => setTimeout(r, 600));
          continue;
        }

        const messages = await openai.beta.threads.messages.list(typeThread.id, { limit: 1 });
        const lastMessage = messages.data[0];
        const content = lastMessage.content
          .filter(c => c.type === 'text')
          .map(c => (c.type === 'text' ? c.text.value : ''))
          .join('\n');

        const invalid = failurePhrases.some(p => content.includes(p)) || content.trim().length < 50;
        console.log(`[DEBUG] ${type} 嘗試 ${attempt} 完成，長度=${content.length}，invalid=${invalid}`);
        if (invalid && attempt < maxRuns) {
          await waitForVectorStoreReady(vectorStoreId, 15000, 3000); // 再等一次索引
          continue; // retry
        }
        return { type, content };
      }
      throw new Error(`處理 ${type} 內容最終失敗`);
    }
    
    // 改為並行處理三個內容類型
    console.log(`[DEBUG] 開始並行處理 ${contentTypes.length} 種內容類型`);
    const settled = await Promise.allSettled(
      contentTypes.map(({ type, prompt }) => processContentType({ type, prompt }))
    );
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        results[s.value.type] = s.value.content;
      } else {
        console.warn('[WARN] 子任務失敗:', s.reason);
      }
    }
    console.log(`[DEBUG] 並行處理完成`);

    // 獲取處理結束時間並計算總處理時間（毫秒）
    const processingEndTime = Date.now();
    const serverProcessingTime = processingEndTime - processingStartTime;
    
    console.log(`[DEBUG] 文件處理完成，總耗時: ${serverProcessingTime / 1000} 秒`);    // 查詢是否已存在檔案記錄
    console.log('[DEBUG] 查詢是否已存在檔案記錄');
  // docClient 已於函數頂部建立
    
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
        UpdateExpression: "SET summary = :summary, devotional = :devotional, bibleStudy = :bibleStudy, processingTime = :processingTime, completed = :completed, generationStatus = :gs, updatedAt = :now",
        ExpressionAttributeValues: {
          ":summary": results.summary,
          ":devotional": results.devotional,
          ":bibleStudy": results.bibleStudy,
          ":processingTime": serverProcessingTime,
          ":completed": true,
          ":gs": 'completed',
          ":now": new Date().toISOString()
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
          completed: true,
          generationStatus: 'completed',
          attemptCount: 1,
          Timestamp: new Date().toISOString()
        }
      }));
    }
  // 最終標記完成進度
  await updateProgress(docClient, { vectorStoreId, fileName, stage: 'bibleStudy', status: 'completed', progress: 100 });
    
    console.log('[DEBUG] 處理完成，結果已保存');
    return true;
  } catch (error) {
    console.error('[ERROR] 非同步處理失敗:', error);
    try {
      const existing = await optimizedQuery({
        tableName: SUNDAY_GUIDE_TABLE,
        keyCondition: {},
        filterExpression: 'fileId = :fid',
        expressionAttributeValues: { ':fid': fileId || vectorStoreId }
      });
      if (existing.Items && existing.Items.length) {
        const latest = existing.Items.sort((a,b)=> new Date(b.Timestamp||'').getTime()-new Date(a.Timestamp||'').getTime())[0];
        await docClient.send(new UpdateCommand({
          TableName: SUNDAY_GUIDE_TABLE,
          Key: { assistantId: latest.assistantId, Timestamp: latest.Timestamp },
            UpdateExpression: 'SET generationStatus = :gs, lastError = :err, updatedAt = :now, attemptCount = if_not_exists(attemptCount,:zero) + :one',
            ExpressionAttributeValues: { ':gs':'failed', ':err': (error instanceof Error ? error.message : '未知錯誤'), ':now': new Date().toISOString(), ':one':1, ':zero':0 }
        }));
      }
      await updateProgress(docClient, { vectorStoreId, fileName, stage: 'error', status: 'failed', progress: 100, error: (error instanceof Error ? error.message : '未知錯誤') });
    } catch (e) { console.warn('[WARN] 記錄失敗狀態時出錯', e); }
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
    
  // 移除對 Assistant 的檢索與綁定更新；改用 run 級 tool_resources 綁定（見上方 processContentType）
  console.log('[DEBUG] 將在 run 級別綁定向量庫，略過 Assistant 綁定往返');

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