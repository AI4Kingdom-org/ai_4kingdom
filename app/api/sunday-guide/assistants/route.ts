import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../../utils/dynamodb';
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import OpenAI from 'openai';

const openai = new OpenAI();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode'); // 'active' 或 undefined
    
    const docClient = await createDynamoDBClient();
    console.log('[DEBUG] 开始获取助手列表, 模式:', mode);

    // 使用 Scan 操作，只过滤 status
    const command = new ScanCommand({
      TableName: 'SundayGuide',
      ...(mode === 'active' ? {
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'active'
        }
      } : {})
    });

    const response = await docClient.send(command);
    console.log('[DEBUG] DynamoDB 响应:', {
      itemCount: response.Items?.length,
      mode: mode
    });

    // 按时间戳排序
    const sortedItems = (response.Items || []).sort((a, b) => 
      b.Timestamp.localeCompare(a.Timestamp)
    );

    if (mode === 'active') {
      // 用户页面模式：只返回活跃助手
      const activeAssistant = sortedItems[0]; // 获取最新的活跃助手
      if (!activeAssistant) {
        return NextResponse.json({ error: '未找到活跃助手' }, { status: 404 });
      }
      return NextResponse.json({
        assistant: {
          assistantId: activeAssistant.assistantId,
          vectorStoreId: activeAssistant.vectorStoreId
        }
      });
    } else {
      // 管理页面模式：返回所有助手
      return NextResponse.json({
        assistants: sortedItems,
        total: sortedItems.length
      });
    }
  } catch (error) {
    console.error('[ERROR] 获取助手列表失败:', error);
    return NextResponse.json(
      { error: '获取助手列表失败', details: error instanceof Error ? error.message : '未知错误' },
      { status: 500 }
    );
  }
} 