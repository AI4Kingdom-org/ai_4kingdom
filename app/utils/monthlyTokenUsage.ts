import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoDBConfig } from "./dynamodb";

interface MonthlyUsage {
  UserId: string;
  YearMonth: string;  // 格式: "2024-03"
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  retrieval_tokens: number;
  last_updated: string;
}

export async function updateMonthlyTokenUsage(
  userId: string,
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    retrieval_tokens: number;
  }
) {
  try {
    const config = await getDynamoDBConfig();
    const client = new DynamoDBClient(config);
    const docClient = DynamoDBDocumentClient.from(client);
    
    // 获取当前年月
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 更新月度使用量
    const command = new UpdateCommand({
      TableName: "MonthlyTokenUsage",
      Key: {
        UserId: userId,
        YearMonth: yearMonth
      },
      UpdateExpression: `
        SET prompt_tokens = if_not_exists(prompt_tokens, :zero) + :prompt,
            completion_tokens = if_not_exists(completion_tokens, :zero) + :completion,
            total_tokens = if_not_exists(total_tokens, :zero) + :total,
            retrieval_tokens = if_not_exists(retrieval_tokens, :zero) + :retrieval,
            last_updated = :now
      `,
      ExpressionAttributeValues: {
        ":zero": 0,
        ":prompt": usage.prompt_tokens,
        ":completion": usage.completion_tokens,
        ":total": usage.total_tokens,
        ":retrieval": usage.retrieval_tokens,
        ":now": new Date().toISOString()
      },
      ReturnValues: "ALL_NEW"
    });

    const result = await docClient.send(command);
    console.log('[DEBUG] 月度token使用更新成功:', {
      userId,
      yearMonth,
      newValues: result.Attributes
    });

    return result.Attributes as MonthlyUsage;
  } catch (error) {
    console.error('[ERROR] 更新月度token使用失败:', error);
    throw error;
  }
} 