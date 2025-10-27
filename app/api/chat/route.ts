import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { updateMonthlyTokenUsage } from '../../utils/monthlyTokenUsage';
import { createDynamoDBClient } from '../../utils/dynamodb';

// 统一环境变量配置
const CONFIG = {
  region: process.env.NEXT_PUBLIC_AWS_REGION || process.env.NEXT_PUBLIC_REGION || "us-east-2",
  identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!,
  userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
  userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
  tableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME || "ChatHistory",
  isDev: process.env.NODE_ENV === 'development'
};

// 获取 DynamoDB 客户端函数
const getDocClient = async (): Promise<DynamoDBDocumentClient> => {
  return await createDynamoDBClient();
};

// ---------------- 新增：活躍 run 檢查與記憶體鎖 (單一實例) ----------------
async function findActiveRun(openai: OpenAI, threadId: string) {
  try {
    const runs = await openai.beta.threads.runs.list(threadId, { limit: 5 });
    return runs.data.find(r => ['queued','in_progress','requires_action','cancelling'].includes(r.status));
  } catch (e) {
    console.warn('[WARN] findActiveRun 失敗，忽略並視為無活躍 run', e);
    return undefined;
  }
}

const threadLocks = new Map<string, number>(); // threadId -> expiry timestamp(ms)
const LOCK_TTL_MS = 120000;
function acquireLock(threadId: string): boolean {
  const now = Date.now();
  const exp = threadLocks.get(threadId) || 0;
  if (exp > now) return false; // still locked
  threadLocks.set(threadId, now + LOCK_TTL_MS);
  return true;
}
function releaseLock(threadId: string) {
  threadLocks.delete(threadId);
}
// -------------------------------------------------------------------------

// CORS 配置
const ALLOWED_ORIGINS = [
  'https://main.d3ts7h8kta7yzt.amplifyapp.com',
  process.env.NEXT_PUBLIC_PRIMARY_DOMAIN || 'https://ai4kingdom.org',
  process.env.NEXT_PUBLIC_FALLBACK_DOMAIN || 'https://ai4kingdom.com',
  'http://localhost:3000'
];

function setCORSHeaders(origin: string | null) {
  const headers = new Headers({
    'Content-Type': 'application/json',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-WP-Nonce, X-Requested-With, Accept',
  });

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    // 添加 Vary 头以支持多源
    headers.set('Vary', 'Origin');
  }

  return headers;
}

// 修改现有的 getUserActiveThread 函数
async function getUserActiveThread(
  userId: string, 
  openai: OpenAI,
  assistantId: string  // 新增参数
): Promise<string> {
  try {
    const docClient = await getDocClient();
    const command = new QueryCommand({
      TableName: CONFIG.tableName,
      IndexName: 'UserTypeIndex',
      KeyConditionExpression: 'UserId = :userId AND #type = :type',
      ExpressionAttributeNames: {
        '#type': 'Type'
      },
      ExpressionAttributeValues: {
        ':userId': String(userId),
        ':type': 'thread'
      }
    });

    const response = await docClient.send(command);
    const latestThread = response.Items?.[0];
    const threadId = latestThread?.threadId;
    
    if (!threadId) {
      // 创建新线程时关联 assistantId
      const newThread = await openai.beta.threads.create();
      
      // 创建 run 来关联 assistant
      await openai.beta.threads.runs.create(newThread.id, {
        assistant_id: assistantId
      });
      
      await docClient.send(new PutCommand({
        TableName: CONFIG.tableName,
        Item: {
          UserId: String(userId),
          Type: 'thread',
          threadId: newThread.id,
          assistantId: assistantId,  // 保存 assistantId
          Timestamp: new Date().toISOString()
        }
      }));
      return newThread.id;
    }

    return threadId;
  } catch (error) {
    console.error('[ERROR] 获取用户线程失败:', error);
    throw error;
  }
}

// 修改等待完成函数的超时策略
async function waitForCompletion(openai: OpenAI, threadId: string, runId: string, maxAttempts = 30) {
  let attempts = 0;
  let runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);
  
  console.log('[DEBUG] OpenAI Run 配置详情:', {
    threadId,
    runId,
    assistant: {
      id: runStatus.assistant_id,
      model: runStatus.model,
      instructions: runStatus.instructions,
      tools: runStatus.tools?.map(t => t.type)
    },
    metadata: {
      status: runStatus.status,
      startTime: new Date(runStatus.created_at * 1000).toISOString(),
      completionTime: runStatus.completed_at ? new Date(runStatus.completed_at * 1000).toISOString() : null
    }
  });

  while (runStatus.status !== 'completed' && attempts < maxAttempts) {
    if (runStatus.status === 'failed') {
      throw new Error('Assistant run failed');
    }
    
    // 使用渐进式延迟策略
    const delay = Math.min(1000 * Math.pow(1.2, attempts), 3000);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    attempts++;
    runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);
    console.log(`[DEBUG] Run status: ${runStatus.status}, attempt: ${attempts}`);
  }
  
  if (runStatus.status === 'completed') {

    // 获取运行步骤以检查检索操作
    const steps = await openai.beta.threads.runs.steps.list(threadId, runId);
    const retrievalSteps = steps.data.filter(step => 
      (step.step_details as any).type === 'retrieval'
    );
  }
  
  if (attempts >= maxAttempts) {
    throw new Error('请求处理超时，请稍后重试');
  }
  
  return runStatus;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 函數用於提取文檔引用
async function extractDocumentReferences(toolCall: any, currentUserId?: string, opts?: { agapeOnly?: boolean; agapeSet?: Set<string> }): Promise<any[]> {
  try {
    if (toolCall?.type !== 'file_search' || !toolCall?.output) {
      return [];
    }
    
    const parsedOutput = JSON.parse(toolCall.output);
    
    if (parsedOutput?.citations && Array.isArray(parsedOutput.citations)) {
      console.log('[DEBUG] 檢索到文檔引用:', parsedOutput.citations.length);
      
      // 對於johnsung和sunday-guide的文件，這些是共享資源，所以不需要檢查擁有者
      // 將所有文件都視為系統資源，而不是私人資源
      let cites = parsedOutput.citations;
      if (opts?.agapeOnly && opts.agapeSet) {
        cites = cites.filter((c: any) => opts.agapeSet!.has(c.file_id || c.fileId));
      }
      return cites.map((citation: any) => ({
        fileName: citation.file_name || citation.fileName || '未知檔案',
        filePath: citation.file_path || citation.filePath || '',
        pageNumber: citation.page_number || citation.pageNumber || null,
        text: citation.text || '',
        fileId: citation.file_id || citation.fileId || '',
        isCurrentUserFile: false,
        uploadedBy: '系統資源'
      }));
    }
    
    return [];
  } catch (error) {
    console.error('[ERROR] 解析文檔引用失敗:', error);
    return [];
  }
}

// 流式傳輸響應的函數
async function* streamRunResults(
  openai: OpenAI,
  threadId: string,
  runId: string,
  userId?: string,
  opts?: { agapeOnly?: boolean }
) {
  let runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);
  let lastMessageId: string | null = null;
  
  console.log('[DEBUG] 開始流式傳輸, 使用:', {
    threadId, 
    runId,
    assistantId: runStatus.assistant_id,
    userId: userId || 'anonymous'
  });
  
  // 循環檢查運行狀態
  while (runStatus.status !== 'completed' && runStatus.status !== 'failed' && runStatus.status !== 'cancelled' && runStatus.status !== 'expired') {
    // 如果仍在處理中，返回狀態更新
    yield JSON.stringify({ status: runStatus.status });
    
    // 等待一段時間再檢查
    await new Promise(resolve => setTimeout(resolve, 1000));
    runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);
  }
  
  // 如果運行失敗，返回錯誤
  if (runStatus.status !== 'completed') {
    yield JSON.stringify({ error: `Assistant run failed with status: ${runStatus.status}` });
    return;
  }
  
  // 檢索運行結果
  const messages = await openai.beta.threads.messages.list(threadId);
  const latestMessage = messages.data[0];
  
  // 返回消息內容
  if (latestMessage) {
    let references: any[] = [];
    
    // 提取文檔引用
  const agapeSet: Set<string> | undefined = opts?.agapeOnly ? await (async () => {
      try {
        const docClient = await getDocClient();
        const table = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
        const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
        const res = await docClient.send(new ScanCommand({ TableName: table, FilterExpression: 'unitId = :u', ExpressionAttributeValues: { ':u': 'agape' } }));
        return new Set((res.Items || []).map(r => r.fileId).filter(Boolean));
      } catch { return new Set(); }
    })() : undefined;

    if (runStatus.required_action?.type === 'submit_tool_outputs') {
      const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
      for (const call of toolCalls) {
        if (call.function.name === 'file_search') {
          const callReferences = await extractDocumentReferences(call, userId, { agapeOnly: opts?.agapeOnly, agapeSet });
          references = [...references, ...callReferences];
        }
      }
    }
    
    // 提取步驟中的檢索操作
    try {
      const steps = await openai.beta.threads.runs.steps.list(threadId, runId);
      const retrievalSteps = steps.data.filter(step => 
        (step.step_details as any).type === 'retrieval'
      );
      
      for (const step of retrievalSteps) {
        const toolOutputs = (step.step_details as any).retrieval_tool_calls || [];
        for (const tool of toolOutputs) {
          const toolReferences = await extractDocumentReferences(tool, userId, { agapeOnly: opts?.agapeOnly, agapeSet });
          references = [...references, ...toolReferences];
        }
      }
    } catch (e) {
      console.error('[ERROR] 獲取運行步驟失敗:', e);
    }
    
    // 如果有文檔引用，先傳送引用資訊
    if (references.length > 0) {
      yield JSON.stringify({ references });
    }
    
    // 傳送消息內容
    for (const content of latestMessage.content) {
      if (content.type === 'text') {
        yield JSON.stringify({ content: content.text.value });
      }
    }
    
    // 記錄 token 使用量
    if (userId && runStatus.usage) {
      try {
        const tokenUsage = {
          prompt_tokens: runStatus.usage.prompt_tokens || 0,
          completion_tokens: runStatus.usage.completion_tokens || 0,
          total_tokens: runStatus.usage.total_tokens || 0,
          retrieval_tokens: 0
        };
        
        await updateMonthlyTokenUsage(userId, tokenUsage);
        yield JSON.stringify({ 
          usage: tokenUsage,
          done: true 
        });
      } catch (usageError) {
        console.error('[ERROR] 記錄 token 使用量失敗:', usageError);
        yield JSON.stringify({ done: true });
      }
    } else {
      yield JSON.stringify({ done: true });
    }
  }
}

export async function POST(request: Request) {
  try {
    console.log('[DEBUG] 接收到聊天請求:', {
      method: request.method,
      url: request.url,
      contentType: request.headers.get('content-type'),
      timestamp: new Date().toISOString()
    });

    // 驗證請求體
    let requestBody;
    try {
      requestBody = await request.json();
      console.log('[DEBUG] 解析請求體成功:', {
        hasMessage: !!requestBody.message,
        hasConfig: !!requestBody.config,
        hasUserId: !!requestBody.userId,
        configType: requestBody.config?.type
      });
    } catch (parseError) {
      console.error('[ERROR] 解析請求體失敗:', parseError);
      const origin = request.headers.get('origin');
      const headers = setCORSHeaders(origin);
      return NextResponse.json({ 
        error: '請求格式無效',
        details: '無法解析請求體'
      }, { 
        status: 400,
        headers 
      });
    }

  const { message, threadId, userId, config, unitId } = requestBody;

    // 驗證必要參數
    if (!message || !config || !config.assistantId) {
      console.error('[ERROR] 缺少必要參數:', {
        hasMessage: !!message,
        hasConfig: !!config,
        hasAssistantId: !!config?.assistantId
      });
      const origin = request.headers.get('origin');
      const headers = setCORSHeaders(origin);
      return NextResponse.json({ 
        error: '缺少必要參數',
        details: '需要 message, config 和 assistantId'
      }, { 
        status: 400,
        headers 
      });
    }

    // 單位識別（目前僅支援 agape 額外隔離）
    const isAgapeUnit = unitId === 'agape' || (config?.type === 'sunday-guide' && typeof request.headers.get('referer') === 'string' && request.headers.get('referer')?.includes('agape-church'));

    // 如為 agape 強制覆寫 vectorStoreId 為專用向量庫（若存在）
    if (isAgapeUnit) {
      try {
        const { VECTOR_STORE_IDS } = await import('../../config/constants');
        if (VECTOR_STORE_IDS.AGAPE_CHURCH) {
          config.vectorStoreId = VECTOR_STORE_IDS.AGAPE_CHURCH;
        }
      } catch (e) {
        console.warn('[WARN] 無法載入 VECTOR_STORE_IDS 以覆寫 Agape 向量庫', e);
      }
    }

    // 验证助手
    try {
      const assistant = await openai.beta.assistants.retrieve(config.assistantId);
    } catch (error) {
      console.error('[ERROR] 助手验证失败:', {
        error,
        assistantId: config?.assistantId,
        errorType: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
        statusCode: (error as any)?.status || 'unknown'
      });
      
      // 獲取 origin 並設置 CORS 標頭
      const origin = request.headers.get('origin');
      const headers = setCORSHeaders(origin);
      
      return NextResponse.json({ 
        error: '助手ID无效',
        details: {
          message: error instanceof Error ? error.message : '未知错误',
          assistantId: config?.assistantId,
          type: error instanceof Error ? error.name : typeof error
        }
      }, { 
        status: 400,
        headers 
      });
    }

    let activeThreadId = threadId;
    let thread;

    // 如果提供了现有线程ID，先尝试获取
    if (threadId) {
      try {
        thread = await openai.beta.threads.retrieve(threadId);
        activeThreadId = threadId;
      } catch (error) {
        console.warn('[WARN] 获取现有线程失败，将创建新线程:', error);
      }
    }

    // 如果没有现有线程或获取失败，创建新线程
    if (!thread) {
      thread = await openai.beta.threads.create({
        metadata: {
          userId,
          type: config.type,
          assistantId: config.assistantId,
          vectorStoreId: config.vectorStoreId
        }
      });
      activeThreadId = thread.id;
    }
    // 在加入訊息前檢查是否已有活躍 run
    if (activeThreadId) {
      const activeRun = await findActiveRun(openai, activeThreadId);
      if (activeRun) {
        const originBusy = request.headers.get('origin');
        const headersBusy = setCORSHeaders(originBusy);
        return NextResponse.json({
          error: 'ThreadBusy',
          message: '上一輪回覆尚未完成，請稍候再發送。',
          activeRunId: activeRun.id,
          status: activeRun.status,
          threadId: activeThreadId
        }, { status: 409, headers: headersBusy });
      }
      // 嘗試鎖（避免同毫秒第二請求）
      if (!acquireLock(activeThreadId)) {
        const originBusy = request.headers.get('origin');
        const headersBusy = setCORSHeaders(originBusy);
        return NextResponse.json({
          error: 'ThreadLocked',
          message: '該對話正在處理中，請稍候。',
          threadId: activeThreadId
        }, { status: 409, headers: headersBusy });
      }
    }

    await openai.beta.threads.messages.create(activeThreadId, {
      role: 'user',
      content: message
    });    // 检查是否請求流式輸出
    if (config.stream) {
      console.log('[DEBUG] 處理流式請求:', {
        userId,
        assistantId: config.assistantId,
        vectorStoreId: config.vectorStoreId || 'none'
      });        // 使用 OpenAI SDK 的 stream 功能 - 暫時移除不相容參數
      const runStream = openai.beta.threads.runs.stream(activeThreadId, {
        assistant_id: config.assistantId,
        max_completion_tokens: 2500,     // 保留：增加回應長度
        // 暫時註解掉可能不相容的參數進行測試
        // max_prompt_tokens: 15000,        // 可能不相容：控制輸入上下文
        // temperature: 0.1,                // 可能不相容：降低隨機性
        // truncation_strategy: {           // 可能不相容：智能截斷策略
        //   type: 'auto'
        // },
        ...(config.vectorStoreId ? {
          tool_resources: {
            file_search: {
              vector_store_ids: [config.vectorStoreId]
            }
          }
        } : {})
      });
        // 记录设置 - 臨時移除不相容參數模式
      console.log('[DEBUG] 臨時移除不相容參數設置:', {
        assistantId: config.assistantId,
        vectorStoreId: config.vectorStoreId ? config.vectorStoreId : '未設置',
        maxCompletionTokens: 2500,
        note: '已暫時移除 temperature, max_prompt_tokens, truncation_strategy'
      });
      
      // 将 OpenAI 的事件流直接管道到 Next.js 的响应流
      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const event of runStream) {
              // 發送所有事件，不只是包含 data 的事件
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              
              // 檢查是否為最終事件
              if (event.event === 'thread.run.completed' || 
                  event.event === 'thread.run.failed' || 
                  event.event === 'thread.run.cancelled' || 
                  event.event === 'thread.run.expired') {
                // 嘗試在 completed 時寫入使用量（stream 分支原本未記帳）
                if (event.event === 'thread.run.completed' && userId) {
                  try {
                    const runId = (event as any)?.data?.id;
                    if (runId) {
                      const finalRun = await openai.beta.threads.runs.retrieve(activeThreadId, runId);
                      const u: any = (finalRun as any)?.usage;
                      if (u) {
                        const tokenUsage = {
                          prompt_tokens: u.prompt_tokens || 0,
                          completion_tokens: u.completion_tokens || 0,
                          total_tokens: u.total_tokens || 0,
                          retrieval_tokens: 0
                        };
                        await updateMonthlyTokenUsage(userId, tokenUsage);
                        // 可選：回送一筆 usage 給前端（不影響相容性）
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: 'usage.recorded', usage: tokenUsage })}\n\n`));
                      }
                    }
                  } catch (usageErr) {
                    console.error('[ERROR] stream 分支記錄 token 使用量失敗:', usageErr);
                  }
                }
                // 發送流結束標誌
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({event: 'done'})}\n\n`));
                break;
              }
            }
          } catch (error) {
            console.error('[ERROR] 流式處理錯誤:', error);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              event: 'error',
              error: error instanceof Error ? error.message : '流式處理失敗'
            })}\n\n`));
          } finally {
            try {
              controller.close();
            } catch (e) {
              console.warn('[WARN] 流關閉時發生錯誤:', e);
            }
            // 無論成功或錯誤釋放鎖
            try { releaseLock(activeThreadId); } catch {}
          }
        },
        cancel() {
          console.log('[DEBUG] 客戶端斷開連接，串流已取消');
          try { releaseLock(activeThreadId); } catch {}
        }
      });
      
      // 設置 CORS 標頭
      const origin = request.headers.get('origin');
      const corsHeaders = setCORSHeaders(origin);
      
      // 返回流式响应
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          ...Object.fromEntries(corsHeaders.entries())
        }
      });
    }      // 非流式请求的处理 - 暫時移除不相容參數
    const run = await openai.beta.threads.runs.create(activeThreadId, {
      assistant_id: config.assistantId,
      max_completion_tokens: 2500,       // 保留：增加回應長度
      // 暫時註解掉可能不相容的參數進行測試
      // max_prompt_tokens: 15000,          // 可能不相容：控制輸入上下文
      // temperature: 0.1,                  // 可能不相容：降低隨機性
      // truncation_strategy: {             // 可能不相容：智能截斷策略
      //   type: 'auto'
      // },
      ...(config.vectorStoreId ? {
        tool_resources: {
          file_search: {
            vector_store_ids: [config.vectorStoreId]
          }
        }
      } : {})
    });
      console.log('[DEBUG] 非流式臨時移除不相容參數設置:', {
        assistantId: config.assistantId,
        vectorStoreId: config.vectorStoreId ? config.vectorStoreId : '未設置',
        maxCompletionTokens: 2500,
        note: '已暫時移除 temperature, max_prompt_tokens, truncation_strategy'
      });

    // 等待运行完成
    let runStatus = await openai.beta.threads.runs.retrieve(
      activeThreadId,
      run.id
    );

    while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(
        activeThreadId,
        run.id
      );
    }

    if (runStatus.status !== 'completed') {
      console.error('[ERROR] 助手运行失败:', runStatus);
      throw new Error(`Assistant run failed with status: ${runStatus.status}`);
    }

    // 获取助手的回复
    const messages = await openai.beta.threads.messages.list(activeThreadId);
    const lastMessage = messages.data[0];
    const assistantReply = lastMessage.content
      .filter(content => content.type === 'text')
      .map(content => (content.type === 'text' ? content.text.value : ''))
      .join('\n');
    
    // 添加 token 使用量记录
    if (userId && runStatus.usage) {
      try {
        // 从 runStatus 中提取 token 使用量
        const tokenUsage = {
          prompt_tokens: runStatus.usage.prompt_tokens || 0,
          completion_tokens: runStatus.usage.completion_tokens || 0,
          total_tokens: runStatus.usage.total_tokens || 0,
          retrieval_tokens: 0 // OpenAI API 可能不提供检索 token，设为 0
        };
        
        // 更新用户的月度 token 使用统计
        await updateMonthlyTokenUsage(userId, tokenUsage);
        
        console.log(`[DEBUG] 已記錄用戶 ${userId} 的聊天 token 使用量:`, tokenUsage);
      } catch (usageError) {
        // 记录错误但不中断请求
        console.error('[ERROR] 記錄 token 使用量失敗:', usageError);
      }
    }
    
    // 設置 CORS 標頭
    const origin = request.headers.get('origin');
    const headers = setCORSHeaders(origin);
    
    return NextResponse.json({
      success: true,
      reply: assistantReply,
      threadId: activeThreadId,
      debug: {
        runStatus: runStatus.status,
        messageCount: messages.data.length
      }
    }, { headers });

  } catch (error) {
    // 發生錯誤時嘗試釋放鎖（若有 threadId 可用）
    try {
      const body = await request.clone().text();
      const maybe = JSON.parse(body);
      if (maybe?.threadId) releaseLock(maybe.threadId);
    } catch {}
    console.error('[ERROR] 聊天API错误:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    
    // 獲取 origin 並設置 CORS 標頭
    const origin = request.headers.get('origin');
    const headers = setCORSHeaders(origin);
    
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : '未知错误',
      details: error instanceof Error ? error.stack : undefined
    }, { 
      status: 500,
      headers 
    });
  }
}

// 保留 OPTIONS 方法用于 CORS
export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  const headers = setCORSHeaders(origin);
  
  return new Response(null, {
    status: 204,
    headers
  });
}
