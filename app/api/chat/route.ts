import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import OpenAI from 'openai';

const REGION = process.env.NEXT_PUBLIC_REGION || "us-east-2";
const IDENTITY_POOL_ID = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!;
const isDev = process.env.NODE_ENV === 'development';

// 添加在文件顶部其他导入语句下方
async function getDynamoDBConfig() {
  if (isDev) {
    return {
      region: REGION,
      credentials: {
        accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY!,
        secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_KEY!
      }
    };
  }
  
  const credentials = await fromCognitoIdentityPool({
    clientConfig: { region: REGION },
    identityPoolId: IDENTITY_POOL_ID
  })();

  return {
    region: REGION,
    credentials
  };
}

// 先打印所有环境变量（仅开发调试用）
console.log('[DEBUG] 所有环境变量:', {
  ...process.env,
  NEXT_PUBLIC_AWS_SECRET_KEY: '已设置'  // 不打印实际值
});

// 详细的环境变量检查
const envCheck = {
  accessKey: process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
  secretKey: process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
  region: process.env.NEXT_PUBLIC_REGION || 'us-east-2',
  allEnvs: Object.keys(process.env)
};

console.log('[DEBUG] 详细环境变量检查:', {
  ...envCheck,
  secretKey: envCheck.secretKey ? '已设置' : undefined,
  accessKey: envCheck.accessKey ? '已设置' : undefined
});

if (!envCheck.accessKey || !envCheck.secretKey) {
  console.error('[ERROR] AWS 凭证缺失:', {
    accessKeyExists: !!envCheck.accessKey,
    secretKeyExists: !!envCheck.secretKey
  });
  throw new Error('AWS credentials missing');
}

const dbConfig = {
  region: envCheck.region,
  credentials: {
    accessKeyId: envCheck.accessKey,
    secretAccessKey: envCheck.secretKey
  }
};

console.log('[DEBUG] DynamoDB 配置:', {
  region: dbConfig.region,
  hasCredentials: !!dbConfig.credentials
});

const client = new DynamoDBClient(dbConfig);
const docClient = DynamoDBDocumentClient.from(client);

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

// POST 处理函数
export const POST = withErrorHandler(async (request: Request) => {
  try {
    const { userId, message } = await request.json();
    console.log('[DEBUG] 收到用户消息:', { userId, message });

    // 1. 初始化 OpenAI 客户端
    const openai = createOpenAIClient();
    console.log('[DEBUG] OpenAI 客户端初始化成功');

    // 2. 获取 vector store ID
    const vector_store_id = process.env.NEXT_PUBLIC_VECTOR_STORE_ID || 'vs_AMJIJ1zfGnzHpI1msv4T8Ww3';
    if (!vector_store_id) {
      throw new Error('Vector store ID 配置缺失');
    }

    // 3. 获取存储的 prompt
    const promptContent = await getPromptFromDB(vector_store_id);
    console.log('[DEBUG] 获取到的 Prompt:', promptContent);

    // 4. 创建或获取 assistant，使用获取到的 prompt
    const assistant = await openai.beta.assistants.create({
      name: "Research Assistant",
      instructions: promptContent, // 使用从数据库获取的 prompt
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

    // 6. 创建对话线程
    const thread = await openai.beta.threads.create({
      messages: [{ role: "user", content: message }]
    });

    // 7. 运行助手
    const run = await openai.beta.threads.runs.create(
      thread.id,
      { assistant_id: assistant.id }
    );

    // 8. 等待运行完成
    let runStatus = await openai.beta.threads.runs.retrieve(
      thread.id,
      run.id
    );

    while (runStatus.status !== 'completed') {
      if (runStatus.status === 'failed') {
        throw new Error('Assistant run failed');
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(
        thread.id,
        run.id
      );
    }

    // 9. 获取助手回复
    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessage = messages.data.find(msg => msg.role === 'assistant');
    const botReply = lastMessage?.content
      .filter(content => content.type === 'text')
      .map(content => (content.type === 'text' ? content.text.value : ''))
      .join('\n') || '抱歉，我现在无法回答。';

    // 10. 储存对话记录
    const timestamp = new Date().toISOString();
    const chatItem = {
      UserId: String(userId),
      Timestamp: timestamp,
      Message: JSON.stringify({
        userMessage: message,
        botReply: botReply.trim(),
        threadId: thread.id,
        assistantId: assistant.id
      })
    };

    const dbConfig = await getDynamoDBConfig();
    const client = new DynamoDBClient(dbConfig);
    const docClient = DynamoDBDocumentClient.from(client);

    await docClient.send(new PutCommand({
      TableName: "ChatHistory",
      Item: chatItem
    }));

    // 11. 返回响应
    return new Response(JSON.stringify({ 
      reply: botReply.trim(),
      threadId: thread.id
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[ERROR]:', error);
    return new Response(JSON.stringify({
      error: '处理失败',
      details: error instanceof Error ? error.message : '未知错误'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// 添加 GET 方法处理历史记录查询
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return new Response(JSON.stringify({ error: "UserId is required" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    console.log('[DEBUG] GET 请求开始, 参数:', { userId });
    
    const command = new QueryCommand({
      TableName: "ChatHistory",
      KeyConditionExpression: "UserId = :userId",
      ExpressionAttributeValues: {
        ":userId": String(userId)
      }
    });

    const response = await docClient.send(command);
    console.log('[DEBUG] DynamoDB 应:', JSON.stringify(response, null, 2));

    const items = response.Items?.map(item => ({
      UserId: item.UserId,
      Timestamp: item.Timestamp,
      Message: item.Message
    })) || [];

    return new Response(JSON.stringify(items), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[ERROR] 获取聊天历史失败:', error);
    return new Response(JSON.stringify({
      error: "Failed to fetch chat history",
      details: error instanceof Error ? error.message : '未知错误'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
