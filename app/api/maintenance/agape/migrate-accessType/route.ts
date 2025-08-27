import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ASSISTANT_IDS } from '@/app/config/constants';

const TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

export async function POST() {
  try {
    const client = await createDynamoDBClient();
    // Scan with pagination
    let items: any[] = [];
    let lastKey: any = undefined;
    do {
      const scan = await client.send(new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'assistantId = :aid',
        ExpressionAttributeValues: { ':aid': ASSISTANT_IDS.AGAPE_CHURCH },
        ExclusiveStartKey: lastKey
      }));
      items = items.concat(scan.Items || []);
      lastKey = scan.LastEvaluatedKey;
    } while (lastKey);
    let updated = 0;
    const diagnostics: any[] = [];
    for (const item of items) {
      const needsAccessFix = item.accessType !== 'public';
      const missing = ['summary','devotional','bibleStudy'].filter(k => !item[k]);
      if (needsAccessFix || missing.length) {
        await client.send(new UpdateCommand({
          TableName: TABLE,
          Key: { assistantId: item.assistantId, Timestamp: item.Timestamp },
          UpdateExpression: 'SET accessType = :pub',
          ExpressionAttributeValues: { ':pub': 'public' }
        }));
        updated++;
        diagnostics.push({ fileId: item.fileId, missing, oldAccess: item.accessType });
      }
    }
  return NextResponse.json({ success: true, total: items.length, updated, diagnostics });
  } catch (e:any) {
    return NextResponse.json({ success:false, error: e.message }, { status:500 });
  }
}
