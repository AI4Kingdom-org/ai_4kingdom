import { NextResponse } from 'next/server';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoDBConfig } from "@/app/utils/dynamodb";

// 重設信用點數到預設值（將當月使用量清零）
export async function POST(request: Request) {
  try {
    // 檢查是否提供了 userId
    const { userId } = await request.json();
    
    if (!userId) {
      return NextResponse.json({ error: "用戶ID為必填參數" }, { status: 400 });
    }

    // 連接 DynamoDB
    const config = await getDynamoDBConfig();
    const client = new DynamoDBClient(config);
    const docClient = DynamoDBDocumentClient.from(client);
    
    // 取得當前的年月格式 (例如: "2025-05")
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 先檢查用戶當月使用記錄是否存在
    const getCommand = new GetCommand({
      TableName: "MonthlyTokenUsage", 
      Key: {
        UserId: String(userId),
        YearMonth: yearMonth
      }
    });

    const existingRecord = await docClient.send(getCommand);
    
    // 將用戶當月使用量歸零 (重設到預設額度)
    const putCommand = new PutCommand({
      TableName: "MonthlyTokenUsage",
      Item: {
        UserId: String(userId),
        YearMonth: yearMonth,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        retrievalTokens: 0,
        lastUpdated: new Date().toISOString()
      }
    });

    await docClient.send(putCommand);
    
    return NextResponse.json({
      success: true,
      message: `已成功重設用戶 ${userId} 的信用點數到預設額度`,
      resetTime: new Date().toISOString()
    });

  } catch (error) {
    console.error('[ERROR] 重設用戶信用點數失敗:', error);
    return NextResponse.json({
      error: '重設用戶信用點數失敗',
      details: error instanceof Error ? error.message : '未知錯誤'
    }, { status: 500 });
  }
}