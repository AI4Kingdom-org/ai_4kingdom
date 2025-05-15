import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createDynamoDBClient } from '../../../utils/dynamodb';
import { DeleteCommand, ScanCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const vectorStoreId = searchParams.get('vectorStoreId');
    const assistantId = searchParams.get('assistantId');
    
    console.log(`[INFO] 嘗試刪除所有向量儲存檔案${vectorStoreId ? `（向量儲存ID：${vectorStoreId}）` : ''}${assistantId ? `（助手ID：${assistantId}）` : ''}`);
    
    // 1. 首先刪除 OpenAI 平台上的檔案
    const files = await openai.files.list();
    const assistantsFiles = files.data.filter(file => file.purpose === 'assistants');
    
    if (assistantsFiles.length === 0) {
      console.log('[INFO] OpenAI 平台上沒有找到任何助手用途的檔案');
    } else {
      console.log(`[INFO] 找到 ${assistantsFiles.length} 個 OpenAI 助手檔案，開始刪除`);
    }
    
    // 刪除 OpenAI 檔案
    const deletionPromises = assistantsFiles.map(async (file) => {
      try {
        await openai.files.del(file.id);
        console.log(`[SUCCESS] 成功刪除 OpenAI 檔案: ${file.filename} (ID: ${file.id})`);
        return { 
          fileId: file.id, 
          fileName: file.filename, 
          success: true 
        };
      } catch (error) {
        console.error(`[ERROR] 刪除 OpenAI 檔案失敗: ${file.filename} (ID: ${file.id})`, error);
        return { 
          fileId: file.id, 
          fileName: file.filename, 
          success: false, 
          error: error instanceof Error ? error.message : '未知錯誤'
        };
      }
    });
    
    const deletionResults = await Promise.all(deletionPromises);
    const successfulDeletions = deletionResults.filter(result => result.success);
    
    console.log(`[INFO] OpenAI 檔案刪除完成: ${successfulDeletions.length}/${assistantsFiles.length} 個檔案成功刪除`);
    
    // 2. 現在刪除 DynamoDB 中的記錄
    const docClient = await createDynamoDBClient();
    const tableName = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
    
    // 獲取要刪除的記錄
    const queryParams: any = {
      TableName: tableName
    };
    
    // 根據請求參數添加過濾條件
    const filterExpressions = [];
    const expressionAttributeValues: any = {};
    
    if (vectorStoreId) {
      filterExpressions.push("vectorStoreId = :vectorStoreId");
      expressionAttributeValues[":vectorStoreId"] = vectorStoreId;
    }
    
    if (assistantId) {
      filterExpressions.push("assistantId = :assistantId");
      expressionAttributeValues[":assistantId"] = assistantId;
    }
    
    if (filterExpressions.length > 0) {
      queryParams.FilterExpression = filterExpressions.join(" AND ");
      queryParams.ExpressionAttributeValues = expressionAttributeValues;
    }
    
    console.log(`[INFO] 查詢 DynamoDB 中的記錄，使用參數:`, queryParams);
    
    const scanResults = await docClient.send(new ScanCommand(queryParams));
    
    if (!scanResults.Items || scanResults.Items.length === 0) {
      console.log('[INFO] 在 DynamoDB 中沒有找到符合條件的記錄');
      
      return NextResponse.json({
        message: `成功刪除了 ${successfulDeletions.length} 個 OpenAI 檔案，資料庫中沒有相關記錄`,
        deletedCount: successfulDeletions.length,
        totalCount: assistantsFiles.length,
        dbRecordsCount: 0
      });
    }
    
    console.log(`[INFO] 在 DynamoDB 中找到 ${scanResults.Items.length} 條符合條件的記錄，開始刪除`);
    
    // 由於我們不確定確切的主鍵結構，我們將嘗試多種不同的主鍵組合
    let dbSuccessCount = 0;
    let dbFailCount = 0;
    
    for (const item of scanResults.Items) {
      try {
        const keys = Object.keys(item);
        console.log('[DEBUG] DynamoDB item keys:', keys, 'item:', item);

        // 嘗試用所有 key 組合作為主鍵
        let deleted = false;
        for (let i = 0; i < keys.length; i++) {
          for (let j = 0; j < keys.length; j++) {
            if (i === j) continue;
            const key1 = keys[i];
            const key2 = keys[j];
            const deleteParams = {
              TableName: tableName,
              Key: {
                [key1]: item[key1],
                [key2]: item[key2]
              }
            };
            try {
              await docClient.send(new DeleteCommand(deleteParams));
              console.log(`[SUCCESS] 刪除記錄: ${key1}=${item[key1]}, ${key2}=${item[key2]}`);
              dbSuccessCount++;
              deleted = true;
              break;
            } catch (err) {
              // 忽略失敗，繼續嘗試
            }
          }
          if (deleted) break;
        }
        // 單鍵嘗試
        if (!deleted) {
          for (const key of keys) {
            const deleteParams = {
              TableName: tableName,
              Key: { [key]: item[key] }
            };
            try {
              await docClient.send(new DeleteCommand(deleteParams));
              console.log(`[SUCCESS] 刪除記錄: ${key}=${item[key]}`);
              dbSuccessCount++;
              deleted = true;
              break;
            } catch (err) {
              // 忽略失敗
            }
          }
        }
        if (!deleted) {
          dbFailCount++;
          console.error('[ERROR] 無法刪除記錄，所有主鍵組合均失敗:', item);
        }
      } catch (error) {
        dbFailCount++;
        console.error('[ERROR] 刪除資料庫記錄失敗:', error);
      }
    }
    
    console.log(`[INFO] DynamoDB 記錄處理完成: 成功=${dbSuccessCount}, 失敗=${dbFailCount}, 總計=${scanResults.Items.length}`);
    
    // 返回刪除結果
    return NextResponse.json({
      message: `成功刪除了 ${successfulDeletions.length} 個 OpenAI 檔案和 ${dbSuccessCount} 條資料庫記錄`,
      deletedOpenAIFiles: successfulDeletions.length,
      totalOpenAIFiles: assistantsFiles.length,
      deletedDbRecords: dbSuccessCount,
      failedDbRecords: dbFailCount,
      totalDbRecords: scanResults.Items.length
    });
    
  } catch (error) {
    console.error('[ERROR] 批量刪除檔案失敗:', error);
    return NextResponse.json(
      { error: '批量刪除檔案失敗', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}