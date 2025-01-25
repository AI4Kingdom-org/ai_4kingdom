import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

export async function getDynamoDBConfig() {
  if (process.env.NODE_ENV === 'development') {
    return {
      region: process.env.NEXT_PUBLIC_REGION || "us-east-2",
      credentials: {
        accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY!,
        secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_KEY!
      }
    };
  }

  const { fromCognitoIdentityPool } = await import("@aws-sdk/credential-providers");
  return {
    region: process.env.NEXT_PUBLIC_REGION || "us-east-2",
    credentials: await fromCognitoIdentityPool({
      clientConfig: { region: process.env.NEXT_PUBLIC_REGION || "us-east-2" },
      identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!
    })()
  };
}

// 添加创建 DynamoDB 客户端的函数
export async function createDynamoDBClient() {
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

// 添加更新用户活动线程的函数
export async function updateUserActiveThread(userId: string, threadId: string, type: string = 'general') {
  try {
    console.log('[DEBUG] 开始创建线程记录:', { userId, threadId, type });
    const docClient = await createDynamoDBClient();
    await docClient.send(new PutCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      Item: {
        UserId: String(userId),
        Type: type,
        threadId: threadId,
        Timestamp: new Date().toISOString()
      }
    }));
    console.log('[DEBUG] 线程记录创建成功:', { threadId, type });
  } catch (error) {
    console.error('[ERROR] 更新用户活动线程失败:', error);
    throw error;
  }
} 