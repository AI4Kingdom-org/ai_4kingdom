import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../../lib/dynamoDB';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const dynamoClient = new DynamoDBClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  },
  endpoint: process.env.NEXT_PUBLIC_DYNAMODB_ENDPOINT // 如果使用本地 DynamoDB
});

export async function POST(request: Request) {
  try {
    const { userId, type } = await request.json();
    
    if (!userId) {
      return NextResponse.json({ error: 'UserId is required' }, { status: 400 });
    }

    // 创建 OpenAI 线程
    const newThread = await openai.beta.threads.create();
    const timestamp = new Date().toISOString();

    // 直接创建新记录，不做重复检查
    const newThreadData = {
      UserId: String(userId),
      Timestamp: timestamp,
      Type: type,
      threadId: newThread.id,
    };

    try {
      await docClient.send(new PutCommand({
        TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
        Item: newThreadData,
        ConditionExpression: 'attribute_not_exists(threadId)', // 确保 threadId 不存在
      }));
    } catch (err: any) {
      if (err.name === 'ConditionalCheckFailedException') {
        return NextResponse.json({
          success: false,
          error: '该对话ID已存在'
        }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({
      success: true,
      threadId: newThread.id,
      data: newThreadData
    });

  } catch (error) {
    console.error('[ERROR] 创建对话失败:', error);
    return NextResponse.json({
      success: false,
      error: '创建对话失败'
    }, { status: 500 });
  }
} 