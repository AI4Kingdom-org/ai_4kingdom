import { NextResponse } from 'next/server';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoDBConfig } from "@/app/utils/dynamodb";
import type { Subscription } from '@/app/types/auth';

// 定義每個用戶類型的 token 額度
const TOKEN_LIMITS = {
  free: 100000,     // 100 credits
  pro: 1000000,     // 1,000 credits
  ultimate: 5000000 // 5,000 credits
};

// Token 轉換為 Credit 的比率
const TOKEN_TO_CREDIT_RATIO = 1000; // 1000 tokens = 1 credit

// 獲取用戶訂閱信息
async function getUserSubscription(userId: string): Promise<Subscription | null> {
  try {
    const response = await fetch(
      `https://ai4kingdom.com/wp-json/custom/v1/validate_session`,
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId })
      }
    );

    if (!response.ok) {
      console.log(`Failed to fetch subscription info for user ${userId}`);
      return null;
    }

    const data = await response.json();
    return data.subscription || null;
  } catch (error) {
    console.error(`[ERROR] 獲取用戶 ${userId} 訂閱信息失敗:`, error);
    return null;
  }
}

// 獲取所有用戶的 token 使用情況
export async function GET(request: Request) {
  try {
    // 獲取當前年月
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    // 連接 DynamoDB
    const config = await getDynamoDBConfig();
    const client = new DynamoDBClient(config);
    const docClient = DynamoDBDocumentClient.from(client);
    
    // 掃描 MonthlyTokenUsage 表格獲取所有用戶的當月使用量
    const scanCommand = new ScanCommand({
      TableName: "MonthlyTokenUsage",
      FilterExpression: "YearMonth = :yearMonth",
      ExpressionAttributeValues: {
        ":yearMonth": yearMonth
      }
    });
    
    const response = await docClient.send(scanCommand);
      // 格式化數據，轉換為更易讀的格式
    const usageData = response.Items || [];
    
    // 為每個用戶獲取訂閱信息
    const enrichedUsageData = await Promise.all(usageData.map(async (item) => {      // 嘗試獲取用戶訂閱信息
      const subscription = await getUserSubscription(item.UserId);
      const subscriptionType = subscription?.type?.toLowerCase() || 'free';
      const tokenLimit = TOKEN_LIMITS[subscriptionType as keyof typeof TOKEN_LIMITS] || TOKEN_LIMITS.free;
      
      // 根據用戶訂閱類型計算 token 額度
      return {
        userId: item.UserId,
        totalTokens: item.totalTokens || 0,
        promptTokens: item.promptTokens || 0,
        completionTokens: item.completionTokens || 0,
        retrievalTokens: item.retrievalTokens || 0,
        yearMonth: item.YearMonth,
        lastUpdated: item.lastUpdated,
        subscription: subscriptionType,
        subscriptionExpiry: subscription?.expiry || null,
        remainingTokens: Math.max(0, tokenLimit - (item.totalTokens || 0)),
        totalCredits: Math.floor(tokenLimit / TOKEN_TO_CREDIT_RATIO),
        remainingCredits: Math.floor(Math.max(0, tokenLimit - (item.totalTokens || 0)) / TOKEN_TO_CREDIT_RATIO)
      };
    }));
      return NextResponse.json({
      success: true,
      usage: enrichedUsageData,
      yearMonth
    });
  } catch (error) {
    console.error('[ERROR] 獲取所有用戶 token 使用情況失敗:', error);
    return NextResponse.json({
      error: '獲取用戶使用情況失敗',
      details: error instanceof Error ? error.message : '未知錯誤'
    }, { status: 500 });
  }
}
