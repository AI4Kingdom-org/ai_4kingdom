import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

function inferStatus(item: any): string {
  if (item.generationStatus) return String(item.generationStatus);
  return item.completed ? 'completed' : 'pending';
}

function toMillis(v?: string): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const minutes = Number(searchParams.get('stuckMinutes') || '15');
    const maxItems = Number(searchParams.get('maxItems') || '2000');

    const client = await createDynamoDBClient();
    let items: any[] = [];
    let lastKey: any;

    do {
      const res = await client.send(new ScanCommand({
        TableName: TABLE,
        ExclusiveStartKey: lastKey
      }));

      items = items.concat(res.Items || []);
      lastKey = (res as any).LastEvaluatedKey;

      if (items.length >= maxItems) {
        break;
      }
    } while (lastKey);

    const now = Date.now();
    const stuckMs = Math.max(1, minutes) * 60 * 1000;

    const byUnit: Record<string, number> = {};
    const byAssistant: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    const stuckRecords = items.filter((i) => {
      const status = inferStatus(i);
      if (!(status === 'pending' || status === 'processing')) return false;
      const ts = toMillis(i.updatedAt || i.Timestamp || i.uploadTimestamp);
      if (!ts) return true;
      return now - ts > stuckMs;
    }).map((i) => ({
      assistantId: i.assistantId || null,
      vectorStoreId: i.vectorStoreId || null,
      unitId: i.unitId || null,
      fileId: i.fileId || null,
      fileName: i.fileName || null,
      generationStatus: inferStatus(i),
      attemptCount: i.attemptCount || 0,
      lastError: i.lastError || null,
      updatedAt: i.updatedAt || null,
      Timestamp: i.Timestamp || null,
      userId: i.userId || i.UserId || null
    }));

    const keyIssues = items.filter((i) => {
      return !i.assistantId || !i.Timestamp || !i.fileId || !i.fileName || !i.vectorStoreId;
    }).map((i) => ({
      assistantId: i.assistantId || null,
      Timestamp: i.Timestamp || null,
      fileId: i.fileId || null,
      fileName: i.fileName || null,
      vectorStoreId: i.vectorStoreId || null,
      unitId: i.unitId || null,
      generationStatus: inferStatus(i)
    }));

    for (const i of items) {
      const unit = (i.unitId || 'default').toString();
      const assistant = (i.assistantId || 'unknown').toString();
      const status = inferStatus(i);
      byUnit[unit] = (byUnit[unit] || 0) + 1;
      byAssistant[assistant] = (byAssistant[assistant] || 0) + 1;
      byStatus[status] = (byStatus[status] || 0) + 1;
    }

    const recentFailed = items
      .filter((i) => inferStatus(i) === 'failed')
      .sort((a, b) => toMillis(b.updatedAt || b.Timestamp) - toMillis(a.updatedAt || a.Timestamp))
      .slice(0, 20)
      .map((i) => ({
        assistantId: i.assistantId || null,
        unitId: i.unitId || null,
        fileId: i.fileId || null,
        fileName: i.fileName || null,
        lastError: i.lastError || null,
        updatedAt: i.updatedAt || null,
        Timestamp: i.Timestamp || null
      }));

    return NextResponse.json({
      success: true,
      table: TABLE,
      scannedCount: items.length,
      truncated: items.length >= maxItems,
      stuckCriteriaMinutes: minutes,
      stats: {
        byUnit,
        byAssistant,
        byStatus,
        stuckCount: stuckRecords.length,
        keyIssueCount: keyIssues.length,
        recentFailedCount: recentFailed.length
      },
      stuckRecords,
      keyIssues,
      recentFailed
    });
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e?.message || 'Unknown error'
    }, { status: 500 });
  }
}
