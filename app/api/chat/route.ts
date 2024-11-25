import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import OpenAI from 'openai';

const REGION = process.env.NEXT_PUBLIC_REGION || "us-east-2";
const IDENTITY_POOL_ID = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!;
const isDev = process.env.NODE_ENV === 'development';

// 获取未认证凭证
const getUnAuthCredentials = () => {
  console.log('[DEBUG] 尝试获取未认证凭证');
  return fromCognitoIdentityPool({
    clientConfig: { region: REGION },
    identityPoolId: IDENTITY_POOL_ID
  })();
};

// 获取 DynamoDB 配置
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
  
  const credentials = await getUnAuthCredentials();
  return {
    region: REGION,
    credentials
  };
}

// 直接从环境变量获取配置
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const OPENAI_ORG_ID = process.env.OPENAI_ORG_ID?.trim();

// 创建 OpenAI 客户端工厂函数
function createOpenAIClient() {
  console.log('[DEBUG] OpenAI 配置检查:', {
    apiKey: OPENAI_API_KEY ? '存在' : '缺失',
    orgId: OPENAI_ORG_ID ? '存在' : '缺失'
  });

  // 首先检查配置
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API Key 缺失');
  }

  // 创建并返回客户端 (不再强制要求 organization)
  return new OpenAI({
    apiKey: OPENAI_API_KEY,
    ...(OPENAI_ORG_ID && { organization: OPENAI_ORG_ID })
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, message } = body;

    console.log('[DEBUG] 收到 POST 请求:', { userId, message });

    if (!userId || !message) {
      return new Response(JSON.stringify({ error: 'Missing userId or message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 创建 OpenAI 客户端
    try {
      console.log('[DEBUG] 初始化 OpenAI 客户端...');
      const openai = createOpenAIClient();
      console.log('[DEBUG] OpenAI 客户端初始化成功');

      // 调用 OpenAI API
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "你是一个友好的AI助手，名叫国度AI（AI 4Kingdom）。请用简洁、专业的方式回答问题。"
          },
          {
            role: "user",
            content: message
          }
        ],
        temperature: 0.7,
        max_tokens: 500
      });

      console.log('[DEBUG] OpenAI API 调用成功');
      const botReply = completion.choices[0]?.message?.content || "抱歉，我���在无法回答。";

      // 保存到 DynamoDB
      const dbConfig = await getDynamoDBConfig();
      const client = new DynamoDBClient(dbConfig);
      const docClient = DynamoDBDocumentClient.from(client);
      
      const timestamp = new Date().toISOString();
      
      const chatItem = {
        UserId: userId,
        Timestamp: timestamp,
        Message: JSON.stringify({
          userMessage: message,
          botReply: botReply
        })
      };

      await docClient.send(new PutCommand({
        TableName: "ChatHistory",
        Item: chatItem
      }));

      return new Response(JSON.stringify({ reply: botReply }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (apiError) {
      console.error('[ERROR] OpenAI 相关错误:', {
        error: apiError,
        message: apiError instanceof Error ? apiError.message : String(apiError),
        stack: apiError instanceof Error ? apiError.stack : undefined
      });
      
      return new Response(JSON.stringify({
        error: 'OpenAI Error',
        details: apiError instanceof Error ? apiError.message : '调用 OpenAI API 失败'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('[ERROR] 请求处理错误:', error);
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      details: error instanceof Error ? error.message : '未知错误'
    }), {
      status: 500,
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
    
    const dbConfig = await getDynamoDBConfig();
    const client = new DynamoDBClient(dbConfig);
    const docClient = DynamoDBDocumentClient.from(client);

    console.log('[DEBUG] 执行 DynamoDB 查询');
    
    const command = new QueryCommand({
      TableName: "ChatHistory",
      KeyConditionExpression: "UserId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      }
    });

    const response = await docClient.send(command);
    console.log('[DEBUG] DynamoDB 响应:', JSON.stringify(response, null, 2));

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
