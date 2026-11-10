import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBClient } from "./dynamodb";
import { recordAiUsage } from "@/app/lib/analytics/store";

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  retrieval_tokens: number;
}

interface MonthlyUsageRecord {
  PK: string;          // USER#{userId}
  SK: string;          // MONTH#{YYYY-MM}
  UserId: string;      // 用户ID
  YearMonth: string;   // YYYY-MM 格式
  PromptTokens: number;
  CompletionTokens: number;
  TotalTokens: number;
  RetrievalTokens: number;
  UpdatedAt: string;   // ISO 日期字符串
}

export async function updateMonthlyTokenUsage(userId: string, usage: TokenUsage) {
  try {
    if (!userId) {
      throw new Error('userId is required for token usage tracking');
    }
    
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    console.log('[DEBUG] 📊 開始更新月度 token 使用統計:', {
      userId,
      yearMonth,
      usage,
      timestamp: now.toISOString()
    });
    
    const docClient = await createDynamoDBClient();
    
    const command = new UpdateCommand({
      TableName: 'MonthlyTokenUsage',
      Key: {
        UserId: String(userId),
        YearMonth: yearMonth
      },
      UpdateExpression: `
        SET promptTokens = if_not_exists(promptTokens, :zero) + :prompt,
            completionTokens = if_not_exists(completionTokens, :zero) + :completion,
            totalTokens = if_not_exists(totalTokens, :zero) + :total,
            retrievalTokens = if_not_exists(retrievalTokens, :zero) + :retrieval,
            lastUpdated = :now
      `,
      ExpressionAttributeValues: {
        ':zero': 0,
        ':prompt': usage.prompt_tokens,
        ':completion': usage.completion_tokens,
        ':total': usage.total_tokens,
        ':retrieval': usage.retrieval_tokens,
        ':now': new Date().toISOString()
      },
      ReturnValues: 'ALL_NEW'
    });

    const result = await docClient.send(command);
    // 每日 AI 用量統計（/site-analytics）；內部自行吞掉錯誤，不影響記帳
    await recordAiUsage('member', String(userId), usage.total_tokens);
    console.log('[SUCCESS] ✅ Token 使用量更新成功:', {
      userId,
      yearMonth,
      newTotals: result.Attributes
    });
    
    return result.Attributes;

  } catch (error: any) {
    console.error('[ERROR] ❌ 更新月度 token 使用失敗:', {
      userId,
      error: error?.message || String(error),
      errorName: error?.name,
      errorCode: error?.code,
      stack: error?.stack
    });
    // 重新抛出错误，让调用者知道失败了
    throw error;
  }
}