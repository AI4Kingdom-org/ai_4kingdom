import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createDynamoDBClient } from '../../../utils/dynamodb';
import { DeleteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function DELETE(request: Request) {
  try {
    // 從請求體中獲取 fileId
    const { fileId } = await request.json();
    
    console.log(`[INFO] 嘗試刪除檔案:`, { fileId });
    
    if (!fileId) {
      return NextResponse.json(
        { error: '缺少必要參數 fileId' },
        { status: 400 }
      );
    }

    // 1. 首先刪除 OpenAI 平台上的檔案
    try {
      await openai.files.del(fileId);
      console.log(`[SUCCESS] 成功刪除 OpenAI 檔案 ID: ${fileId}`);
    } catch (error) {
      console.error(`[ERROR] 刪除 OpenAI 檔案失敗 ID: ${fileId}`, error);
      return NextResponse.json(
        { 
          error: '刪除 OpenAI 檔案失敗', 
          details: error instanceof Error ? error.message : '未知錯誤' 
        },
        { status: 500 }
      );
    }
    
    // 2. 刪除 DynamoDB 中的記錄
    const docClient = await createDynamoDBClient();
    const tableName = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
    
    // 獲取要刪除的記錄
    const queryParams = {
      TableName: tableName,
      FilterExpression: "fileId = :fileId",
      ExpressionAttributeValues: {
        ":fileId": fileId
      }
    };
    
    console.log(`[INFO] 查詢 DynamoDB 中的記錄，使用參數:`, queryParams);
    
    const scanResults = await docClient.send(new ScanCommand(queryParams));
      if (!scanResults.Items || scanResults.Items.length === 0) {
      console.log('[INFO] 在 DynamoDB 中沒有找到符合條件的記錄');
      
      return NextResponse.json({
        success: true,
        message: `成功刪除了檔案 (ID: ${fileId})，資料庫中沒有相關記錄`
      });
    }
    
    console.log(`[INFO] 在 DynamoDB 中找到 ${scanResults.Items.length} 條符合條件的記錄，開始刪除`);
    
    // 由於我們不確定確切的主鍵結構，我們將嘗試使用 assistantId 和 Timestamp 作為主鍵
    let dbSuccess = false;
    let deletedCount = 0;
    
    // 嘗試刪除所有找到的記錄
    for (const item of scanResults.Items) {
      try {
        if (item.assistantId && item.Timestamp) {
          const deleteParams = {
            TableName: tableName,
            Key: {
              assistantId: item.assistantId,
              Timestamp: item.Timestamp
            }
          };
          
          await docClient.send(new DeleteCommand(deleteParams));
          console.log(`[SUCCESS] 刪除記錄: assistantId=${item.assistantId}, Timestamp=${item.Timestamp}`);
          deletedCount++;
        }
      } catch (error) {
        console.error('[ERROR] 刪除資料庫記錄失敗:', error);
      }
    }
    
    dbSuccess = deletedCount > 0;
    console.log(`[INFO] 成功刪除 ${deletedCount}/${scanResults.Items.length} 條記錄`);
    
    // 使用第一條記錄的資料來返回檔案名稱
    const item = scanResults.Items[0];
    
    // 返回刪除結果
    return NextResponse.json({
      success: true,
      message: `成功刪除 OpenAI 檔案 (ID: ${fileId})${dbSuccess ? '及其資料庫記錄' : ''}`,
      fileName: item.fileName || '未知檔案名稱'
    });
    
  } catch (error) {
    console.error('[ERROR] 刪除檔案失敗:', error);
    return NextResponse.json(
      { error: '刪除檔案失敗', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}
