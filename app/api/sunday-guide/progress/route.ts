import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const PROGRESS_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_PROGRESS || 'SundayGuideProgress';
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

    console.log('[DEBUG] 檢查文件處理進度:', { vectorStoreId, fileName });
    
    const docClient = await createDynamoDBClient();
    
    // 1. 首先檢查是否已處理完成 - 使用 generationStatus 或舊的 completed 欄位
    const completedParams = {
      TableName: SUNDAY_GUIDE_TABLE,
      FilterExpression: "vectorStoreId = :vectorStoreId AND fileName = :fileName AND (generationStatus = :completed OR (attribute_not_exists(generationStatus) AND completed = :completedFlag))",
      ExpressionAttributeValues: {
        ":vectorStoreId": vectorStoreId,
        ":fileName": fileName,
        ":completed": "completed",
        ":completedFlag": true
      }
    };

    const completedResult = await docClient.send(new ScanCommand(completedParams));
    
    if (completedResult.Items && completedResult.Items.length > 0) {
      // 找到已完成的記錄，表示處理已完成
      const latestItem = completedResult.Items.sort((a, b) => 
        new Date(b.Timestamp || "").getTime() - new Date(a.Timestamp || "").getTime()
      )[0];
      
      // 檢查是否真的有內容（避免 completed=true 但內容空白）
      const hasContent = latestItem.summary && latestItem.devotional && latestItem.bibleStudy;
      
      if (hasContent) {
        return NextResponse.json({
          status: 'completed',
          result: {
            summary: latestItem.summary,
            fullText: latestItem.fullText,
            devotional: latestItem.devotional,
            bibleStudy: latestItem.bibleStudy
          },
          processingTime: latestItem.processingTime
        });
      } else if (latestItem.generationStatus === 'failed') {
        return NextResponse.json({
          status: 'failed',
          error: latestItem.lastError || '處理失敗',
          stage: 'unknown'
        });
      } else {
        // 標記為完成但無內容，可能仍在處理中
        return NextResponse.json({
          status: 'processing',
          stage: latestItem.generationStatus === 'processing' ? 'unknown' : 'summary',
          progress: 50
        });
      }
    }
    
    // 2. 否則檢查進度表中的狀態
    const progressParams = {
      TableName: PROGRESS_TABLE,
      FilterExpression: "vectorStoreId = :vectorStoreId AND fileName = :fileName",
      ExpressionAttributeValues: {
        ":vectorStoreId": vectorStoreId,
        ":fileName": fileName
      }
    };
    
    const progressResult = await docClient.send(new ScanCommand(progressParams));
    
    if (progressResult.Items && progressResult.Items.length > 0) {
      // 找到進度記錄
      const latestProgress = progressResult.Items.sort((a, b) => 
        new Date(b.updatedAt || "").getTime() - new Date(a.updatedAt || "").getTime()
      )[0];
      
      if (latestProgress.status === 'failed') {
        return NextResponse.json({
          status: 'failed',
          error: latestProgress.error || '處理失敗',
          stage: latestProgress.stage
        });
      }
      
      return NextResponse.json({
        status: 'processing',
        stage: latestProgress.stage || 'summary',
        progress: latestProgress.progress || 0
      });
    }
    
    // 3. 都找不到記錄，可能是尚未開始處理或記錄已丟失
    return NextResponse.json({
      status: 'unknown',
      message: '找不到處理記錄，請確認是否已啟動處理流程'
    });

  } catch (error) {
    console.error('[ERROR] 檢查進度失敗:', error);
    return NextResponse.json(
      { error: '檢查進度失敗', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}