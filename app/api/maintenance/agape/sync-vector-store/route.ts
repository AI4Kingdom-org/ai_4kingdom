import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { VECTOR_STORE_IDS, ASSISTANT_IDS } from '@/app/config/constants';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 同步 Agape 專用向量庫：
// 1. 列出向量庫現有文件
// 2. 取得 DynamoDB 中 unitId=agape 的有效 fileId 集合
// 3. 移除多餘 file
// 4. （可選）補上缺失 file（因上傳流程已同步，這裡先不做補）
export async function POST() {
  try {
    const agapeVector = VECTOR_STORE_IDS.AGAPE_CHURCH;
    if (!agapeVector) {
      return NextResponse.json({ error: '缺少 AGAPE 專用向量庫 ID' }, { status: 400 });
    }

    // 1. 列出現有 vector store files
    const existingFiles: string[] = [];
  const list = await openai.beta.vectorStores.files.list(agapeVector);
  existingFiles.push(...list.data.map(f => f.id));

    // 2. 查 DynamoDB SundayGuide 表取 unitId=agape 記錄
    const docClient = await createDynamoDBClient();
    const tableName = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
    const scan = await docClient.send(new ScanCommand({ TableName: tableName, FilterExpression: 'unitId = :u', ExpressionAttributeValues: { ':u': 'agape' }}));
    const allowed = new Set((scan.Items || []).map(r => r.fileId).filter(Boolean));

    // 3. 準備移除不屬於 agape 的 file
    const toRemove = existingFiles.filter(id => !allowed.has(id));
    let removed: string[] = [];
    for (const fileId of toRemove) {
      try {
        await openai.beta.vectorStores.files.del(agapeVector, fileId);
        removed.push(fileId);
      } catch (e) {
        console.warn('[WARN] 移除失敗', fileId, e);
      }
    }

    return NextResponse.json({ success: true, existingCount: existingFiles.length, allowedCount: allowed.size, removed });
  } catch (e) {
    console.error('同步失敗', e);
    return NextResponse.json({ error: '同步失敗', details: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
