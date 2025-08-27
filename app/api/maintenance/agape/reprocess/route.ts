import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '@/app/config/constants';

const TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

interface Body { fileIds?: string[]; mode?: 'failed'|'pending'|'all'; limit?: number; }

export async function POST(req: Request) {
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
        await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/sunday-guide/process-document`, {
          method: 'POST',
          headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({
            assistantId: ASSISTANT_IDS.AGAPE_CHURCH,
            vectorStoreId: t.vectorStoreId || VECTOR_STORE_IDS.AGAPE_CHURCH,
            fileName: t.fileName,
            userId: t.userId,
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
