import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function POST() {
  try {
    const newThread = await openai.beta.threads.create();
    return NextResponse.json({ threadId: newThread.id });
  } catch (error) {
    return NextResponse.json({ error: '创建对话失败' }, { status: 500 });
  }
} 