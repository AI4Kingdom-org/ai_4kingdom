import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ASSISTANT_IDS } from '@/app/config/constants';

const TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

export async function GET() {
  try {
    const client = await createDynamoDBClient();
    let items: any[] = []; let lastKey: any;
    do {
      const res = await client.send(new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'assistantId = :a AND (unitId = :u OR userId IN (:u1, :u2))',
        ExpressionAttributeValues: { 
          ':a': ASSISTANT_IDS.SUNDAY_GUIDE,
          ':u': 'agape',
          ':u1': '1',
          ':u2': '24'
        },
        ExclusiveStartKey: lastKey
      }));
      items = items.concat(res.Items || []);
      lastKey = (res as any).LastEvaluatedKey;
    } while (lastKey);

    const enriched = items.map(i => ({
      fileId: i.fileId,
      fileName: i.fileName,
      Timestamp: i.Timestamp,
      updatedAt: i.updatedAt,
      generationStatus: i.generationStatus || (i.completed ? 'completed' : 'pending'),
      attemptCount: i.attemptCount || 0,
      summaryLen: i.summary ? i.summary.length : 0,
      devotionalLen: i.devotional ? i.devotional.length : 0,
      bibleStudyLen: i.bibleStudy ? i.bibleStudy.length : 0,
      lastError: i.lastError || null,
      completed: i.completed || false
    }));

    const stats = {
      total: enriched.length,
      byStatus: enriched.reduce((acc: any, r) => { acc[r.generationStatus] = (acc[r.generationStatus]||0)+1; return acc; }, {}),
      zeroContent: enriched.filter(r=> r.summaryLen===0 && r.devotionalLen===0 && r.bibleStudyLen===0).length
    };

    return NextResponse.json({ success:true, stats, records: enriched.sort((a,b)=> new Date(b.Timestamp).getTime()-new Date(a.Timestamp).getTime()) });
  } catch (e:any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 });
  }
}
