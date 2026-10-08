import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../../../utils/dynamodb';
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const SUNDAY_GUIDE_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

// 讀取已生成的信息總結／靈修／查經不扣額度（內容是上傳時就生成好的，讀取不呼叫 OpenAI），
// 訪客與會員皆可閱讀。

export async function GET(
  request: Request,
  { params }: { params: { assistantId: string } }
) {
  try {
    const { assistantId } = params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');  // 獲取內容類型
    const userId = searchParams.get('userId'); // 獲取用戶 ID
    const fileId = searchParams.get('fileId'); // 獲取檔案 ID
    
    console.log('[DEBUG] API 請求參數:', { assistantId, type, userId, fileId });
    
    // 確認必要參數
    if (!type) {
      return NextResponse.json({ error: '缺少內容類型參數' }, { status: 400 });
    }
    
    const docClient = await createDynamoDBClient();
    
    let scanFilterExpression: string;
    let scanExpressionAttributeValues: Record<string, any>;

    if (fileId) {
      // 如果提供了 fileId，根據 fileId 查詢特定檔案
      scanFilterExpression = 'assistantId = :assistantId AND fileId = :fileId';
      scanExpressionAttributeValues = {
        ':assistantId': assistantId,
        ':fileId': fileId
      };
    } else if (userId) {
      // 如果只提供了 userId，查詢該用戶最新的檔案
      scanFilterExpression = 'assistantId = :assistantId AND (userId = :userId OR UserId = :userId)';
      scanExpressionAttributeValues = {
        ':assistantId': assistantId,
        ':userId': userId
      };
    } else {
      // 沒有特定條件，查詢所有檔案
      scanFilterExpression = 'assistantId = :assistantId';
      scanExpressionAttributeValues = {
        ':assistantId': assistantId
      };
    }

    // 分頁掃描，避免只拿到 DynamoDB 首頁 1MB 資料導致找不到記錄
    let items: any[] = [];
    let lastEvaluatedKey: any = undefined;
    let scanPages = 0;
    const MAX_SCAN_PAGES = 50;
    do {
      const result = await docClient.send(new ScanCommand({
        TableName: SUNDAY_GUIDE_TABLE,
        FilterExpression: scanFilterExpression,
        ExpressionAttributeValues: scanExpressionAttributeValues,
        ExclusiveStartKey: lastEvaluatedKey
      }));
      items = items.concat(result.Items || []);
      lastEvaluatedKey = result.LastEvaluatedKey;
      scanPages++;
    } while (lastEvaluatedKey && scanPages < MAX_SCAN_PAGES);

    console.log('[DEBUG] 查詢結果:', { itemCount: items.length, scanPages });
    if (items.length > 0) {
      console.log('[DEBUG] 第一筆記錄:', JSON.stringify(items[0]).substring(0, 300));
    }

    if (items.length === 0) {
      return NextResponse.json({ error: '未找到內容' }, { status: 404 });
    }

    // 獲取最新的文件內容
    const latestItem = items.sort((a, b) => 
      new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime()
    )[0];

    console.log('[DEBUG] 選中的記錄:', { 
      fileName: latestItem.fileName, 
      fileId: latestItem.fileId, 
      timestamp: latestItem.Timestamp,
      hasContent: {
        summary: !!latestItem.summary,
        devotional: !!latestItem.devotional,
        bibleStudy: !!latestItem.bibleStudy
      }
    });

    // 根據類型返回對應內容
    let content: string | null = null;
    switch (type) {
      case 'summary':
        content = latestItem.summary;
        break;
      case 'text':
        content = latestItem.fullText;
        break;
      case 'devotional':
        content = latestItem.devotional;
        break;
      case 'bible':
        content = latestItem.bibleStudy;
        break;
      default:
        return NextResponse.json({ error: '無效的內容類型' }, { status: 400 });
    }

    if (!content) {
      // 檢查生成狀態，提供更友好的錯誤訊息
      if (latestItem.generationStatus === 'processing' || latestItem.generationStatus === 'uploading') {
         return NextResponse.json({ 
             error: '內容正在生成中，請稍候...', 
             status: 'processing' 
         }, { status: 202 }); // 202 Accepted
      }
      
      if (latestItem.generationStatus === 'failed') {
          return NextResponse.json({ 
              error: `內容生成失敗: ${latestItem.lastError || '未知錯誤'}`, 
              status: 'failed',
              details: latestItem.lastError
          }, { status: 422 }); // 422 Unprocessable Entity
      }

      return NextResponse.json({ error: '未找到請求的內容類型' }, { status: 404 });
    }

    return NextResponse.json({ content });

  } catch (error) {
    console.error('獲取內容失敗:', error);
    return NextResponse.json(
      { error: '獲取內容失敗', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}
