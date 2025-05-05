import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

// 定義主日信息導航 PDF 下載的 API 路由
export async function GET(
  request: Request,
  { params }: { params: { id?: string } }
) {
  try {
    // 獲取查詢參數
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'summary';
    const userId = url.searchParams.get('userId');
    const format = url.searchParams.get('format') || 'simplified';
    
    if (!userId) {
      return NextResponse.json(
        { error: '缺少必要參數: userId' },
        { status: 400 }
      );
    }

    // 獲取內容（從數據庫或其他來源）
    const content = await getContentForPDF(type, userId);
    
    if (!content) {
      return NextResponse.json(
        { error: '找不到請求的內容' },
        { status: 404 }
      );
    }

    // 返回內容以供前端處理
    return NextResponse.json({
      success: true,
      content,
      type,
      format
    });
  } catch (error) {
    console.error('[ERROR] PDF下載請求處理失敗:', error);
    return NextResponse.json(
      { error: '處理請求時發生錯誤' },
      { status: 500 }
    );
  }
}

// 獲取內容的輔助函數
async function getContentForPDF(type: string, userId: string) {
  try {
    const docClient = await createDynamoDBClient();
    
    // 這裡實現實際獲取內容的邏輯
    // 示例實現，實際應該根據您的數據結構調整
    const command = new ScanCommand({
      TableName: process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide',
      FilterExpression: 'ContentType = :type',
      ExpressionAttributeValues: {
        ':type': type
      },
      Limit: 1
    });

    const response = await docClient.send(command);
    
    if (response.Items && response.Items.length > 0) {
      return response.Items[0].Content;
    }
    
    return null;
  } catch (error) {
    console.error('[ERROR] 獲取PDF內容失敗:', error);
    throw error;
  }
}