import { NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');
    
    if (!threadId) {
      return NextResponse.json({ error: 'ThreadId is required' }, { status: 400 });
    }

    console.log('[DEBUG] 开始获取消息记录:', { threadId });

    // 获取线程消息
    const messages = await openai.beta.threads.messages.list(threadId);

    // 格式化消息
    const formattedMessages = messages.data.map(message => ({
      id: message.id,
      role: message.role,
      content: message.content.map(content => {
        if (content.type === 'text') {
          return content.text.value;
        }
        return null;
      }).filter(Boolean).join('\n'),
      createdAt: message.created_at
    }));

    console.log('[DEBUG] 获取到的消息数量:', formattedMessages.length);

    return NextResponse.json({
      success: true,
      messages: formattedMessages
    });

  } catch (error) {
    console.error('[ERROR] 获取消息记录失败:', error);
    return NextResponse.json({
      success: false,
      error: '获取消息记录失败',
      details: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
} 