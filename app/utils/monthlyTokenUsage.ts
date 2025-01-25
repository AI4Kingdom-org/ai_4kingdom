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
    
    const command = new UpdateCommand({
      TableName: 'TokenUsage',
      Key: {
        PK: `USER#${userId}`,
        SK: `MONTH#${yearMonth}`
      },
      UpdateExpression: `
        SET UserId = :userId,
            YearMonth = :yearMonth,
            PromptTokens = if_not_exists(PromptTokens, :zero) + :prompt,
            CompletionTokens = if_not_exists(CompletionTokens, :zero) + :completion,
            TotalTokens = if_not_exists(TotalTokens, :zero) + :total,
            RetrievalTokens = if_not_exists(RetrievalTokens, :zero) + :retrieval,
            UpdatedAt = :now
      `,
      ExpressionAttributeValues: {
        ':userId': userId,
        ':yearMonth': yearMonth,
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

    console.log('[DEBUG] 月度token使用已更新:', {
      userId,
      yearMonth,
      newValues: result.Attributes
    });
  } catch (error) {
    console.error('[ERROR] 更新月度token使用失败:', error);
    // 不抛出错误，避免影响主流程
    // throw error;  
  }
} 