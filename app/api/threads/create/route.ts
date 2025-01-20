import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../../lib/dynamoDB';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function POST(request: Request) {
  try {
    // 从请求体获取 userId
    const { userId } = await request.json();
    
    if (!userId) {
      return NextResponse.json({ error: 'UserId is required' }, { status: 400 });
    }

    console.log('[DEBUG] 开始创建新对话:', { userId });

    // 创建 OpenAI 线程
    const newThread = await openai.beta.threads.create();
    const timestamp = new Date().toISOString();

    // 准备新线程数据
    const newThreadData = {
      UserId: String(userId),
      Timestamp: timestamp,
      Type: 'thread',
      threadId: newThread.id,
    };

    console.log('[DEBUG] 保存线程数据:', newThreadData);

    // 保存到 DynamoDB
    await docClient.send(new PutCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      Item: newThreadData
    }));

    // 确保返回有效的 JSON 响应
    return NextResponse.json({
      success: true,
      threadId: newThread.id,
      data: newThreadData
    });

  } catch (error) {
    console.error('[ERROR] 创建对话失败:', error);
    
    // 确保错误响应也是有效的 JSON
    return NextResponse.json({
      success: false,
      error: '创建对话失败',
      details: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
} 