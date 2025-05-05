import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBClient } from "./dynamodb";

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
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    const docClient = await createDynamoDBClient();
    
    console.log('[DEBUG] 更新月度使用统计:', {
      userId,
      yearMonth,
      usage
    });

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
    console.log('[DEBUG] 更新成功:', result.Attributes);

  } catch (error) {
    console.error('[ERROR] 更新月度token使用失败:', error);
  }
}