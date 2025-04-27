import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';

const SUNDAY_GUIDE_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const vectorStoreId = url.searchParams.get('vectorStoreId');
    const fileName = url.searchParams.get('fileName');

    if (!vectorStoreId || !fileName) {
      return NextResponse.json(
        { error: '缺少必要參數', details: { vectorStoreId, fileName } },
        { status: 400 }
      );
    }

    console.log('[DEBUG] 檢查文件處理結果:', { vectorStoreId, fileName });
    
    const docClient = await createDynamoDBClient();
    
    // 查詢處理結果
    const params = {
      TableName: SUNDAY_GUIDE_TABLE,
      FilterExpression: "vectorStoreId = :vectorStoreId AND fileName = :fileName AND completed = :completed",
      ExpressionAttributeValues: {
        ":vectorStoreId": vectorStoreId,
        ":fileName": fileName,
        ":completed": true
      }
    };

    const result = await docClient.send(new ScanCommand(params));
    
    if (result.Items && result.Items.length > 0) {
      // 找到已完成的記錄
      const latestItem = result.Items.sort((a, b) => 
        new Date(b.Timestamp || "").getTime() - new Date(a.Timestamp || "").getTime()
      )[0];
      
      return NextResponse.json({
        found: true,
        summary: latestItem.summary,
        fullText: latestItem.fullText,
        devotional: latestItem.devotional,
        bibleStudy: latestItem.bibleStudy,
        processingTime: latestItem.processingTime
      });
    }
    
    // 沒有找到結果
    return NextResponse.json({
      found: false,
      message: '處理尚未完成'
    });

  } catch (error) {
    console.error('[ERROR] 檢查結果失敗:', error);
    return NextResponse.json(
      { error: '檢查結果失敗', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}