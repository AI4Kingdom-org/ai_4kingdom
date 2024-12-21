import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import OpenAI from 'openai';
import { promises as fs } from 'fs';

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

// 直接从环境变量获取配置
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const OPENAI_ORG_ID = process.env.OPENAI_ORG_ID?.trim();

// 创建 OpenAI 客户端工厂函数
function createOpenAIClient() {
  console.log('[DEBUG] OpenAI 配置检查:', {
    apiKey: OPENAI_API_KEY ? '存在' : '缺失',
    orgId: OPENAI_ORG_ID ? '存在' : '缺失'
  });

  // 先检查配置
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API Key 缺失');
  }

  // 创建并返回客户端 (不再强制要求 organization)
  return new OpenAI({
    apiKey: OPENAI_API_KEY,
    ...(OPENAI_ORG_ID && { organization: OPENAI_ORG_ID })
  });
}

export const runtime = 'edge'; // 使用边缘运行时
const TIMEOUT = 25000; // 25 秒

const createDynamoDBClient = () => {
  const client = new DynamoDBClient(dbConfig);
  return DynamoDBDocumentClient.from(client);
};

async function chatLogic(request: Request) {
  const docClient = createDynamoDBClient();
  
  try {
    const { userId, message } = await request.json();
    if (!userId || !message) {
      throw new Error('Missing required fields');
    }
    
    console.log('[DEBUG] 初始化 OpenAI 客户端...');
    const openai = createOpenAIClient();
    console.log('[DEBUG] OpenAI 客户端初始化成功');

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: "你是一个友好的AI助手。" },
        { role: "user", content: message }
      ],
      max_tokens: 1000,
      temperature: 0.7,
    }, {
      timeout: 20000
    });

    const botReply = completion.choices[0]?.message?.content || '抱歉，我现在无法回答。';
    
    // 存储对话记录
    const chatRecord = {
      userMessage: message,
      botReply: botReply
    };

    const command = new PutCommand({
      TableName: "ChatHistory",
      Item: {
        UserId: String(userId),
        Timestamp: new Date().toISOString(),
        Message: JSON.stringify(chatRecord)
      }
    });

    await docClient.send(command);

    return new Response(JSON.stringify({ reply: botReply }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    if (error instanceof Error) {
      console.error('[ERROR]:', error.message);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Request timeout')), TIMEOUT);
  });

  try {
    const result = await Promise.race([
      chatLogic(request),
      timeoutPromise
    ]);
    return result;
  } catch (error) {
    console.error('[ERROR] 请求超时或出错:', error);
    return new Response(JSON.stringify({ error: '请求超时，请重试' }), {
      status: 504,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

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
        ":userId": userId
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
