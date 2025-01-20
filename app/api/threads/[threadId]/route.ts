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
    const threadId = params.threadId;
    console.log('[DEBUG] 开始删除对话:', { threadId });

    // 1. 删除 OpenAI 的线程
    try {
      await openai.beta.threads.del(threadId);
    } catch (error) {
      console.warn('[WARN] OpenAI 线程删除失败:', error);
      // 继续执行，因为我们仍然需要删除本地记录
    }

    // 2. 删除 DynamoDB 中的记录
    const docClient = await createDynamoDBClient();
    
    // 简化删除操作，不使用条件表达式
    await docClient.send(new DeleteCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      Key: {
        UserId: request.headers.get('user-id'), // 从请求头获取用户ID
        Type: 'thread',  // 假设这是我们存储线程的方式
      }
    }));

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('[ERROR] 删除对话失败:', error);
    return NextResponse.json(
      { error: '删除对话失败' },
      { status: 500 }
    );
  }
} 