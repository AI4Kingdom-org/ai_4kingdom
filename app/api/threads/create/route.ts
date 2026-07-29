import { NextResponse } from 'next/server';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../../utils/dynamodb';
import { getOpenAI } from '../../../lib/openai/client';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, type, title } = body;

    console.log('[DEBUG] 开始创建对话:', { userId, type });

    // 创建新的 conversation（Responses API；沿用 threadId 欄位名以維持前端/DB 相容）
    const openai = getOpenAI();
    const conversation = await openai.conversations.create({
      metadata: {
        userId: String(userId),
        type: String(type || 'general'),
      },
    });
    const timestamp = new Date().toISOString();

    const docClient = DynamoDBDocumentClient.from(await createDynamoDBClient());

    // 🔴 移除自動發送初始訊息的邏輯
    // homeschool 類型的初始訊息改由 /api/homeschool-prompt POST 時統一處理
    // 這樣可以確保包含完整的學生資料（年齡、性別、關注問題等）
    if (type.toLowerCase() === 'homeschool') {
      console.log('[DEBUG] 处理 homeschool 类型对话 - 跳過自動發送初始訊息');
      console.log('[DEBUG] 初始訊息將由 /api/homeschool-prompt 在保存時統一處理');
    }

    // 保存 conversation 信息到 DynamoDB
    const putCommand = new PutCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      Item: {
        UserId: String(userId),  // 确保 UserId 是字符串类型
        Timestamp: timestamp,
        threadId: conversation.id,
        Type: type.toUpperCase(),
        ...(title ? { title: String(title).slice(0, 50) } : {})
      }
    });

    await docClient.send(putCommand);

    return NextResponse.json({
      success: true,
      threadId: conversation.id
    });
  } catch (error) {
    console.error('[ERROR] 创建对话失败:', error);
    return NextResponse.json(
      { error: '创建对话失败' },
      { status: 500 }
    );
  }
}
