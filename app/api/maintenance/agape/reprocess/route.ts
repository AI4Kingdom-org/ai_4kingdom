import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '@/app/config/constants';
import { requireAdmin } from '@/app/lib/identity/admin';
import { internalRequestHeaders } from '@/app/lib/identity/server';

const TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

interface Body { fileIds?: string[]; mode?: 'failed'|'pending'|'all'; limit?: number; }

export async function POST(req: Request) {
  // 管理用端點：僅限管理員或帶 service token 的內部呼叫（見 app/lib/identity/admin.ts）
  const auth = await requireAdmin(req);
  if ('response' in auth) return auth.response;

  try {
    const body: Body = await req.json().catch(()=>({}));
    const { fileIds, mode='failed', limit=25 } = body;
    const client = await createDynamoDBClient();
    let items: any[] = []; let lastKey: any;
    do {
      const res = await client.send(new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'assistantId = :a',
        ExpressionAttributeValues: { ':a': ASSISTANT_IDS.AGAPE_CHURCH },
        ExclusiveStartKey: lastKey
      }));
      items = items.concat(res.Items || []);
      lastKey = (res as any).LastEvaluatedKey;
    } while (lastKey);

    let targets = items;
    if (fileIds && fileIds.length) {
      targets = targets.filter(i => fileIds.includes(i.fileId));
    } else if (mode === 'failed') {
      targets = targets.filter(i => (i.generationStatus === 'failed') || (i.lastError && !i.summary && !i.devotional && !i.bibleStudy));
    } else if (mode === 'pending') {
      targets = targets.filter(i => (i.generationStatus === 'pending' || i.generationStatus === 'processing'));
    }

    targets = targets.slice(0, limit);

    const kicked: any[] = [];
    for (const t of targets) {
      try {
        const apiOrigin = new URL(req.url).origin;
        await fetch(`${apiOrigin}/api/sunday-guide/process-document`, {
          method: 'POST',
          // process-document 需驗證身分；以內部呼叫標頭觸發，userId 沿用原紀錄
          headers: { 'Content-Type':'application/json', ...internalRequestHeaders() },
          body: JSON.stringify({
            assistantId: ASSISTANT_IDS.AGAPE_CHURCH,
            vectorStoreId: t.vectorStoreId || VECTOR_STORE_IDS.AGAPE_CHURCH,
            fileName: t.fileName,
            userId: t.userId,
            fileId: t.fileId,
            unitId: t.unitId || 'agape',
          })
        });
        kicked.push({ fileId: t.fileId, fileName: t.fileName });
      } catch (e:any) {
        kicked.push({ fileId: t.fileId, fileName: t.fileName, error: e.message });
      }
      await new Promise(r=> setTimeout(r, 300)); // throttle
    }

    return NextResponse.json({ success:true, count: kicked.length, kicked });
  } catch (e:any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 });
  }
}
