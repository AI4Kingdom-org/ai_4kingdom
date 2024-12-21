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
        // 添加更多调试日志
        console.log('[DEBUG] Starting usage check for userId:', userId);
        
        const dbConfig = await getDynamoDBConfig();
        console.log('[DEBUG] DB Config:', { 
            region: dbConfig.region,
            hasCredentials: !!dbConfig.credentials,
            environment: process.env.NODE_ENV,
            identityPoolId: process.env.NEXT_PUBLIC_IDENTITY_POOL_ID?.substring(0, 10) + '...'
        });

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

        console.log('[DEBUG] Query Command:', {
            TableName: command.input.TableName,
            KeyConditionExpression: command.input.KeyConditionExpression,
            ExpressionAttributeValues: command.input.ExpressionAttributeValues
        });

        try {
            const response = await docClient.send(command);
            console.log('[DEBUG] DynamoDB Response:', {
                Count: response.Count,
                ScannedCount: response.ScannedCount,
                Items: response.Items?.length
            });
            
            return NextResponse.json({ 
                weeklyCount: response.Items?.length || 0,
                debug: {
                    timestamp: new Date().toISOString(),
                    startOfWeek: startOfWeek.toISOString()
                }
            });
        } catch (dbError) {
            console.error('[ERROR] DynamoDB Error:', {
                message: dbError instanceof Error ? dbError.message : 'Unknown DB error',
                name: dbError instanceof Error ? dbError.name : 'Unknown',
                stack: dbError instanceof Error ? dbError.stack : undefined
            });
            
            return NextResponse.json({
                error: "Database operation failed",
                details: dbError instanceof Error ? dbError.message : 'Unknown DB error',
                debug: {
                    timestamp: new Date().toISOString(),
                    errorType: dbError instanceof Error ? dbError.name : 'Unknown'
                }
            }, { status: 500 });
        }
    } catch (error) {
        console.error('[ERROR] General error:', {
            message: error instanceof Error ? error.message : 'Unknown error',
            name: error instanceof Error ? error.name : 'Unknown',
            stack: error instanceof Error ? error.stack : undefined
        });
        
        return NextResponse.json({ 
            error: "Failed to fetch usage count",
            details: error instanceof Error ? error.message : '未知错误',
            debug: {
                timestamp: new Date().toISOString(),
                errorType: error instanceof Error ? error.name : 'Unknown'
            }
        }, { status: 500 });
    }
} 