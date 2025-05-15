import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { PutCommand, ScanCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.NEXT_PUBLIC_AI_PROMPTS_TABLE || 'AIPrompts';

export async function GET() {
  // 讀取所有 prompts
  try {
    const docClient = await createDynamoDBClient();
    const result = await docClient.send(new ScanCommand({ TableName: TABLE_NAME }));
    // 確保每個項目都有 content 欄位，從 prompt 欄位轉移，如果需要的話
    const normalizedItems = (result.Items || []).map(item => {
      let updatedItem = {...item};
      
      // 處理 content 欄位
      if (!updatedItem.content && updatedItem.prompt) {
        updatedItem.content = updatedItem.prompt;
      }
      
      // 處理欄位名稱不一致的問題
      if (updatedItem.lastupdated && !updatedItem.lastUpdated) {
        updatedItem.lastUpdated = updatedItem.lastupdated;
      }
      
      return updatedItem;
    });
    return NextResponse.json({ success: true, items: normalizedItems });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '未知錯誤' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // 新增 prompt
  try {
    const data = await request.json();
    if (!data.id || !data.content) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }
    // 移除任何 prompt 欄位，只使用 content
    const { prompt, ...restData } = data;
    // 添加 lastUpdated 欄位，記錄當前日期
    const itemWithDate = { 
      ...restData, 
      lastUpdated: new Date().toISOString() 
    };
    
    const docClient = await createDynamoDBClient();
    await docClient.send(new PutCommand({ TableName: TABLE_NAME, Item: itemWithDate }));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '未知錯誤' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  // 編輯 prompt
  try {
    const data = await request.json();
    if (!data.id || !data.content) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }
    // 移除任何 prompt 欄位，只使用 content
    const { prompt, ...restData } = data;
    const docClient = await createDynamoDBClient();
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { id: data.id },
      UpdateExpression: 'set content = :p, lastUpdated = :date',
      ExpressionAttributeValues: { 
        ':p': data.content,
        ':date': new Date().toISOString()
      }
    }));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '未知錯誤' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  // 刪除 prompt
  try {
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });
    }
    const docClient = await createDynamoDBClient();
    await docClient.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { id } }));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '未知錯誤' }, { status: 500 });
  }
}
