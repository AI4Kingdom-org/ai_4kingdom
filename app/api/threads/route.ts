import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../utils/dynamodb';
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

// 获取用户的所有对话
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const type = searchParams.get('type') || 'general';

  if (!userId) {
    return NextResponse.json({ error: 'UserId is required' }, { status: 400 });
  }

  try {
    const docClient = await createDynamoDBClient();
    
    console.log('[DEBUG] 开始查询用户线程:', {
      userId,
      type,
      tableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME
    });

    // 使用 UserId 作为分区键进行查询
    const response = await docClient.send(new QueryCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME!,
      KeyConditionExpression: 'UserId = :userId',
      FilterExpression: '#type = :type',
      ExpressionAttributeNames: {
        '#type': 'Type'
      },
      ExpressionAttributeValues: {
        ':userId': String(userId),
        ':type': type
      }
    }));

    console.log('[DEBUG] 查询结果:', response);

    const conversations = response.Items?.map(item => ({
      threadId: item.threadId,
      createdAt: item.Timestamp,
      UserId: item.UserId,
      Type: item.Type
    })) || [];

    return NextResponse.json(conversations);

  } catch (error) {
    console.error('[ERROR] 获取线程列表失败:', {
      error,
      message: error instanceof Error ? error.message : '未知错误',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return NextResponse.json(
      { 
        error: '获取线程列表失败',
        details: error instanceof Error ? error.message : '未知错误'
      },
      { status: 500 }
    );
  }
} 