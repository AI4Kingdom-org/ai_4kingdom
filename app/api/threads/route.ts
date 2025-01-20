import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../utils/dynamodb';
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

// 获取用户的所有对话
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'UserId is required' }, { status: 400 });
  }

  try {
    const docClient = await createDynamoDBClient();
    const response = await docClient.send(new QueryCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      KeyConditionExpression: 'UserId = :userId AND Type = :type',
      ExpressionAttributeValues: {
        ':userId': String(userId),
        ':type': 'thread'
      }
    }));

    // 确保返回的数据格式符合 ConversationList 组件的接口
    const conversations = response.Items?.map(item => ({
      threadId: item.threadId,
      createdAt: item.Timestamp || item.createdAt,
      UserId: item.UserId
    })) || [];

    console.log('[DEBUG] 获取到的对话列表:', {
      userId,
      count: conversations.length
    });

    return NextResponse.json(conversations);
  } catch (error) {
    console.error('[ERROR] 获取对话列表失败:', error);
    return NextResponse.json(
      { error: '获取对话列表失败' },
      { status: 500 }
    );
  }
} 