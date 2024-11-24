import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { CognitoIdentityClient } from "@aws-sdk/client-cognito-identity";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import { fetchAuthSession } from 'aws-amplify/auth';

const REGION = process.env.NEXT_PUBLIC_REGION || "us-east-2";
const IDENTITY_POOL_ID = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!;

// 创建一个未认证的身份池凭证
const getUnAuthCredentials = () => {
  return fromCognitoIdentityPool({
    clientConfig: { region: REGION },
    identityPoolId: IDENTITY_POOL_ID
  })();
};

async function getCredentials() {
  try {
    const session = await fetchAuthSession();
    return session.credentials;
  } catch (error) {
    console.error('获取凭证时出错:', error);
    throw error;
  }
}

async function getChatHistory(userId: string) {
  try {
    const credentials = await getCredentials();
    
    // 创建 DynamoDB 客户端
    const client = new DynamoDBClient({
      region: REGION,
      credentials: credentials
    });

    const docClient = DynamoDBDocumentClient.from(client);
    
    // 查询聊天历史
    const command = new QueryCommand({
      TableName: "ChatHistory",
      KeyConditionExpression: "UserId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      }
    });

    const response = await docClient.send(command);
    console.log('DynamoDB response:', response);
    
    return response.Items || [];
    
  } catch (error) {
    console.error('获取聊天历史时出错:', error);
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    
    if (!userId) {
      return new Response(JSON.stringify({ error: 'Missing userId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log('Fetching chat history for userId:', userId);
    const history = await getChatHistory(userId);
    
    return new Response(JSON.stringify(history), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    console.error('API Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    return new Response(JSON.stringify({ 
      error: 'Internal Server Error',
      message: errorMessage,
      stack: process.env.NODE_ENV === 'development' ? errorStack : undefined
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
