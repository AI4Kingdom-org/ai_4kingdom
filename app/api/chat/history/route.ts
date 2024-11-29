import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
<<<<<<< HEAD
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import { fetchAuthSession } from 'aws-amplify/auth';
import { NextResponse } from "next/server";
import { Amplify } from 'aws-amplify';

const REGION = process.env.NEXT_PUBLIC_REGION || "us-east-2";
const IDENTITY_POOL_ID = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!;
const isDev = process.env.NODE_ENV === 'development';

// 确保环境变量存在
const identityPoolId = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID;
const userPoolId = process.env.NEXT_PUBLIC_USER_POOL_ID;
const userPoolClientId = process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID;

if (!identityPoolId || !userPoolId || !userPoolClientId) {
  throw new Error('必要的 Amplify 配置环境变量缺失');
}

// Amplify 配置
Amplify.configure({
  Auth: {
    Cognito: {
      identityPoolId,
      userPoolId,
      userPoolClientId
    }
  }
});

// 获取未认证凭证
const getUnAuthCredentials = () => {
  console.log('[DEBUG] 尝试获取未认证凭证');
  return fromCognitoIdentityPool({
    clientConfig: { region: REGION },
    identityPoolId: IDENTITY_POOL_ID
  })();
};

// 获取凭证
async function getCredentials() {
  try {
    console.log('[DEBUG] 开始获取凭证...');
    const session = await fetchAuthSession();
    
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

// 获取 DynamoDB 配置
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
  
  const credentials = await getCredentials();
  return {
    region: REGION,
    credentials
  };
}
=======
import { NextResponse } from "next/server";

const dynamoClient = new DynamoDBClient({ region: "us-east-2" });
>>>>>>> 44d991b40406b5ed12dbd3731740d81f976b7b04

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "UserId is required" }, { status: 400 });
  }

  try {
<<<<<<< HEAD
    console.log('[DEBUG] 开始获取聊天历史, userId:', userId);
    
    const config = await getDynamoDBConfig();
    const client = new DynamoDBClient(config);

=======
>>>>>>> 44d991b40406b5ed12dbd3731740d81f976b7b04
    const params = {
      TableName: "ChatHistory",
      KeyConditionExpression: "UserId = :userId",
      ExpressionAttributeValues: {
        ":userId": { S: userId },
      },
      ScanIndexForward: true,
    };

<<<<<<< HEAD
    console.log('[DEBUG] DynamoDB 查询参数:', JSON.stringify(params, null, 2));
    
    const command = new QueryCommand(params);
    const response = await client.send(command);

    console.log('[DEBUG] DynamoDB 响应:', JSON.stringify(response, null, 2));
=======
    const command = new QueryCommand(params);
    const response = await dynamoClient.send(command);
>>>>>>> 44d991b40406b5ed12dbd3731740d81f976b7b04

    const history = (response.Items || []).map((item) => {
      const message = JSON.parse(item.Message.S || "{}");
      return [
        { sender: "user", text: message.userMessage },
        { sender: "bot", text: message.botReply },
      ];
    }).flat();

    return NextResponse.json({ history });
  } catch (error) {
<<<<<<< HEAD
    console.error('[ERROR] 获取聊天历史失败:', {
      error,
      type: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      { error: "Failed to fetch chat history", details: error instanceof Error ? error.message : '未知错误' }, 
      { status: 500 }
    );
=======
    console.error("Error fetching chat history:", error);
    return NextResponse.json({ error: "Failed to fetch chat history" }, { status: 500 });
>>>>>>> 44d991b40406b5ed12dbd3731740d81f976b7b04
  }
}
