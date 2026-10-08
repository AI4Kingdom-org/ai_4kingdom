import { NextResponse } from 'next/server';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../../utils/dynamodb';
import { requireAdmin } from '@/app/lib/identity/admin';

export async function POST(request: Request) {
  // 管理用端點：僅限管理員或帶 service token 的內部呼叫（見 app/lib/identity/admin.ts）
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  try {
    const { userId, type, assistantId, vectorStoreId } = await request.json();

    const docClient = DynamoDBDocumentClient.from(await createDynamoDBClient());
    
    const command = new UpdateCommand({
      TableName: process.env.NEXT_PUBLIC_DYNAMODB_TABLE_NAME,
      Key: {
        UserId: String(userId),
        Type: type
      },
      UpdateExpression: 'SET AssistantId = :aid, VectorStoreId = :vid',
      ExpressionAttributeValues: {
        ':aid': assistantId,
        ':vid': vectorStoreId
      }
    });

    await docClient.send(command);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ERROR] 更新线程配置失败:', error);
    return NextResponse.json({ error: '更新配置失败' }, { status: 500 });
  }
} 