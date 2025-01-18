import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../../utils/dynamodb';
import { DeleteCommand } from "@aws-sdk/lib-dynamodb";

export async function DELETE(
  request: Request,
  { params }: { params: { threadId: string } }
) {
  const { threadId } = params;
  const { userId } = await request.json();

  if (!userId || !threadId) {
    return NextResponse.json(
      { error: 'UserId and threadId are required' },
      { status: 400 }
    );
  }

  try {
    const docClient = await createDynamoDBClient();
    await docClient.send(new DeleteCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      Key: {
        UserId: userId,
        Type: 'thread'
      }
    }));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除对话失败:', error);
    return NextResponse.json(
      { error: '删除对话失败' },
      { status: 500 }
    );
  }
} 