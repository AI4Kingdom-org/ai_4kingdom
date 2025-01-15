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

// 添加新的函数来处理 UserThreads 表操作
async function getUserActiveThread(userId: string) {
  const docClient = await createDynamoDBClient();
  const command = new GetCommand({
    TableName: "UserThreads",
    Key: { 
      "UserId": String(userId)
    }
  });
  const response = await docClient.send(command);
  return response.Item?.activeThreadId;
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

async function waitForCompletion(openai: OpenAI, threadId: string, runId: string, maxAttempts = 20) {
  let attempts = 0;
  let runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);
  
  while (runStatus.status !== 'completed' && attempts < maxAttempts) {
    if (runStatus.status === 'failed') {
      throw new Error('Assistant run failed');
    }
    
    // 使用指数退避策略
    const delay = Math.min(1000 * Math.pow(1.5, attempts), 5000);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    attempts++;
    runStatus = await openai.beta.threads.runs.retrieve(threadId, runId);
    
    // 记录状态变化
    console.log(`[DEBUG] Run status: ${runStatus.status}, attempt: ${attempts}`);
  }
  
  if (attempts >= maxAttempts) {
    throw new Error('Operation timed out');
  }
  
  return runStatus;
}

// 修改 POST 处理函数
export const POST = withErrorHandler(async (request: Request) => {
  const origin = request.headers.get('origin');
  const headers = setCORSHeaders(origin);
  
  try {
    const { userId, message } = await request.json();
    const docClient = await createDynamoDBClient();
    
    // 1. 初始化 OpenAI 客户端
    const openai = createOpenAIClient();
    
    // 2. 获取或创建 thread
    let threadId = await getUserActiveThread(userId);
    let thread;
    
    if (threadId) {
      // 使用现有 thread
      thread = await openai.beta.threads.retrieve(threadId);
      // 添加新消息到现有 thread
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: message
      });
    } else {
      // 创建新的 thread
      thread = await openai.beta.threads.create({
        messages: [{ role: "user", content: message }]
      });
      // 保存新的 threadId
      await updateUserActiveThread(userId, thread.id);
      threadId = thread.id;
    }

    // 3. 获取 vector store ID 和 prompt
    const vector_store_id = process.env.NEXT_PUBLIC_VECTOR_STORE_ID || 'vs_AMJIJ1zfGnzHpI1msv4T8Ww3';
    const promptContent = await getPromptFromDB(vector_store_id);

    // 4. 创建 assistant
    const assistant = await openai.beta.assistants.create({
      name: "Research Assistant",
      instructions: promptContent,
      model: "gpt-4-turbo",
      tools: [{ type: "file_search" }]
    });

    // 5. 更新 assistant 的 tool resources
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

    // 6. 运行助手
    const run = await openai.beta.threads.runs.create(
      threadId,
      { assistant_id: assistant.id }
    );

    // 7. 等待运行完成
    try {
      const runStatus = await waitForCompletion(openai, threadId, run.id);
      // 处理响应...
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'Operation timed out') {
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

    // 8. 获取助手回复
    const messages = await openai.beta.threads.messages.list(threadId);
    const lastMessage = messages.data.find(msg => msg.role === 'assistant');
    const botReply = lastMessage?.content
      .filter(content => content.type === 'text')
      .map(content => (content.type === 'text' ? content.text.value : ''))
      .join('\n') || '抱歉，我现在无法回答。';

    // 9. 储存对话记录
    await docClient.send(new PutCommand({
      TableName: CONFIG.tableName,
      Item: {
        UserId: String(userId),
        Timestamp: new Date().toISOString(),
        Message: JSON.stringify({
          userMessage: message,
          botReply: botReply.trim(),
          threadId: threadId
        })
      }
    }));

    return new Response(JSON.stringify({ 
      reply: botReply.trim(),
      threadId: threadId
    }), { headers });
    
  } catch (error) {
    console.error('[ERROR] 处理请求失败:', error);
    return new Response(JSON.stringify({
      error: '处理失败',
      details: error instanceof Error ? error.message : '未知错误'
    }), { 
      status: 500, 
      headers 
    });
  }
});

// GET 处理函数
export async function GET(request: Request) {
  const origin = request.headers.get('origin');
  const headers = setCORSHeaders(origin);
  
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return new Response(JSON.stringify({ error: "UserId is required" }), {
      status: 400,
      headers
    });
  }

  try {
    const docClient = await createDynamoDBClient();
    const response = await docClient.send(new QueryCommand({
      TableName: CONFIG.tableName,
      KeyConditionExpression: "UserId = :userId",
      ExpressionAttributeValues: {
        ":userId": String(userId)
      }
    }));

    return new Response(JSON.stringify(response.Items), { headers });
  } catch (error) {
    console.error('[ERROR] 获取聊天历史失败:', error);
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
