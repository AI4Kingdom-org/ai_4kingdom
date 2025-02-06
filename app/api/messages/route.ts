import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createDynamoDBClient } from '../../utils/dynamodb';
import { QueryCommand } from '@aws-sdk/client-dynamodb';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');
    const userId = searchParams.get('userId');
    
    console.log('[DEBUG] 开始获取消息记录:', { 
      threadId, 
      userId,
      headers: Object.fromEntries(request.headers),
      url: request.url
    });

    if (!threadId || !userId) {
      console.warn('[WARN] 缺少必要参数:', { threadId, userId });
      return NextResponse.json({ 
        error: 'ThreadId and UserId are required' 
      }, { status: 400 });
    }

    // 从 DynamoDB 获取线程配置
    try {
      const docClient = await createDynamoDBClient();
      const command = new QueryCommand({
        TableName: 'ChatHistory',
        IndexName: 'threadId-index',
        KeyConditionExpression: 'threadId = :threadId',
        ExpressionAttributeValues: {
          ':threadId': { S: threadId }
        }
      });
      
      const response = await docClient.send(command);
      console.log('[DEBUG] DynamoDB 线程配置:', {
        userId,
        threadId,
        config: response.Items?.[0],
        assistantId: response.Items?.[0]?.assistantId,
        vectorStoreId: response.Items?.[0]?.vectorStoreId
      });
    } catch (error) {
      console.error('[ERROR] 获取 DynamoDB 配置失败:', error);
    }

    // 从 OpenAI 获取线程信息
    try {
      console.log('[DEBUG] 开始调用 OpenAI API:', {
        threadId,
        apiKey: !!process.env.OPENAI_API_KEY // 只记录是否存在
      });

      const thread = await openai.beta.threads.retrieve(threadId);
      console.log('[DEBUG] 获取到线程信息:', {
        threadId: thread.id,
        created: thread.created_at,
        metadata: thread.metadata
      });

      const messages = await openai.beta.threads.messages.list(threadId);
      console.log('[DEBUG] OpenAI 原始消息:', {
        hasData: !!messages.data,
        count: messages.data?.length || 0,
        firstMessage: messages.data?.[0] ? {
          id: messages.data[0].id,
          role: messages.data[0].role,
          created: messages.data[0].created_at
        } : null
      });

      if (!messages.data || messages.data.length === 0) {
        console.log('[INFO] 线程中没有消息');
        return NextResponse.json({
          success: true,
          messages: []
        });
      }

      // 格式化消息并反转顺序
      const formattedMessages = messages.data
        .reverse()
        .map(message => {
          const content = message.content
            .filter(c => c.type === 'text')
            .map(c => (c.type === 'text' ? c.text.value : ''))
            .join('\n');
            
          console.log('[DEBUG] 消息格式化:', {
            id: message.id,
            role: message.role,
            contentLength: content.length,
            timestamp: message.created_at
          });

          return {
            id: message.id,
            role: message.role,
            content,
            createdAt: message.created_at
          };
        });

      console.log('[DEBUG] 最终格式化消息:', {
        count: formattedMessages.length,
        threadId,
        firstMessagePreview: formattedMessages[0]
      });

      return NextResponse.json({
        success: true,
        messages: formattedMessages,
        debug: {
          threadInfo: {
            id: thread.id,
            created: thread.created_at
          },
          messageCount: messages.data.length
        }
      });

    } catch (error) {
      console.error('[ERROR] OpenAI 获取消息失败:', {
        error,
        threadId,
        errorMessage: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      return NextResponse.json({
        success: false,
        error: '获取 OpenAI 消息失败',
        details: error instanceof Error ? error.message : '未知错误'
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[ERROR] 获取消息记录失败:', {
      error,
      errorMessage: error instanceof Error ? error.message : '未知错误',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return NextResponse.json({
      success: false,
      error: '获取消息记录失败',
      details: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
} 