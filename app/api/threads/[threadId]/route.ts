import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../../utils/dynamodb';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function DELETE(
  request: Request,
  { params }: { params: { threadId: string } }
) {
  try {
    const userId = request.headers.get('user-id');
    const threadId = params.threadId;
    
    console.log('[DEBUG] 开始删除对话:', { 
      userId,
      threadId,
      type: 'thread'
    });

    if (!userId) {
      throw new Error('未提供用户ID');
    }

    // 1. 删除 OpenAI thread
    try {
      await openai.beta.threads.del(threadId);
      console.log('[DEBUG] OpenAI thread 删除成功:', threadId);
    } catch (error) {
      console.error('[ERROR] OpenAI thread 删除失败:', error);
      // 即使 OpenAI 删除失败，我们仍继续删除数据库记录
    }

    // 2. 删除数据库记录
    const docClient = await createDynamoDBClient();
    await docClient.send(new DeleteCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      Key: {
        UserId: userId,
        Type: 'thread'
      }
    }));

    console.log('[DEBUG] 数据库记录删除成功:', { userId, threadId });
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[ERROR] 删除对话失败:', error);
    return NextResponse.json(
      { error: '删除对话失败' },
      { status: 500 }
    );
  }
} 