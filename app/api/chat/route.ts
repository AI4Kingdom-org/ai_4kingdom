import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import OpenAI from 'openai';
import { NextResponse } from 'next/server';
import { ASSISTANT_ID } from '@/app/config/constants';
import { saveTokenUsage } from '@/app/utils/tokenUsage';
import { updateMonthlyTokenUsage } from '@/app/utils/monthlyTokenUsage';

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

// OpenAI 配置和客户端创建
function createOpenAIClient() {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
  const OPENAI_ORG_ID = process.env.OPENAI_ORG_ID?.trim();

  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API Key 缺失');
  }

  return new OpenAI({
    apiKey: OPENAI_API_KEY,
    ...(OPENAI_ORG_ID && { organization: OPENAI_ORG_ID })
  });
}

// 添加错误处理中间件
const withErrorHandler = (handler: Function) => async (request: Request) => {
  try {
    return await handler(request);
  } catch (error) {
    console.error('[ERROR]:', error);
    return new Response(
      JSON.stringify({
        error: '请求处理失败',
        message: error instanceof Error ? error.message : '未知错误',
        code: error instanceof Error ? error.name : 'UNKNOWN_ERROR'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
};

// 添加获取 Prompt 的函数
async function getPromptFromDB(vectorStoreId: string) {
  try {
    const docClient = await createDynamoDBClient();
    const command = new GetCommand({
      TableName: "AIPrompts",
      Key: { id: vectorStoreId }
    });

    const response = await docClient.send(command);
    return response.Item?.content || "You are an AI assistant specializing in home schooling...";
  } catch (error) {
    console.error('[ERROR] 获取Prompt失败:', error);
    // 如果获取失败，返回默认 prompt
    return "You are an AI assistant specializing in home schooling...";
  }
}

const MAX_MESSAGES_PER_THREAD = 10;  // 每个线程最多保留10条消息
const THREAD_MAX_AGE = 30 * 60 * 1000;  // 线程最大存活时间30分钟

async function shouldCreateNewThread(threadId: string, userId: string, openai: OpenAI) {
  try {
    const docClient = await createDynamoDBClient();
    
    // 获取当前线程的消息数量
    const messages = await openai.beta.threads.messages.list(threadId);
    const messageCount = messages.data.length;
    
    console.log('[DEBUG] 当前线程状态:', {
      threadId,
      messageCount,
      maxMessages: MAX_MESSAGES_PER_THREAD
    });

    // 如果消息数量超过限制，返回true以创建新线程
    if (messageCount >= MAX_MESSAGES_PER_THREAD) {
      console.log('[DEBUG] 消息数量超过限制，将创建新线程');
      return true;
    }

    // 获取线程创建时间
    const thread = await openai.beta.threads.retrieve(threadId);
    const threadAge = Date.now() - new Date(thread.created_at * 1000).getTime();
    
    // 如果线程时间过长，返回true以创建新线程
    if (threadAge > THREAD_MAX_AGE) {
      console.log('[DEBUG] 线程时间超过限制，将创建新线程');
      return true;
    }

    return false;
  } catch (error) {
    console.error('[ERROR] 检查线程状态失败:', error);
    return true;  // 出错时创建新线程
  }
}

// 修改现有的 getUserActiveThread 函数
async function getUserActiveThread(userId: string, openai: OpenAI): Promise<string> {
  try {
    const docClient = await createDynamoDBClient();
    const command = new QueryCommand({
      TableName: CONFIG.tableName,
      IndexName: 'UserTypeIndex',  // 使用 GSI
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
    
    // 获取最新的线程
    const latestThread = response.Items?.[0];
    const threadId = latestThread?.threadId;
    
    if (!threadId) {
      // 如果没有现有线程，创建新线程
      const newThread = await openai.beta.threads.create();
      
      await docClient.send(new PutCommand({
        TableName: CONFIG.tableName,
        Item: {
          UserId: String(userId),
          Type: 'thread',
          threadId: newThread.id,
          Timestamp: new Date().toISOString()
        }
      }));
      
      console.log('[DEBUG] 创建首个线程:', newThread.id);
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
    const { userId, message, threadId } = await request.json();
    
    console.log('[DEBUG] 接收到聊天请求:', { 
      userId, 
      messageLength: message.length, 
      threadId
    });

    // 如果没有 threadId，创建新的线程并保存到 DynamoDB
    let activeThreadId = threadId;
    if (!activeThreadId) {
      console.log('[DEBUG] 未提供 threadId，创建新线程');
      const newThread = await openai.beta.threads.create();
      activeThreadId = newThread.id;

      // 保存新线程到 DynamoDB
      const docClient = await createDynamoDBClient();
      await docClient.send(new PutCommand({
        TableName: CONFIG.tableName,
        Item: {
          UserId: String(userId),
          Timestamp: new Date().toISOString(),
          Type: 'thread',
          threadId: activeThreadId
        }
      }));
      
      console.log('[DEBUG] 新线程已创建并保存:', { threadId: activeThreadId });
    }

    // 发送消息到 OpenAI
    await openai.beta.threads.messages.create(activeThreadId, {
      role: 'user',
      content: message
    });

    // 运行助手并获取使用情况
    const run = await openai.beta.threads.runs.create(activeThreadId, {
      assistant_id: ASSISTANT_ID
    });

    // 等待运行完成
    let runStatus = await waitForCompletion(openai, activeThreadId, run.id);

    // 获取所有运行步骤的使用情况
    const runSteps = await openai.beta.threads.runs.steps.list(activeThreadId, run.id);
    
    // 累计所有步骤的 token 使用情况
    let totalTokenUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      retrieval_tokens: 0,  // 新增：检索相关的 token
    };

    // 遍历所有步骤，累计 token 使用情况
    for (const step of runSteps.data) {
      if (step.step_details.type === 'message_creation') {
        totalTokenUsage.prompt_tokens += step.usage?.prompt_tokens || 0;
        totalTokenUsage.completion_tokens += step.usage?.completion_tokens || 0;
        totalTokenUsage.total_tokens += step.usage?.total_tokens || 0;
      }
      
      // 记录检索相关的 token
      if ((step.step_details as any).type === 'retrieval') {
        totalTokenUsage.retrieval_tokens += step.usage?.total_tokens || 0;
        console.log('[DEBUG] 文件检索 Token:', {
          stepId: step.id,
          retrievalTokens: step.usage?.total_tokens || 0
        });
      }
    }

    // 获取助手的回复
    const messages = await openai.beta.threads.messages.list(activeThreadId);
    const lastMessage = messages.data[0];
    const assistantReply = lastMessage.content
      .filter(content => content.type === 'text')
      .map(content => (content.type === 'text' ? content.text.value : ''))
      .join('\n');

    // 保存完整的 token 使用记录
    await saveTokenUsage(userId, activeThreadId, {
      prompt_tokens: totalTokenUsage.prompt_tokens,
      completion_tokens: totalTokenUsage.completion_tokens,
      total_tokens: totalTokenUsage.total_tokens + totalTokenUsage.retrieval_tokens,
      retrieval_tokens: totalTokenUsage.retrieval_tokens
    });

    // 更新月度使用统计
    await updateMonthlyTokenUsage(userId, totalTokenUsage);
    
    console.log('[DEBUG] 完整Token使用情况:', totalTokenUsage);
    
    return NextResponse.json({
      reply: assistantReply,
      threadId: activeThreadId,  // 返回可能是新创建的 threadId
      usage: totalTokenUsage
    });

  } catch (error) {
    console.error('[ERROR] 处理聊天请求失败:', error);
    return NextResponse.json({ error: '发送失败' }, { status: 500 });
  }
}

// 添加新的消息获取函数
async function getThreadMessages(threadId: string, openai: OpenAI) {
  try {
    console.log('[DEBUG] 开始获取OpenAI消息:', { threadId });
    
    const messages = await openai.beta.threads.messages.list(threadId);
    
    console.log('[DEBUG] 获取到原始消息:', { 
      count: messages.data.length 
    });
    
    const sortedMessages = messages.data.sort((a, b) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    
    const formattedMessages = sortedMessages.map(msg => ({
      role: msg.role,
      content: msg.content[0].type === 'text' 
        ? msg.content[0].text.value 
        : '',
      timestamp: new Date(msg.created_at * 1000).toISOString()
    }));

    console.log('[DEBUG] 消息格式化完成:', { 
      formattedCount: formattedMessages.length 
    });

    return formattedMessages;
  } catch (error) {
    console.error('[ERROR] 获取Thread消息失败:', error);
    throw error;
  }
}

// 使用已创建的实例
async function getOpenAIHistory(userId: string) {
  try {
    console.log('[DEBUG] 开始获取OpenAI历史记录:', { userId });
    
    const threadId = await getUserActiveThread(userId, openai);
    if (!threadId) {
      console.log('[DEBUG] 未找到活动线程');
      return [];
    }
    
    const messages = await getThreadMessages(threadId, openai);
    
    // 转换为应用程序使用的格式
    const formattedMessages = messages.map(msg => ({
      Message: JSON.stringify({
        userMessage: msg.role === 'user' ? msg.content : '',
        botReply: msg.role === 'assistant' ? msg.content : ''
      }),
      Timestamp: msg.timestamp,
      UserId: userId
    }));

    console.log('[DEBUG] 历史记录格式化完成:', { 
      count: formattedMessages.length 
    });

    return formattedMessages;
  } catch (error) {
    console.error('[ERROR] 获取OpenAI历史记录失败:', error);
    throw error;
  }
}

// 修改现有的 GET 处理函数
export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  const headers = setCORSHeaders(origin);
  
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return new Response(JSON.stringify({ error: "UserId is required" }), {
        status: 400,
        headers
      });
    }

    // 添加详细的错误日志
    console.log('[DEBUG] 开始获取聊天历史:', {
      userId,
      tableName: CONFIG.tableName
    });

    const docClient = await createDynamoDBClient();
    
    // 修改查询逻辑
    const command = new QueryCommand({
      TableName: CONFIG.tableName,
      IndexName: 'UserTypeIndex',  // 使用 GSI
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
    
    console.log('[DEBUG] DynamoDB响应:', {
      itemCount: response.Items?.length,
      scannedCount: response.ScannedCount
    });

    return new Response(JSON.stringify(response.Items || []), { headers });
    
  } catch (error) {
    console.error('[ERROR] 获取聊天历史失败:', {
      error: error instanceof Error ? error.message : '未知错误',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return new Response(JSON.stringify({
      error: '获取聊天历史失败',
      details: error instanceof Error ? error.message : '未知错误'
    }), {
      status: 500,
      headers
    });
  }
}

// 添加 OPTIONS 处理
export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  const headers = setCORSHeaders(origin);
  
  return new Response(null, {
    status: 204,
    headers
  });
}
