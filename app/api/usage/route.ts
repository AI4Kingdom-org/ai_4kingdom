import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { NextResponse } from "next/server";

// 复用 getDynamoDBConfig 函数
async function getDynamoDBConfig() {
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
    const credentials = await fromCognitoIdentityPool({
        clientConfig: { region: process.env.NEXT_PUBLIC_REGION || "us-east-2" },
        identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!
    })();

    return {
        region: process.env.NEXT_PUBLIC_REGION || "us-east-2",
        credentials
    };
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
        return NextResponse.json({ error: "UserId is required" }, { status: 400 });
    }

    try {
        const dbConfig = await getDynamoDBConfig();
        const client = new DynamoDBClient(dbConfig);
        const docClient = DynamoDBDocumentClient.from(client);

        // 获取本周开始时间
        const now = new Date();
        const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
        startOfWeek.setHours(0, 0, 0, 0);

        const command = new QueryCommand({
            TableName: "ChatHistory",
            KeyConditionExpression: "UserId = :userId AND Timestamp >= :startTime",
            ExpressionAttributeValues: {
                ":userId": String(userId),
                ":startTime": startOfWeek.toISOString()
            }
        });

        const response = await docClient.send(command);
        const weeklyCount = response.Items?.length || 0;

        return NextResponse.json({ weeklyCount });
    } catch (error) {
        console.error('[ERROR] 获取使用次数失败:', error);
        return NextResponse.json(
            { error: "Failed to fetch usage count" }, 
            { status: 500 }
        );
    }
} 