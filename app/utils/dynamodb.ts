import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

export async function getDynamoDBConfig() {
  const envVars = {
    accessKeyId: process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
    secretKey: process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
    region: process.env.NEXT_PUBLIC_REGION,
    identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID,
    env: process.env.NODE_ENV
  };
  
  console.log('[DEBUG] DynamoDB配置初始化:', {
    ...envVars,
    hasAccessKey: !!envVars.accessKeyId,
    hasSecretKey: !!envVars.secretKey
  });

  try {
    if (process.env.NODE_ENV === 'development') {
      if (!envVars.accessKeyId || !envVars.secretKey) {
        throw new Error('开发环境需要设置 ACCESS_KEY_ID 和 SECRET_ACCESS_KEY');
      }
      
      const config = {
        region: envVars.region || "us-east-2",
        credentials: {
          accessKeyId: envVars.accessKeyId,
          secretAccessKey: envVars.secretKey
        }
      };
      console.log('[DEBUG] 使用开发环境配置:', {
        region: config.region,
        hasCredentials: !!config.credentials
      });
      return config;
    }

    const { fromCognitoIdentityPool } = await import("@aws-sdk/credential-providers");
    const config = {
      region: envVars.region || "us-east-2",
      credentials: fromCognitoIdentityPool({
        clientConfig: { region: envVars.region || "us-east-2" },
        identityPoolId: envVars.identityPoolId!
      })
    };
    console.log('[DEBUG] 使用生产环境配置:', {
      region: config.region,
      identityPoolId: envVars.identityPoolId
    });
    return config;
  } catch (error) {
    console.error('[ERROR] DynamoDB配置失败:', error);
    throw error;
  }
}

// 添加创建 DynamoDB 客户端的函数
export async function createDynamoDBClient() {
  try {
    const config = await getDynamoDBConfig();
    console.log('[DYNAMODB CONFIG] 完整配置:', {
      ...config,
      sundayGuideTable: process.env.SUNDAY_GUIDE_TABLE_NAME,
      mainTable: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME
    });
    
    const client = new DynamoDBClient(config);

    return DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  } catch (error) {
    console.error('[ERROR] 创建DynamoDB客户端失败:', error);
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