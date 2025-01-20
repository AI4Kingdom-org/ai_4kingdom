import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../../utils/dynamodb';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  dangerouslyAllowBrowser: true
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
      type: 'thread'  // 记录类型
    });

    if (!userId) {
      throw new Error('未提供用户ID');
    }

    // 1. 删除 OpenAI 的线程
    try {
      await openai.beta.threads.del(threadId);
    } catch (error) {
      console.warn('[WARN] OpenAI 线程删除失败:', error);
      // 继续执行，因为我们仍然需要删除本地记录
    }

    // 2. 删除 DynamoDB 中的记录
    const docClient = await createDynamoDBClient();
    
    // 使用正确的复合主键
    await docClient.send(new DeleteCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      Key: {
        UserId: userId,    // 分区键
        Type: 'thread'     // 排序键
      }
    }));

    console.log('[DEBUG] 删除对话成功:', { userId, threadId });
    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[ERROR] 删除对话失败:', error);
    return NextResponse.json(
      { error: '删除对话失败' },
      { status: 500 }
    );
  }
} 