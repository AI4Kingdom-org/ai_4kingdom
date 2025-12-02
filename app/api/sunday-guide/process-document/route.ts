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

// 新增：等待特定檔案在向量庫中就緒
async function waitForFileReady(openaiClient: OpenAI, vectorStoreId: string, fileId: string, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      // 檢查特定檔案的狀態
      // 注意：vectorStores.files.retrieve 可能不支援，需用 list 過濾或直接 retrieve
      // OpenAI Node SDK 支援 retrieve: client.beta.vectorStores.files.retrieve(vsId, fileId)
      const file = await openaiClient.beta.vectorStores.files.retrieve(vectorStoreId, fileId);
      if (file.status === 'completed') {
        console.log(`[DEBUG] 檔案 ${fileId} 在向量庫 ${vectorStoreId} 中索引完成`);
        return true;
      } else if (file.status === 'failed') {
        console.error(`[ERROR] 檔案 ${fileId} 在向量庫 ${vectorStoreId} 中索引失敗: ${file.last_error?.message}`);
        return false;
      }
    } catch (e) {
      // 忽略暫時性錯誤
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  console.warn(`[WARN] 等待檔案 ${fileId} 索引超時`);
  return false;
}

// 修改：準備向量庫（統一處理，包含等待索引）
async function prepareEffectiveVectorStore(openaiClient: OpenAI, vectorStoreId: string, fileId?: string) {
  let effectiveVectorStoreId = vectorStoreId;
  let cleanup: (() => Promise<void>) | undefined;

  try {
    // 1. 檢查原始向量庫
    const list = await openaiClient.beta.vectorStores.files.list(vectorStoreId);
    const files = list.data || [];
    
    // 如果原始庫只有一個檔案，且就是我們要的（或沒指定 fileId），直接用原始庫
    // 但仍需確保該檔案已索引完成
    if (files.length <= 1) {
      if (files.length === 1) {
        const fId = files[0].id;
        // 如果指定了 fileId 且不匹配，則需要臨時庫（這種情況少見，除非 vectorStoreId 錯了）
        if (fileId && fId !== fileId) {
           // mismatch, fall through to create temp
        } else {
           // Wait for this file to be ready
           await waitForFileReady(openaiClient, vectorStoreId, fId);
           return { effectiveVectorStoreId, cleanup };
        }
      } else {
        // 0 files, nothing to wait for, but also nothing to search. 
        return { effectiveVectorStoreId, cleanup };
      }
    }

    // 2. 需要建立臨時向量庫的情況 (多檔混雜 或 指定了特定 fileId 但原始庫不純)
    if (fileId) {
      console.log(`[INFO] 建立臨時向量庫以隔離檔案 ${fileId}`);
      const temp = await openaiClient.beta.vectorStores.create({ name: `tmp_single_${Date.now()}` });
      
      // 加入檔案
      await openaiClient.beta.vectorStores.files.create(temp.id, { file_id: fileId });
      
      effectiveVectorStoreId = temp.id;
      cleanup = async () => {
        try { 
          console.log(`[DEBUG] 清理臨時向量庫 ${temp.id}`);
          await openaiClient.beta.vectorStores.del(temp.id); 
        } catch (e) {
          console.warn('[WARN] 清理臨時向量庫失敗', e);
        }
      };

      // 關鍵修正：等待索引完成！
      await waitForFileReady(openaiClient, effectiveVectorStoreId, fileId);
    } else {
      console.warn('[WARN] 多檔向量庫但缺少 fileId，無法建立臨時向量庫，可能導致檢索干擾');
    }
  } catch (e) {
    console.warn('[WARN] prepareEffectiveVectorStore 失敗，將沿用原向量庫', e);
  }
  return { effectiveVectorStoreId, cleanup };
}

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

  // 1. 統一準備向量庫資源
  console.log(`[DEBUG] 開始準備向量庫資源...`);
  const { effectiveVectorStoreId, cleanup } = await prepareEffectiveVectorStore(openai, vectorStoreId, fileId);
  console.log(`[DEBUG] 向量庫資源準備完成，使用 ID: ${effectiveVectorStoreId}`);
  
  try {
    // 不再更新進度狀態，只記錄日誌
    console.log(`[DEBUG] 開始處理文件: ${fileName}`);
    
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

  // 單一內容類型處理函式（保留重試機制），支援注入 summary 文字以供後續內容優先引用經文
  async function processContentType({ type, prompt, summaryText }: { type: string, prompt: string, summaryText?: string }) {
      console.log(`[DEBUG] 並行處理 ${type} 內容開始...`);
      
      const failurePhrases = ['無法直接訪問', '无法直接访问', '我無法直接訪問', '請提供', '無法讀取', '[MISSING]', '無法從您上傳的文件中檢索到'];
      const maxRuns = isAgape ? 5 : 3;

      for (let attempt = 1; attempt <= maxRuns; attempt++) {
        // 建立新執行緒
        const typeThread = await openai.beta.threads.create();
        console.log(`[DEBUG] 為 ${type} 建立執行緒 ID: ${typeThread.id} (嘗試 ${attempt}/${maxRuns})`);

        // 若已有 summary，且本次為 devotional 或 bibleStudy，則將 summary 注入並強調經文優先規則與標籤
        if (type !== 'summary' && summaryText) {
          await openai.beta.threads.messages.create(typeThread.id, {
            role: 'user',
            content: `Here is the sermon summary already generated:\n---\n${summaryText}\n---\n\nWhen selecting and quoting Bible verses for this ${type}, you MUST:\n1) FIRST prioritize verses already identified in the summary and label them [From Summary];\n2) SECOND use verses directly present in the sermon file and label them [In Sermon];\n3) ONLY THEN, if fewer than required, add supplemental verses labeled [Supplemental: reason] with a short justification.\n\nAlways paste the exact verse text (CUV for Chinese; NIV for English). Avoid duplication unless the sermon itself repeats the verse.`
          });
        }

        // 主要 prompt - 確保格式要求清晰
        await openai.beta.threads.messages.create(typeThread.id, {
          role: 'user',
          content: `請基於文件 "${fileName}" 的內容執行以下任務：

${prompt}

特別注意：
${type === 'devotional' ? 
  `- 必須提供完整的7天靈修指南（週一到週日）
  - 每天必須包含：a) 該部分講道總結, b) 3節經文（含完整經文內容）, c) 禱告指導
  - 每天內容至少400-500字，總計3000+字
  - 內容要像資深牧者的親切指導，豐富詳細` :
  
  type === 'bibleStudy' ? 
  `- 必須包含以下完整結構：
    1. 背景（講道總結）
    2. 三個重要點
    3. 3-5節聖經經文（含完整經文內容）
    4. 討論問題（3個）
    5. 應用問題（1-2個）
    6. 禱告時間建議
    7. 破冰遊戲（推薦一個簡短遊戲）
    8. 敬拜詩歌（3首推薦，來自讚美之泉、小羊詩歌、迦南詩選或泥土音樂）
    9. 見證分享（100-200字）
  - 總內容至少2000-2500字，要像經驗豐富的小組長的完整預備` :
  
  `- 提供詳細完整的內容，至少1500-2000字
  - 包含所有重點、細節、例證和應用`
}

請確保內容結構清晰、格式完整，就像專業的教會資源一樣。`
        });

        // 針對不同內容類型的 token 分配設定 - 大幅增加以獲得豐富內容
        const tokenConfig = {
          summary: 50000,      // 總結：大幅增加詳細度
          devotional: 60000,   // 靈修：最大化7天豐富分量
          bibleStudy: 55000    // 查經：包含遊戲、詩歌、見證等完整內容
        };

        const run = await (openai.beta.threads.runs.create as any)(
          typeThread.id,
          {
            assistant_id: assistantId,
            // 在 run 級別綁定 vector store，避免修改 assistant 本體
            tool_resources: { file_search: { vector_store_ids: [effectiveVectorStoreId] } },
            // 控制隨機性與一致性，並強制使用檢索工具
            max_completion_tokens: tokenConfig[type as keyof typeof tokenConfig] || 60000,
            temperature: 0.3, // 降低隨機性，增加結構一致性
            top_p: 0.9,
            tool_choice: 'required',
            instructions: `STRICT MODE:
- Only use the sermon file (and the provided summary for verse priority when present).
- For every Bible verse: paste full text and append one of [From Summary] / [In Sermon] / [Supplemental: reason].
- Follow the exact format structure requested in the prompt.
- For ${type}, ensure ALL required sections are included with proper formatting.
- If uncertain about content, write "[MISSING]" rather than guessing.`
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
        
        if (invalid) {
          if (attempt < maxRuns) {
            console.warn(`[WARN] ${type} 內容無效 (包含錯誤關鍵字或過短)，將重試...`);
            // 這裡不需要再 waitForVectorStoreReady，因為我們在最外層已經確保它 ready 了
            // 除非是偶發的檢索失敗，重試 run 即可
            continue; // retry
          } else {
            // 最後一次嘗試仍然無效，拋出錯誤以便外層捕獲並標記為 failed
            throw new Error(`處理 ${type} 內容失敗: 產生的內容無效或包含錯誤訊息`);
          }
        }
        
        return { type, content };
      }
      throw new Error(`處理 ${type} 內容最終失敗`);
    }
    
    // 先產出 summary，再並行產出 devotional / bibleStudy（注入 summary 內容以強化經文一致性）
    console.log('[DEBUG] 先產出 summary，再以其作為後續依據');
    const summaryRes = await processContentType({ type: 'summary', prompt: (contentTypes[0].prompt) });
    results['summary'] = summaryRes.content;

    console.log('[DEBUG] 產出 devotional / bibleStudy（帶入 summary 內容以優先經文）');
    const settled = await Promise.allSettled([
      processContentType({ type: 'devotional', prompt: (contentTypes[1].prompt), summaryText: results.summary }),
      processContentType({ type: 'bibleStudy', prompt: (contentTypes[2].prompt), summaryText: results.summary })
    ]);
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        results[s.value.type] = s.value.content;
      } else {
        console.warn('[WARN] 子任務失敗:', s.reason);
      }
    }
    console.log(`[DEBUG] devotional / bibleStudy 並行處理完成`);

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
  } finally {
    // 統一清理
    if (cleanup) {
      console.log('[DEBUG] 執行最終資源清理');
      await cleanup();
    }
  }
}

export async function POST(request: Request) {
  try {
    const { assistantId, vectorStoreId, fileName, userId, fileId: fileIdFromReq } = await request.json();
    
    console.log('[DEBUG] 處理文件請求:', { assistantId, vectorStoreId, fileName });
    
    if (!assistantId || !vectorStoreId || !fileName) {
      return NextResponse.json(
        { error: '缺少必要參數', details: { assistantId, vectorStoreId, fileName } },
        { status: 400 }
      );
    }
    
  // 移除對 Assistant 的檢索與綁定更新；改用 run 級 tool_resources 綁定（見上方 processContentType）
  console.log('[DEBUG] 將在 run 級別綁定向量庫，略過 Assistant 綁定往返');

    // 獲取文件ID：優先使用請求提供的 fileId，否則再從數據庫/向量庫推斷
    let fileId: string | null = fileIdFromReq || null;
    if (fileId) {
      console.log('[DEBUG] 從請求取得 fileId:', fileId);
    }
    console.log('[DEBUG] 查詢數據庫獲取fileId（若請求未提供）');
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
      
      if (!fileId && result.Items && result.Items.length > 0) {
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
      
      // 若多檔且未指定 fileId，拒絕處理，避免跨檔干擾
      if (!fileId && filesInVectorStore.data.length > 1) {
        return NextResponse.json(
          { error: 'Multiple files found in vector store. Please specify fileId to avoid cross-file retrieval.' },
          { status: 400 }
        );
      }
      // 若僅一檔且未指定 fileId，自動採用該檔案
      if (!fileId && filesInVectorStore.data.length === 1) {
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
          fileId: fileId || undefined,
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