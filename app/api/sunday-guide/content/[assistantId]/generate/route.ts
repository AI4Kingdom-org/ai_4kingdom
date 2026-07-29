import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../../../../utils/dynamodb';
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getOpenAI } from '../../../../../lib/openai/client';
import { generateResponse } from '../../../../../lib/openai/responses';

export async function POST(
  request: Request,
  { params }: { params: { assistantId: string } }
) {
  try {
    const { assistantId } = params;
    const { type, fileId } = await request.json();

    if (!fileId) {
      return NextResponse.json({ error: '未提供文件 ID' }, { status: 400 });
    }

    // 1. 先取得助手記錄（含 vectorStoreId，Responses API 需在呼叫時綁定向量庫）
    const docClient = await createDynamoDBClient();
    const getCommand = new ScanCommand({
      TableName: 'SundayGuide',
      FilterExpression: 'assistantId = :assistantId',
      ExpressionAttributeValues: {
        ':assistantId': assistantId
      }
    });

    const response = await docClient.send(getCommand);
    if (!response.Items?.length) {
      return NextResponse.json({ error: '未找到助手記錄' }, { status: 404 });
    }
    const record = response.Items[0];
    if (!record.vectorStoreId) {
      // Responses API 沒有「assistant 綁定向量庫」的概念，若記錄缺少 vectorStoreId，
      // file_search 工具將不會被帶入，生成內容會失去文件依據——寧可直接報錯，也不要默默生成無根據的總結。
      console.error('[ERROR] SundayGuide 記錄缺少 vectorStoreId，無法綁定向量庫:', { assistantId, Timestamp: record.Timestamp });
      return NextResponse.json({ error: '助手記錄缺少 vectorStoreId，無法檢索文件內容' }, { status: 500 });
    }

    // 2. 單次 Responses 呼叫生成總結（取代舊 thread + run + 輪詢）
    const openai = getOpenAI();
    const result = await generateResponse(openai, {
      assistantId,
      input: [{
        role: 'user',
        content: `請用中文總結這個文件的內容。如果內容包含多個部分，請確保每個部分都被涵蓋。`
      }],
      vectorStoreId: record.vectorStoreId,
    });

    if (result.status !== 'completed') {
      throw new Error(`運行失敗: ${result.status}`);
    }

    const summary = result.text;

    // 3. 將總結保存到數據庫
    const updateCommand = new UpdateCommand({
      TableName: 'SundayGuide',
      Key: {
        assistantId: assistantId,
        Timestamp: record.Timestamp
      },
      UpdateExpression: 'SET sermon_summary = :summary',
      ExpressionAttributeValues: {
        ':summary': summary
      }
    });

    await docClient.send(updateCommand);

    return NextResponse.json({
      success: true,
      summary
    });
  } catch (error) {
    console.error('生成總結失敗:', error);
    return NextResponse.json(
      { error: '生成總結失敗', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}
