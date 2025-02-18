import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import OpenAI from 'openai';
import { NextResponse } from 'next/server';

// 统一环境变量配置
const CONFIG = {
  region: process.env.NEXT_PUBLIC_AWS_REGION || process.env.NEXT_PUBLIC_REGION || "us-east-2",
  identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!,
  userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID!,
  userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID!,
  tableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME || "ChatHistory",
  isDev: process.env.NODE_ENV === 'development'
};

// 添加调试日志
console.log('[DEBUG] AWS 配置:', {
  region: CONFIG.region,
  identityPoolId: CONFIG.identityPoolId,
  userPoolId: CONFIG.userPoolId,
  tableName: CONFIG.tableName,
  isDev: CONFIG.isDev,
  hasAccessKey: !!process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
  hasSecretKey: !!process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY
});

console.log('[DEBUG] OpenAI配置:', {
  hasApiKey: !!process.env.OPENAI_API_KEY,
  apiKeySuffix: process.env.OPENAI_API_KEY?.slice(-4),
  environment: process.env.NODE_ENV
});

async function getDynamoDBConfig() {
  if (CONFIG.isDev) {
    return {
      region: CONFIG.region,
      credentials: {
        accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY!,
        secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_KEY!
      }
    };
  }

  try {
    const credentials = await fromCognitoIdentityPool({
      clientConfig: { region: CONFIG.region },
      identityPoolId: CONFIG.identityPoolId
    })();

    return {
      region: CONFIG.region,
      credentials
    };
  } catch (error) {
    console.error('[ERROR] Cognito 凭证获取失败:', error);
    throw error;
  }
}

// 创建 DynamoDB 客户端
async function createDynamoDBClient() {
  try {
    const config = await getDynamoDBConfig();
    console.log('[DEBUG] DynamoDB 配置:', {
      region: config.region,
      hasCredentials: !!config.credentials
    });
    
    const client = new DynamoDBClient(config);
    return DynamoDBDocumentClient.from(client);
  } catch (error) {
    console.error('[ERROR] DynamoDB 客户端创建失败:', error);
    throw error;
  }
}

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
    const docClient = await createDynamoDBClient();
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
      
      console.log('[DEBUG] 创建新线程:', {
        threadId: newThread.id,
        assistantId
      });
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
    console.log('[DEBUG] OpenAI Run 完成配置:', {
      threadId,
      runId,
      finalStatus: runStatus.status,
      completionTime: runStatus.completed_at ? new Date(runStatus.completed_at * 1000).toISOString() : null,
      usedTools: runStatus.tools?.map(t => t.type)
    });

    // 获取运行步骤以检查检索操作
    const steps = await openai.beta.threads.runs.steps.list(threadId, runId);
    const retrievalSteps = steps.data.filter(step => 
      (step.step_details as any).type === 'retrieval'
    );

    console.log('[DEBUG] Vector Store 检索详情:', {
      threadId,
      runId,
      retrievalStepsCount: retrievalSteps.length,
      retrievalSteps: retrievalSteps.map(step => ({
        id: step.id,
        type: (step.step_details as any).type,
        status: step.status,
        tokens: step.usage?.total_tokens
      }))
    });
  }
  
  if (attempts >= maxAttempts) {
    throw new Error('请求处理超时，请稍后重试');
  }
  
  return runStatus;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function POST(request: Request) {
  try {
    const { message, threadId, userId, config } = await request.json();
    
    console.log('[DEBUG] 聊天请求参数:', {
      messageLength: message?.length,
      threadId,
      userId,
      config: {
        type: config?.type,
        assistantId: config?.assistantId,
        vectorStoreId: config?.vectorStoreId
      }
    });

    // 验证助手前
    console.log('[DEBUG] 开始验证助手:', {
      assistantId: config?.assistantId,
      apiKeySuffix: process.env.OPENAI_API_KEY?.slice(-4)
    });

    // 验证助手
    try {
      const assistant = await openai.beta.assistants.retrieve(config.assistantId);
      console.log('[DEBUG] 助手验证成功:', {
        id: assistant.id,
        name: assistant.name,
        model: assistant.model,
        created_at: new Date(assistant.created_at * 1000).toISOString()
      });
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

    // 创建或获取线程前
    console.log('[DEBUG] 准备处理线程:', {
      existingThreadId: threadId,
      userId,
      configType: config?.type
    });

    // 发送消息前
    console.log('[DEBUG] 准备发送消息:', {
      threadId,
      messageLength: message?.length,
      assistantId: config?.assistantId
    });

    // 运行助手前
    console.log('[DEBUG] 准备运行助手:', {
      threadId,
      assistantId: config?.assistantId,
      runConfig: {
        model: config?.model,
        tools: config?.tools
      }
    });

    let activeThreadId = threadId;
    let thread;

    // 如果提供了现有线程ID，先尝试获取
    if (threadId) {
      try {
        console.log('[DEBUG] 尝试获取现有线程:', threadId);
        thread = await openai.beta.threads.retrieve(threadId);
        activeThreadId = threadId;
        console.log('[DEBUG] 成功获取现有线程:', {
          threadId: thread.id,
          created: thread.created_at,
          metadata: thread.metadata
        });
      } catch (error) {
        console.warn('[WARN] 获取现有线程失败，将创建新线程:', error);
      }
    }

    // 如果没有现有线程或获取失败，创建新线程
    if (!thread) {
      console.log('[DEBUG] 创建新线程');
      thread = await openai.beta.threads.create({
        metadata: {
          userId,
          type: config.type,
          assistantId: config.assistantId,
          vectorStoreId: config.vectorStoreId
        }
      });
      activeThreadId = thread.id;
      console.log('[DEBUG] 新线程创建成功:', {
        threadId: thread.id,
        metadata: thread.metadata
      });
    }

    // 添加用户消息
    console.log('[DEBUG] 添加用户消息到线程:', {
      threadId: activeThreadId,
      messageLength: message.length
    });

    await openai.beta.threads.messages.create(activeThreadId, {
      role: 'user',
      content: message
    });

    // 运行助手
    console.log('[DEBUG] 开始运行助手:', {
      threadId: activeThreadId,
      assistantId: config.assistantId
    });

    const run = await openai.beta.threads.runs.create(activeThreadId, {
      assistant_id: config.assistantId
    });

    // 等待运行完成
    let runStatus = await openai.beta.threads.runs.retrieve(
      activeThreadId,
      run.id
    );

    console.log('[DEBUG] 等待助手响应:', {
      runId: run.id,
      status: runStatus.status
    });

    while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(
        activeThreadId,
        run.id
      );
      console.log('[DEBUG] 运行状态更新:', {
        runId: run.id,
        status: runStatus.status
      });
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

    console.log('[DEBUG] 获取到助手回复:', {
      threadId: activeThreadId,
      replyLength: assistantReply.length,
      messageId: lastMessage.id
    });

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
