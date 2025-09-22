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

// 確保 run 僅檢索到單一檔案：若 vectorStoreId 內檔案數 > 1，且有提供 fileId，動態建立臨時向量庫只包含該檔案
async function ensureSingleFileVectorStore(openaiClient: OpenAI, vectorStoreId: string, fileId?: string) {
  let effectiveVectorStoreId = vectorStoreId;
  let cleanup: (() => Promise<void>) | undefined;
  try {
    const list = await openaiClient.beta.vectorStores.files.list(vectorStoreId);
    const files = list.data || [];
    if (files.length <= 1) {
      return { effectiveVectorStoreId, cleanup };
    }
    if (fileId) {
      const temp = await openaiClient.beta.vectorStores.create({ name: `tmp_single_${Date.now()}` });
      await openaiClient.beta.vectorStores.files.create(temp.id, { file_id: fileId });
      effectiveVectorStoreId = temp.id;
      cleanup = async () => {
        try { await openaiClient.beta.vectorStores.del(temp.id); } catch {}
      };
      console.log('[INFO] 已建立臨時向量庫以避免交叉檢索', { from: vectorStoreId, to: effectiveVectorStoreId, fileId });
    } else {
      console.warn('[WARN] 多檔向量庫但缺少 fileId，無法建立臨時向量庫');
    }
  } catch (e) {
    console.warn('[WARN] ensureSingleFileVectorStore 失敗，將沿用原向量庫', e);
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

  // 單一內容類型處理函式（保留重試機制），支援注入 summary 文字以供後續內容優先引用經文
  async function processContentType({ type, prompt, summaryText }: { type: string, prompt: string, summaryText?: string }) {
      console.log(`[DEBUG] 並行處理 ${type} 內容開始...`);
      
      const failurePhrases = ['無法直接訪問', '无法直接访问', '我無法直接訪問', '請提供', '無法讀取'];
  const maxRuns = isAgape ? 5 : 3;

      // 根據類型添加詳細度要求，模擬 ChatGPT 對話的豐富程度
      const detailRequirements = {
        summary: '請提供非常詳細完整的講道總結，包含所有重點、細節、例證和應用，至少 1500-2000 字。要像在與人深度對話一樣詳細自然。',
        devotional: '請提供極其豐富詳細的7天靈修指南，每天都要包含深入的反思、具體的應用建議、個人見證例子、實際操練方法，每天至少 400-500 字，總計 3000+ 字。內容要像資深牧者的親切指導。',
        bibleStudy: '請提供完整詳細的查經指南，包含多樣化的破冰遊戲、敬拜詩歌推薦、小組討論問題、見證分享引導、實際應用挑戰等豐富內容，至少 2000-2500 字。要像經驗豐富的小組長的完整預備。'
      };

      for (let attempt = 1; attempt <= maxRuns; attempt++) {
        // 建立新執行緒
        const typeThread = await openai.beta.threads.create();
        console.log(`[DEBUG] 為 ${type} 建立執行緒 ID: ${typeThread.id} (嘗試 ${attempt}/${maxRuns})`);

        await openai.beta.threads.messages.create(typeThread.id, {
          role: 'user',
          content: `請幫我分析文件 "${fileName}"（只使用該文件內容）。我需要基於此文件提供${type}內容。

${detailRequirements[type as keyof typeof detailRequirements]}

請確保內容豐富、具體、實用，就像你在直接與用戶深度對話一樣自然詳細。不要簡化或省略，要提供完整充實的內容。`
        });

        // 若已有 summary，且本次為 devotional 或 bibleStudy，則將 summary 注入並強調經文優先規則與標籤
        if (type !== 'summary' && summaryText) {
          await openai.beta.threads.messages.create(typeThread.id, {
            role: 'user',
            content: `Here is the sermon summary already generated:\n---\n${summaryText}\n---\n\nWhen selecting and quoting Bible verses for this ${type}, you MUST:\n1) FIRST prioritize verses already identified in the summary;\n2) SECOND use verses directly present in the sermon file;\n3) ONLY THEN, if fewer than required, add supplemental verses with a short justification.\n\nAlways paste the exact verse text (CUV for Chinese; NIV for English). Do NOT display any labels such as [From Summary], [In Sermon], or [Supplemental] in the final output. Avoid duplication unless the sermon itself repeats the verse.`
          });
        }
        await openai.beta.threads.messages.create(typeThread.id, {
          role: 'user',
          content: prompt
        });

        // 針對不同內容類型的 token 分配設定 - 大幅增加以獲得豐富內容
        const tokenConfig = {
          summary: 50000,      // 總結：大幅增加詳細度
          devotional: 60000,   // 靈修：最大化7天豐富分量
          bibleStudy: 55000    // 查經：包含遊戲、詩歌、見證等完整內容
        };

        // 保障：在 run 前確保只會讀到單一檔案
        const { effectiveVectorStoreId, cleanup } = await ensureSingleFileVectorStore(openai, vectorStoreId, fileId || undefined);

        const run = await (openai.beta.threads.runs.create as any)(
          typeThread.id,
          {
            assistant_id: assistantId,
            // 在 run 級別綁定 vector store，避免修改 assistant 本體
            tool_resources: { file_search: { vector_store_ids: [effectiveVectorStoreId] } },
            // 控制隨機性與一致性，並強制使用檢索工具
            max_completion_tokens: tokenConfig[type as keyof typeof tokenConfig] || 60000,
            temperature: 0.5,
            top_p: 0.9,
            tool_choice: 'required',
            instructions: `STRICT MODE:\n- Only use the sermon file (and the provided summary for verse priority when present).\n- Select verses using the priority (summary first, then in-sermon, then minimal supplemental if needed).\n- Paste the full verse text (CUV/NIV) but DO NOT include any source labels like [From Summary], [In Sermon], or [Supplemental] in the output.\n- If uncertain, write "[MISSING]" rather than guessing.`
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
        // 清理臨時向量庫（如有）
        try { if (cleanup) await cleanup(); } catch {}
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
          let out = s.value.content || '';
          // 輕量後處理：移除模型可能留下的來源標籤字樣，不影響效能
          if (s.value.type === 'devotional' || s.value.type === 'bibleStudy') {
            out = out
              .replace(/\s*\[(?:From Summary|In Sermon|Supplemental:[^\]]*)\]\s*/gi, ' ')
              .replace(/\s{2,}/g, ' ') // 清理多餘空白
              .trim();
          }
          results[s.value.type] = out;
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