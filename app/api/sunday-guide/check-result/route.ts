import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';

const SUNDAY_GUIDE_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

async function scanAllPages(
  docClient: any,
  params: { TableName: string; FilterExpression: string; ExpressionAttributeValues: Record<string, any> },
  maxPages = 60
) {
  let items: any[] = [];
  let lastEvaluatedKey: any = undefined;
  let pages = 0;

  do {
    const res = await docClient.send(new ScanCommand({
      ...params,
      ExclusiveStartKey: lastEvaluatedKey
    }));
    items = items.concat(res.Items || []);
    lastEvaluatedKey = (res as any).LastEvaluatedKey;
    pages += 1;
  } while (lastEvaluatedKey && pages < maxPages);

  return items;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const vectorStoreId = url.searchParams.get('vectorStoreId');
    const fileName = url.searchParams.get('fileName');
    const unitId = url.searchParams.get('unitId');
    const fileId = url.searchParams.get('fileId');

    if (!vectorStoreId || !fileName) {
      return NextResponse.json(
        { error: '缺少必要參數', details: { vectorStoreId, fileName } },
        { status: 400 }
      );
    }

    console.log('[DEBUG] 檢查文件處理結果:', { vectorStoreId, fileName, unitId, fileId });

    const docClient = await createDynamoDBClient();

    // 查詢處理結果 - 修改為使用 generationStatus 或 completed
    // Check for completed records
    // 若提供 fileId，必須精確匹配該次上傳的記錄，避免同檔名的舊記錄（已完成）
    // 誤判為本次上傳已完成，導致前端過早顯示「處理完成」而內容其實仍在生成中
    const filterParts = ["vectorStoreId = :vectorStoreId", "fileName = :fileName"];
    if (unitId) filterParts.push("unitId = :unitId");
    if (fileId) filterParts.push("fileId = :fileId");
    filterParts.push("(generationStatus = :completed OR (attribute_not_exists(generationStatus) AND completed = :completedFlag))");
    const filterExpr = filterParts.join(" AND ");

    const completedParams: any = {
      TableName: SUNDAY_GUIDE_TABLE,
      FilterExpression: filterExpr,
      ExpressionAttributeValues: {
        ":vectorStoreId": vectorStoreId,
        ":fileName": fileName,
        ":completed": "completed",
        ":completedFlag": true
      }
    };

    if (unitId) {
      completedParams.ExpressionAttributeValues[":unitId"] = unitId;
    }
    if (fileId) {
      completedParams.ExpressionAttributeValues[":fileId"] = fileId;
    }

    const completedItems = await scanAllPages(docClient, completedParams);

    if (completedItems.length > 0) {
      const latestItem = completedItems.sort((a, b) =>
        new Date(b.Timestamp || "").getTime() - new Date(a.Timestamp || "").getTime()
      )[0];

      return NextResponse.json({
        found: true,
        summary: latestItem.summary,
        fullText: latestItem.fullText,
        devotional: latestItem.devotional,
        bibleStudy: latestItem.bibleStudy,
        sermonTitle: latestItem.sermonTitle || null,
        processingTime: latestItem.processingTime
      });
    }

    // Check for failed records
    const failedFilterParts = ["vectorStoreId = :vectorStoreId", "fileName = :fileName", "generationStatus = :failed"];
    if (fileId) failedFilterParts.push("fileId = :fileId");
    const failedParams = {
      TableName: SUNDAY_GUIDE_TABLE,
      FilterExpression: failedFilterParts.join(" AND "),
      ExpressionAttributeValues: {
        ":vectorStoreId": vectorStoreId,
        ":fileName": fileName,
        ":failed": "failed",
        ...(fileId ? { ":fileId": fileId } : {})
      }
    };
    const failedItems = await scanAllPages(docClient, failedParams);
    if (failedItems.length > 0) {
      const latestFailed = failedItems.sort((a, b) =>
        new Date(b.Timestamp || "").getTime() - new Date(a.Timestamp || "").getTime()
      )[0];
      return NextResponse.json({
        found: false,
        status: 'failed',
        error: latestFailed.lastError || '處理失敗'
      });
    }

    return NextResponse.json({
      found: false,
      status: 'processing',
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