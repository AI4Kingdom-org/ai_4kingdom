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
});

const isDev = process.env.NODE_ENV === 'development';

const dynamoDBConfig = isDev ? {
  region: 'local',
  endpoint: 'http://localhost:8000',
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local'
  }
} : {
  region: REGION
};

// 创建一个未认证的身份池凭证
const getUnAuthCredentials = () => {
  return fromCognitoIdentityPool({
    clientConfig: { region: REGION },
    identityPoolId: IDENTITY_POOL_ID
  })();
};

async function getCredentials() {
  try {
    console.log('[DEBUG] 开始获取凭证...');
    const session = await fetchAuthSession();
    console.log('[DEBUG] 原始 session:', JSON.stringify(session, null, 2));
    console.log('[DEBUG] session 信息:', {
      hasCredentials: !!session.credentials,
      identityId: session.identityId,
      hasTokens: !!session.tokens,
      tokenDetails: session.tokens ? {
        accessToken: !!session.tokens.accessToken,
        idToken: !!session.tokens.idToken,
      } : null
    });
    
    if (!session.credentials) {
      console.log('[DEBUG] 没有找到凭证，尝试使用未认证凭证');
      const credentials = await fromCognitoIdentityPool({
        clientConfig: { region: REGION },
        identityPoolId: IDENTITY_POOL_ID
      })();
      return credentials;
    }
    
    return session.credentials;
  } catch (error) {
    console.error('[ERROR] 获取凭证失败:', {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

async function getChatHistory(userId: string) {
  try {
    const credentials = await getCredentials();
    console.log('[DEBUG] DynamoDB 凭证:', {
      hasAccessKeyId: !!credentials.accessKeyId,
      hasSecretAccessKey: !!credentials.secretAccessKey,
      hasSessionToken: !!credentials.sessionToken
    });
    
    const client = new DynamoDBClient(dynamoDBConfig);

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

    try {
      console.log('[DEBUG] 开始获取凭证');
      const credentials = await getCredentials();
      console.log('[DEBUG] 获取到凭证:', {
        hasAccessKeyId: !!credentials.accessKeyId,
        hasSecretAccessKey: !!credentials.secretAccessKey
      });

      const client = new DynamoDBClient(dynamoDBConfig);

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

    } catch (innerError) {
      console.error('[ERROR] 内部错误:', {
        error: innerError,
        type: innerError instanceof Error ? innerError.constructor.name : typeof innerError,
        message: innerError instanceof Error ? innerError.message : String(innerError),
        stack: innerError instanceof Error ? innerError.stack : undefined
      });

      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        details: innerError instanceof Error ? innerError.message : '内部服务错误',
        type: innerError instanceof Error ? innerError.constructor.name : typeof innerError
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

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

    // 调用 OpenAI ChatGPT API
    try {
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

      const botReply = completion.choices[0]?.message?.content || "抱歉，我现在无法回答。";

      // 保存对话记录到 DynamoDB
      const client = new DynamoDBClient(dynamoDBConfig);

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
      console.error('[ERROR] OpenAI API 调用失败:', openaiError);
      return new Response(JSON.stringify({
        error: 'OpenAI API Error',
        details: openaiError instanceof Error ? openaiError.message : '调用 AI 服务失败'
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
