import { DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBClient } from '../../../utils/dynamodb';
import { NextResponse } from 'next/server';
import { getOpenAI } from '../../../lib/openai/client';
import { isConversationId, isLegacyThreadId } from '../../../lib/openai/conversation';
import { getRequestIdentity, unauthorized } from '../../../lib/identity/server';

export async function DELETE(
  request: Request,
  context: { params: { threadId: string } }
) {
  const identity = getRequestIdentity(request);
  if (!identity) return unauthorized();

  try {
    // 只能刪自己的對話：以簽章身分查詢，不再相信 user-id 標頭
    const userId = identity.id;
    const { threadId } = context.params;

    console.log('[DEBUG] 开始删除对话:', { userId, threadId });

    const docClient = await createDynamoDBClient();

    // 1. 查询获取对应的 Timestamp
    const { Items } = await docClient.send(new QueryCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      KeyConditionExpression: 'UserId = :userId',
      FilterExpression: 'threadId = :threadId',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':threadId': threadId
      }
    }));

    if (!Items || Items.length === 0) {
      throw new Error('找不到对应的对话记录');
    }

    // 2. 删除 OpenAI conversation（或舊 Assistants thread）
    const openai = getOpenAI();
    try {
      if (isConversationId(threadId)) {
        await openai.conversations.delete(threadId);
      } else if (isLegacyThreadId(threadId)) {
        // 舊資料：Assistants API 日落前仍可清除；日落後刪除失敗僅記 log
        await openai.beta.threads.delete(threadId);
      }
    } catch (error) {
      console.error('[ERROR] OpenAI 對話删除失败:', error);
    }

    // 3. 使用正确的主键组合删除 DynamoDB 记录
    for (const item of Items) {
      await docClient.send(new DeleteCommand({
        TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
        Key: {
          UserId: userId,        // Partition key
          Timestamp: item.Timestamp  // Sort key
        }
      }));
    }
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[ERROR] 删除对话失败:', error);
    return NextResponse.json(
      { error: '删除对话失败' },
      { status: 500 }
    );
  }
}
