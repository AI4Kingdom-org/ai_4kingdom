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

// CORS 配置
const ALLOWED_ORIGINS = [
  'https://main.d3ts7h8kta7yzt.amplifyapp.com',
  'https://ai4kingdom.com',
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
function extractDocumentReferences(toolCall: any, currentUserId?: string): any[] {
  try {
    if (toolCall?.type !== 'file_search' || !toolCall?.output) {
      return [];
    }
    
    const parsedOutput = JSON.parse(toolCall.output);
    
    if (parsedOutput?.citations && Array.isArray(parsedOutput.citations)) {
      console.log('[DEBUG] 檢索到文檔引用:', parsedOutput.citations.length);
      
      // 添加用戶屬性到引用中
      return parsedOutput.citations.map((citation: any) => ({
        fileName: citation.file_name || citation.fileName || '未知檔案',
        filePath: citation.file_path || citation.filePath || '',
        pageNumber: citation.page_number || citation.pageNumber || null,
        text: citation.text || '',
        fileId: citation.file_id || citation.fileId || '',
        isCurrentUserFile: true, // 默認為當前用戶的文件
        uploadedBy: currentUserId ? `您 (用戶ID: ${currentUserId})` : "您" 
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
  userId?: string
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
    if (runStatus.required_action?.type === 'submit_tool_outputs') {
      const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
      for (const call of toolCalls) {
        if (call.function.name === 'file_search') {
          const callReferences = extractDocumentReferences(call, userId);
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
          const toolReferences = extractDocumentReferences(tool, userId);
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
    const { message, threadId, userId, config } = await request.json();

    // 檢查是否為模擬測試請求
    if (config.mock && config.mockUsage) {
      console.log('[DEBUG] 接收到模擬測試請求:', {
        userId,
        usage: config.mockUsage
      });

      // 模拟用户使用量更新（在实际环境中，您需要实现相应的API）
      try {
        // 导入 updateMonthlyTokenUsage 函数
        const { updateMonthlyTokenUsage } = require('../../utils/monthlyTokenUsage');
        
        // 更新用户的月度使用统计
        await updateMonthlyTokenUsage(userId, config.mockUsage);
        
        console.log('[DEBUG] 模拟更新使用统计成功');
        
        // 返回模擬回應
        return NextResponse.json({
          success: true,
          reply: `這是一個模擬回應。已成功消耗 ${config.mockUsage.total_tokens} tokens。`,
          threadId: threadId || `mock_thread_${Date.now()}`,
          debug: {
            mockUsage: config.mockUsage,
            timestamp: new Date().toISOString()
          }
        });
      } catch (mockError) {
        console.error('[ERROR] 模擬更新使用統計失敗:', mockError);
        return NextResponse.json({
          error: '模擬更新使用統計失敗',
          details: mockError instanceof Error ? mockError.message : '未知錯誤'
        }, { status: 500 });
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
      return NextResponse.json({ 
        error: '助手ID无效',
        details: {
          message: error instanceof Error ? error.message : '未知错误',
          assistantId: config?.assistantId,
          type: error instanceof Error ? error.name : typeof error
        }
      }, { status: 400 });
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

    await openai.beta.threads.messages.create(activeThreadId, {
      role: 'user',
      content: message
    });    // 检查是否請求流式輸出
    if (config.stream) {
      console.log('[DEBUG] 處理流式請求:', {
        userId,
        assistantId: config.assistantId,
        vectorStoreId: config.vectorStoreId || 'none'
      });
        // 建立执行
      const run = await openai.beta.threads.runs.create(activeThreadId, {
        assistant_id: config.assistantId,
        max_completion_tokens: 1000,
        ...(config.vectorStoreId ? {
          tool_resources: {
            file_search: {
              vector_store_ids: [config.vectorStoreId]
              // OpenAI API 不支援 user_filter 參數
            }
          }
        } : {})
      });
        // 记录设置
      console.log('[DEBUG] 已設置API參數:', {
        assistantId: config.assistantId,
        vectorStoreId: config.vectorStoreId ? config.vectorStoreId : '未設置'
        // OpenAI API 不支援 user_filter 參數，移除相關日誌
      });
      
      // 创建流式响应
      const stream = new ReadableStream({
        async start(controller) {
          // 启动流式传输
          try {
            const encoder = new TextEncoder();
            
            // 传输生成的结果
            for await (const chunk of streamRunResults(openai, activeThreadId, run.id, userId)) {
              controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
            }
            
            controller.close();
          } catch (error) {
            console.error('[ERROR] 流式傳輸失敗:', error);
            const errorMessage = error instanceof Error ? error.message : '流式傳輸失敗';
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`));
            controller.close();
          }
        }
      });
      
      // 返回流式响应
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        }
      });
    }
      // 非流式请求的处理
    const run = await openai.beta.threads.runs.create(activeThreadId, {
      assistant_id: config.assistantId,
      max_completion_tokens: 1000,
      ...(config.vectorStoreId ? {
        tool_resources: {
          file_search: {
            vector_store_ids: [config.vectorStoreId]
            // OpenAI API 不支援 user_filter 參數
          }
        }
      } : {})
    });
      console.log('[DEBUG] 非流式模式參數設置:', {
      assistantId: config.assistantId,
      vectorStoreId: config.vectorStoreId ? config.vectorStoreId : '未設置'
      // OpenAI API 不支援 user_filter 參數，移除相關日誌
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
    
    return NextResponse.json({
      success: true,
      reply: assistantReply,
      threadId: activeThreadId,
      debug: {
        runStatus: runStatus.status,
        messageCount: messages.data.length
      }
    });

  } catch (error) {
    console.error('[ERROR] 聊天API错误:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : '未知错误',
      details: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
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
