import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION || process.env.NEXT_PUBLIC_REGION,
  credentials: {
    accessKeyId: process.env.NEXT_PUBLIC_ACCESS_KEY_ID!,
    secretAccessKey: process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY!
  }
});

const docClient = DynamoDBDocumentClient.from(client);

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  retrieval_tokens: number;
}

export async function saveTokenUsage(
  userId: string,
  threadId: string,
  usage: TokenUsage
) {
  try {
    const timestamp = new Date().toISOString();
    
    await docClient.send(new PutCommand({
      TableName: "TokenUsage",
      Item: {
        UserId: userId,
        Timestamp: timestamp,
        ThreadId: threadId,
        PromptTokens: usage.prompt_tokens,
        CompletionTokens: usage.completion_tokens,
        TotalTokens: usage.total_tokens,
        Type: 'usage'
      }
    }));

    console.log('[DEBUG] Token使用记录已保存:', {
      userId,
      threadId,
      usage
    });
  } catch (error) {
    console.error('[ERROR] 保存Token使用记录失败:', error);
  }
} 