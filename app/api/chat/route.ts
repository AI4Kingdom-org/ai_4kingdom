import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import { fetchAuthSession } from 'aws-amplify/auth';
import OpenAI from 'openai';
import { Amplify } from 'aws-amplify';

const REGION = process.env.NEXT_PUBLIC_REGION || "us-east-2";
const IDENTITY_POOL_ID = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  organization: process.env.OPENAI_ORG_ID
});

const isDev = process.env.NODE_ENV === 'development';

// 创建一个未认证的身份池凭证
const getUnAuthCredentials = () => {
  console.log('[DEBUG] 尝试获取未认证凭证');
  return fromCognitoIdentityPool({
    clientConfig: { region: REGION },
    identityPoolId: IDENTITY_POOL_ID
  })();
};

// 修改为异步配置函数
async function getDynamoDBConfig() {
  if (isDev) {
    return {
      region: 'local',
      endpoint: 'http://localhost:8000',
      credentials: {
        accessKeyId: 'local',
        secretAccessKey: 'local'
      }
    };
  }
  
  const credentials = await getUnAuthCredentials();
  console.log('[DEBUG] 获取到未认证凭证:', {
    hasAccessKeyId: !!credentials.accessKeyId,
    hasSecretAccessKey: !!credentials.secretAccessKey,
    hasSessionToken: !!credentials.sessionToken
  });
  
  return {
    region: REGION,
    credentials
  };
}

async function getCredentials() {
  try {
    console.log('[DEBUG] 开始获取凭证...');
    const session = await fetchAuthSession();
    console.log('[DEBUG] 原始 session:', JSON.stringify(session, null, 2));
    
    if (!session.credentials) {
      console.log('[DEBUG] 没有找到 session 凭证，使用未认证凭证');
      return await getUnAuthCredentials();
    }
    
    return session.credentials;
  } catch (error) {
    console.error('[ERROR] 获取凭证失败:', error);
    console.log('[DEBUG] 使用未认证凭证作为后备');
    return await getUnAuthCredentials();
  }
}

async function getChatHistory(userId: string) {
  try {
    const config = await getDynamoDBConfig();
    console.log('[DEBUG] DynamoDB 配置:', {
      region: config.region,
      hasCredentials: !!config.credentials
    });
    
    const client = new DynamoDBClient(config);
    const docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      }
    });
    
    const params = {
      TableName: "ChatHistory",
      KeyConditionExpression: "UserId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      }
    };
    
    console.log('[DEBUG] DynamoDB 查询参数:', JSON.stringify(params, null, 2));

    const command = new QueryCommand(params);
    const response = await docClient.send(command);
    
    console.log('[DEBUG] DynamoDB 响应:', JSON.stringify(response, null, 2));
    
    if (!response.Items) {
      console.log('[DEBUG] 没有找到聊天记录');
      return [];
    }
    
    return response.Items;
    
  } catch (error) {
    console.error('[ERROR] DynamoDB 查询错误:', {
      error,
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

// 在路由处理器之前添加配置
Amplify.configure({
  Auth: {
    Cognito: {
      identityPoolId: 'us-east-2:e39629e5-24d5-45b7-8fff-1c2b219a9a7b',
      userPoolId: 'us-east-2_covgiAC78',
      userPoolClientId: '2uhbcgreed9lkahgrlh9b9bn7k'
    }
  }
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    
    console.log('[DEBUG] GET 请求开始, 参数:', { userId });
    
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing userId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const config = await getDynamoDBConfig();
    const client = new DynamoDBClient(config);
    const docClient = DynamoDBDocumentClient.from(client);
    
    const command = new QueryCommand({
      TableName: "ChatHistory",
      KeyConditionExpression: "UserId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      }
    });

    console.log('[DEBUG] 执行 DynamoDB 查询');
    const response = await docClient.send(command);
    console.log('[DEBUG] DynamoDB 响应:', JSON.stringify(response, null, 2));

    return new Response(JSON.stringify(response.Items || []), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[ERROR] 顶层错误:', {
      error,
      type: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      details: error instanceof Error ? error.message : '服务器错误',
      type: error instanceof Error ? error.constructor.name : typeof error
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 添加 POST 方法处理
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

    // 检查环境变量是否已配置
    if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ORG_ID) {
      console.error('[ERROR] OpenAI 配置缺失');
      return new Response(JSON.stringify({
        error: 'Configuration Error',
        details: 'OpenAI configuration is missing'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 调用 OpenAI ChatGPT API
    try {
      console.log('[DEBUG] 开始调用 OpenAI API');
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
      const botReply = completion.choices[0]?.message?.content || "抱歉，我现在无法回答。";

      // 保存对话记录到 DynamoDB
      const config = await getDynamoDBConfig();
      const client = new DynamoDBClient(config);
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

      const putCommand = {
        TableName: "ChatHistory",
        Item: chatItem
      };

      await docClient.send(new PutCommand(putCommand));

      return new Response(JSON.stringify({ reply: botReply }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (openaiError) {
      console.error('[ERROR] OpenAI API 调用失败:', {
        error: openaiError,
        message: openaiError instanceof Error ? openaiError.message : String(openaiError),
        type: openaiError instanceof Error ? openaiError.constructor.name : typeof openaiError
      });
      
      return new Response(JSON.stringify({
        error: 'OpenAI API Error',
        details: openaiError instanceof Error ? openaiError.message : '调用 AI 服务失败',
        type: openaiError instanceof Error ? openaiError.constructor.name : typeof openaiError
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('[ERROR] POST 请求处理错误:', {
      error,
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      details: error instanceof Error ? error.message : '未知错误'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
