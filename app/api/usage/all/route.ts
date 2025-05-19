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
async function getUserSubscription(userId: string): Promise<Subscription> {
  try {
    // 移除 credentials: 'include'，因為在伺服器端 API 中沒有瀏覽器 cookies
    const response = await fetch(
      `https://ai4kingdom.com/wp-json/custom/v1/validate_session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId })
      }
    );

    if (!response.ok) {
      console.error(`[ERROR] Failed to fetch subscription info for user ${userId}, status: ${response.status}`);
      // 返回一個預設的免費訂閱，而不是 null
      return {
        status: 'active',
        type: 'free',
        expiry: null,
        plan_id: null,
        roles: ['free_member']
      };
    }

    const data = await response.json();
    if (!data.subscription) {
      console.warn(`[WARN] No subscription info returned for user ${userId}, using default free subscription`);
      // 如果沒有訂閱信息，返回一個預設的免費訂閱
      return {
        status: 'active',
        type: 'free',
        expiry: null,
        plan_id: null,
        roles: ['free_member']
      };
    }
    return data.subscription;
  } catch (error) {
    console.error(`[ERROR] 獲取用戶 ${userId} 訂閱信息失敗:`, error);
    // 發生錯誤時，返回一個預設的免費訂閱，而不是 null
    return {
      status: 'active',
      type: 'free',
      expiry: null,
      plan_id: null,
      roles: ['free_member']
    };
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
      console.log('[DEBUG] User subscription for aggregated usage data:', {
        userId: item.UserId,
        status: subscription.status,
        type: subscription.type,
        isDefault: !subscription.plan_id || subscription.plan_id === null
      });
      // getUserSubscription 現在總是會返回有效的訂閱，所以不需要使用可選鏈運算符
      const subscriptionType = subscription.type.toLowerCase();
      const tokenLimit = TOKEN_LIMITS[subscriptionType as keyof typeof TOKEN_LIMITS] || TOKEN_LIMITS.free;
      
      // 根據用戶訂閱類型計算 token 額度
      return {
        userId: item.UserId,
        totalTokens: item.totalTokens || 0,
        promptTokens: item.promptTokens || 0,
        completionTokens: item.completionTokens || 0,
        retrievalTokens: item.retrievalTokens || 0,
        yearMonth: item.YearMonth,
        lastUpdated: item.lastUpdated,        subscription: subscriptionType,
        subscriptionExpiry: subscription.expiry || null,
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
