import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import OpenAI from 'openai';

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
    const response = await docClient.send(new GetCommand({
      TableName: CONFIG.tableName,
      Key: {
        UserId: String(userId),
        Type: 'thread'
      }
    }));

    const threadId = response.Item?.threadId;
    
    if (threadId && await shouldCreateNewThread(threadId, userId, openai)) {
      // 创建新线程
      const newThread = await openai.beta.threads.create();
      
      // 保存新线程ID
      await docClient.send(new PutCommand({
        TableName: CONFIG.tableName,
        Item: {
          UserId: String(userId),
          Type: 'thread',
          threadId: newThread.id,
          createdAt: new Date().toISOString()
        }
      }));
      
      console.log('[DEBUG] 已创建新线程:', newThread.id);
      return newThread.id;
    }

    if (!threadId) {
      // 如果没有现有线程，创建新线程
      const newThread = await openai.beta.threads.create();
      
      await docClient.send(new PutCommand({
        TableName: CONFIG.tableName,
        Item: {
          UserId: String(userId),
          Type: 'thread',
          threadId: newThread.id,
          createdAt: new Date().toISOString()
        }
      }));
      
      console.log('[DEBUG] 创建首个线程:', newThread.id);
      return newThread.id;
    }

    return threadId;
  } catch (error) {
    console.error('[ERROR] 获取用户线程失败:', error);
    // 出错时创建新线程
    const newThread = await openai.beta.threads.create();
    console.log('[DEBUG] 错误恢复：创建新线程:', newThread.id);
    return newThread.id;
  }
}

async function updateUserActiveThread(userId: string, threadId: string) {
  const docClient = await createDynamoDBClient();
  const command = new PutCommand({
    TableName: "UserThreads",
    Item: {
      "UserId": String(userId),
      "activeThreadId": threadId
    }
  });
  return docClient.send(command);
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

// 修改 POST 处理函数
export const POST = withErrorHandler(async (request: Request) => {
  const origin = request.headers.get('origin');
  const headers = setCORSHeaders(origin);
  
  console.log('[DEBUG] 开始处理POST请求:', {
    origin,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries())
  });
  
  try {
    const { userId, message } = await request.json();
    console.log('[DEBUG] 解析请求数据:', {
      userId,
      messageLength: message?.length
    });

    const docClient = await createDynamoDBClient();
    const openai = createOpenAIClient();
    
    console.log('[DEBUG] 获取用户线程');
    let threadId = await getUserActiveThread(userId, openai);
    console.log('[DEBUG] 当前线程状态:', {
      hasThread: !!threadId,
      threadId
    });
    
    let thread;
    if (threadId) {
      console.log('[DEBUG] 使用现有线程');
      thread = await openai.beta.threads.retrieve(threadId);
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: message
      });
    } else {
      console.log('[DEBUG] 创建新线程');
      thread = await openai.beta.threads.create({
        messages: [{ role: "user", content: message }]
      });
      await updateUserActiveThread(userId, thread.id);
      threadId = thread.id;
    }

    console.log('[DEBUG] 获取 Prompt');
    const vector_store_id = process.env.NEXT_PUBLIC_VECTOR_STORE_ID || 'vs_AMJIJ1zfGnzHpI1msv4T8Ww3';
    const promptContent = await getPromptFromDB(vector_store_id);

    console.log('[DEBUG] 创建 Assistant');
    const assistant = await openai.beta.assistants.create({
      name: "Research Assistant",
      instructions: promptContent,
      model: "gpt-4-turbo",
      tools: [{ type: "file_search" }]
    });

    console.log('[DEBUG] 更新 Assistant');
    await openai.beta.assistants.update(
      assistant.id,
      {
        tool_resources: {
          file_search: {
            vector_store_ids: [vector_store_id]
          }
        }
      }
    );

    console.log('[DEBUG] 创建运行');
    const run = await openai.beta.threads.runs.create(
      threadId,
      { assistant_id: assistant.id }
    );

    try {
      console.log('[DEBUG] 等待运行完成');
      const runStatus = await waitForCompletion(openai, threadId, run.id);
      console.log('[DEBUG] 运行完成状态:', runStatus.status);
      
      console.log('[DEBUG] 获取消息');
      const messages = await openai.beta.threads.messages.list(threadId);
      const lastMessage = messages.data[0];
      
      if (!lastMessage || !lastMessage.content || lastMessage.content.length === 0) {
        console.error('[ERROR] 无消息内容');
        throw new Error('无法获取助手回复');
      }

      const botReply = lastMessage.content[0].type === 'text' 
        ? lastMessage.content[0].text.value 
        : '无法解析助手回复';
      
      console.log('[DEBUG] 保存到DynamoDB前:', {
        userId,
        timestamp: new Date().toISOString(),
        messageLength: message?.length,
        replyLength: botReply?.length
      });

      await docClient.send(new PutCommand({
        TableName: "ChatHistory",
        Item: {
          UserId: String(userId),
          Timestamp: new Date().toISOString(),
          Message: JSON.stringify({
            userMessage: message,
            botReply: botReply
          })
        }
      }));

      console.log('[DEBUG] 数据已保存，准备返回响应');
      return new Response(JSON.stringify({
        reply: botReply,
        threadId: threadId
      }), { 
        status: 200,
        headers 
      });

    } catch (error) {
      console.error('[ERROR] 运行过程错误:', error);
      if (error instanceof Error && error.message.includes('超时')) {
        return new Response(JSON.stringify({ 
          error: '请求超时',
          details: '服务器响应时间过长，请稍后重试'
        }), { 
          status: 504,
          headers 
        });
      }
      throw error;
    }
    
  } catch (error) {
    console.error('[ERROR] 处理请求失败:', {
      error: error instanceof Error ? error.message : '未知错误',
      stack: error instanceof Error ? error.stack : undefined,
      type: error instanceof Error ? error.name : typeof error
    });
    
    return new Response(JSON.stringify({
      error: '处理失败',
      details: error instanceof Error ? error.message : '未知错误',
      debug: {
        timestamp: new Date().toISOString(),
        errorType: error instanceof Error ? error.name : typeof error
      }
    }), { 
      status: error instanceof Error && error.message.includes('超时') ? 504 : 500,
      headers 
    });
  }
});

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

// 创建 OpenAI 实例时添加配置
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // 如果是在 Edge Runtime 中运行，可以添加
  // dangerouslyAllowBrowser: true
});

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
  
  console.log('[DEBUG] 开始处理GET请求:', {
    origin,
    url: request.url
  });
  
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return new Response(JSON.stringify({ error: "UserId is required" }), {
      status: 400,
      headers
    });
  }

  try {
    // 从OpenAI获取历史记录
    const messages = await getOpenAIHistory(userId);
    
    console.log('[DEBUG] 返回消息数量:', {
      count: messages.length
    });

    return new Response(JSON.stringify(messages), { headers });
  } catch (error) {
    console.error('[ERROR] 获取聊天历史失败:', {
      error: error instanceof Error ? error.message : '未知错误',
      type: error instanceof Error ? error.name : typeof error
    });
    
    return new Response(JSON.stringify({
      error: "获取聊天历史失败",
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
