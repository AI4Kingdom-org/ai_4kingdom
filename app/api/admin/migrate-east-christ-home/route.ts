import { NextRequest, NextResponse } from 'next/server';
import { ScanCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '@/app/config/constants';
import OpenAI from 'openai';

const TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
const OLD_ASSISTANT_ID = ASSISTANT_IDS.AGAPE_CHURCH;
const OLD_VS_ID = VECTOR_STORE_IDS.AGAPE_CHURCH;
const NEW_ASSISTANT_ID = ASSISTANT_IDS.EAST_CHRIST_HOME;
const NEW_VS_ID = VECTOR_STORE_IDS.EAST_CHRIST_HOME;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface MigrateBody {
  userId: string;
  dryRun?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const { userId, dryRun = true } = (await req.json()) as MigrateBody;

    if (userId !== '1') {
      return NextResponse.json({ success: false, error: '沒有權限執行此操作' }, { status: 403 });
    }

    const client = await createDynamoDBClient();

    // Scan all eastChristHome records
    let allRecords: any[] = [];
    let lastKey: any = undefined;
    do {
      const result = await client.send(new ScanCommand({
        TableName: TABLE,
        FilterExpression: 'unitId = :u',
        ExpressionAttributeValues: { ':u': 'eastChristHome' },
        ExclusiveStartKey: lastKey,
      }));
      allRecords = allRecords.concat(result.Items || []);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    const migrated: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const record of allRecords) {
      const { assistantId, Timestamp, fileId, fileName } = record;
      const label = `${fileName || fileId || Timestamp}`;

      // Already migrated
      if (assistantId === NEW_ASSISTANT_ID) {
        skipped.push(`${label} (已是新 assistantId，跳過)`);
        continue;
      }

      if (!fileId) {
        skipped.push(`${label} (無 fileId，跳過)`);
        continue;
      }

      if (dryRun) {
        migrated.push(`[DRY RUN] ${label}`);
        continue;
      }

      try {
        // (a) Add file to new VS (idempotent: ignore if already exists)
        try {
          await openai.beta.vectorStores.files.create(NEW_VS_ID, { file_id: fileId });
        } catch (e: any) {
          if (!e?.message?.includes('already')) throw e;
        }

        // (b) Remove file from old VS (idempotent: ignore if not found)
        try {
          await openai.beta.vectorStores.files.del(OLD_VS_ID, fileId);
        } catch (e: any) {
          if (!e?.status || e.status !== 404) throw e;
        }

        // (c) Update DynamoDB: Delete old item (PK=assistantId) + Put new item with new assistantId
        const newItem = {
          ...record,
          assistantId: NEW_ASSISTANT_ID,
          vectorStoreId: NEW_VS_ID,
          updatedAt: new Date().toISOString(),
        };

        await client.send(new PutCommand({ TableName: TABLE, Item: newItem }));
        await client.send(new DeleteCommand({
          TableName: TABLE,
          Key: { assistantId: OLD_ASSISTANT_ID, Timestamp },
        }));

        migrated.push(label);
      } catch (e: any) {
        errors.push(`${label}: ${e?.message || String(e)}`);
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      summary: { total: allRecords.length, migrated: migrated.length, skipped: skipped.length, errors: errors.length },
      migrated,
      skipped,
      errors,
    });
  } catch (error: any) {
    console.error('Migration failed:', error);
    return NextResponse.json({ success: false, error: error?.message || '遷移失敗' }, { status: 500 });
  }
}
