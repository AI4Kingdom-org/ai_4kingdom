import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../../../utils/dynamodb';
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { requireAdmin } from '@/app/lib/identity/admin';

export async function POST(request: Request) {
  // 管理用端點：僅限管理員或帶 service token 的內部呼叫（見 app/lib/identity/admin.ts）
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  try {
    const docClient = await createDynamoDBClient();
    
    // 获取所有助手
    const scanCommand = new ScanCommand({
      TableName: 'SundayGuide'
    });
    
    const { Items } = await docClient.send(scanCommand);
    
    if (!Items) return NextResponse.json({ success: true });

    // 更新所有助手状态为非活跃
    for (const item of Items) {
      await docClient.send(new UpdateCommand({
        TableName: 'SundayGuide',
        Key: {
          assistantId: item.assistantId,
          Timestamp: item.Timestamp
        },
        UpdateExpression: 'SET #status = :status',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'inactive'
        }
      }));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('停用所有助手失败:', error);
    return NextResponse.json(
      { error: '停用助手失败' },
      { status: 500 }
    );
  }
} 