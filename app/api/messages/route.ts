import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../utils/dynamodb';
import { QueryCommand } from '@aws-sdk/client-dynamodb';
import { getOpenAI } from '../../lib/openai/client';
import { isConversationId } from '../../lib/openai/conversation';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');
    const userId = searchParams.get('userId');

    if (!threadId || !userId) {
      console.warn('[WARN] 缺少必要参数:', { threadId, userId });
      return NextResponse.json({
        success: false,
        error: 'ThreadId and UserId are required'
      }, { status: 400 });
    }

    const openai = getOpenAI();

    try {
      let formattedMessages: Array<{ id: string; role: string; content: string; createdAt: number | string | null }>;

      if (isConversationId(threadId)) {
        // 新格式：Conversation items
        const items = await openai.conversations.items.list(threadId, { limit: 100, order: 'asc' } as any);
        formattedMessages = [];
        for await (const item of items as any) {
          if (item.type !== 'message') continue;
          const content = (item.content || [])
            .filter((c: any) => c.type === 'input_text' || c.type === 'output_text')
            .map((c: any) => c.text)
            .join('\n');
          if (!content) continue;
          formattedMessages.push({
            id: item.id,
            role: item.role === 'assistant' ? 'assistant' : 'user',
            content,
            createdAt: item.created_at ?? null,
          });
          if (formattedMessages.length >= 100) break;
        }
      } else {
        // 舊格式：Assistants thread（日落前仍可讀，之後走 DynamoDB fallback）
        const messages = await openai.beta.threads.messages.list(threadId);
        formattedMessages = (messages.data || [])
          .reverse()
          .map(message => {
            const content = message.content
              .filter(c => c.type === 'text')
              .map(c => (c.type === 'text' ? c.text.value : ''))
              .join('\n');

            return {
              id: message.id,
              role: message.role,
              content,
              createdAt: message.created_at
            };
          });
      }

      return NextResponse.json({
        success: true,
        messages: formattedMessages,
        debug: {
          threadInfo: { id: threadId },
          messageCount: formattedMessages.length
        }
      });

    } catch (error) {
      console.error('[ERROR] OpenAI 获取消息失败:', {
        error,
        threadId,
        errorMessage: error instanceof Error ? error.message : '未知错误',
        stack: error instanceof Error ? error.stack : undefined
      });

      // 如果 OpenAI API 调用失败，尝试从 DynamoDB 获取消息
      try {
        const docClient = await createDynamoDBClient();
        const command = new QueryCommand({
          TableName: 'Messages',
          IndexName: 'threadId-index',
          KeyConditionExpression: 'threadId = :threadId',
          ExpressionAttributeValues: {
            ':threadId': { S: threadId }
          }
        });

        const response = await docClient.send(command);
        console.log('[DEBUG] 从 DynamoDB 获取消息成功:', response);

        if (response.Items && response.Items.length > 0) {
          const formattedMessages = response.Items.map(item => ({
            id: item.id?.S || '',
            role: item.role?.S || (item.isUserMessage?.BOOL ? 'user' : 'assistant'),
            content: item.content?.S || item.Message?.S || '',
            createdAt: item.createdAt?.S || item.Timestamp?.S || new Date().toISOString()
          }));

          return NextResponse.json({
            success: true,
            messages: formattedMessages,
            source: 'dynamodb'
          });
        }
      } catch (dbError) {
        console.error('[ERROR] DynamoDB 获取消息失败:', dbError);
      }

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
