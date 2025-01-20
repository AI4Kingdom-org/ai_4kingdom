import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from '../../../lib/dynamoDB';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function POST() {
  try {
    const newThread = await openai.beta.threads.create();
    const userId = process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME;
    const timestamp = new Date().toISOString();
    const type = 'thread';
    const threadId = newThread.id;

    const newThreadData = {
      UserId: String(userId),
      Timestamp: timestamp,
      Type: type,
      threadId: threadId,
    };

    await docClient.send(new PutCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      Item: newThreadData
    }));

    return NextResponse.json({ threadId: newThread.id });
  } catch (error) {
    return NextResponse.json({ error: '创建对话失败' }, { status: 500 });
  }
} 