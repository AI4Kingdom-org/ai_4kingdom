import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

type Body = {
  mode?: 'mark-failed';
  staleMinutes?: number;
  limit?: number;
  dryRun?: boolean;
  unitId?: string;
  errorMessage?: string;
};

function toMillis(v?: string): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function inferStatus(item: any): string {
  if (item.generationStatus) return String(item.generationStatus);
  return item.completed ? 'completed' : 'pending';
}

function isCandidate(item: any, now: number, staleMs: number, unitId?: string): boolean {
  const status = inferStatus(item);
  if (!(status === 'pending' || status === 'processing')) return false;
  if (unitId && String(item.unitId || '') !== unitId) return false;

  const ts = toMillis(item.updatedAt || item.Timestamp || item.uploadTimestamp);
  if (!ts) return true;
  return (now - ts) > staleMs;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const mode = body.mode || 'mark-failed';
    const staleMinutes = Math.max(1, Number(body.staleMinutes || 10));
    const limit = Math.max(1, Number(body.limit || 200));
    const dryRun = body.dryRun !== false;
    const unitId = body.unitId;
    const errorMessage =
      body.errorMessage ||
      'Batch remediation: marked as failed because record stayed pending/processing over threshold.';

    if (mode !== 'mark-failed') {
      return NextResponse.json({ success: false, error: 'Only mode=mark-failed is supported.' }, { status: 400 });
    }

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
      if (items.length >= 5000) break;
    } while (lastKey);

    const now = Date.now();
    const staleMs = staleMinutes * 60 * 1000;

    const candidates = items
      .filter((i) => isCandidate(i, now, staleMs, unitId))
      .sort((a, b) => toMillis(a.updatedAt || a.Timestamp) - toMillis(b.updatedAt || b.Timestamp))
      .slice(0, limit)
      .map((i) => ({
        assistantId: i.assistantId,
        Timestamp: i.Timestamp,
        fileId: i.fileId,
        fileName: i.fileName,
        unitId: i.unitId || 'default',
        vectorStoreId: i.vectorStoreId,
        previousStatus: inferStatus(i),
        attemptCount: i.attemptCount || 0,
        updatedAt: i.updatedAt || null,
        userId: i.userId || i.UserId || null
      }))
      .filter((i) => !!i.assistantId && !!i.Timestamp);

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        table: TABLE,
        staleMinutes,
        limit,
        candidateCount: candidates.length,
        candidates
      });
    }

    const updated: Array<{ assistantId: string; Timestamp: string; fileId?: string; fileName?: string; unitId?: string }> = [];
    const failedUpdates: Array<{ assistantId?: string; Timestamp?: string; error: string }> = [];

    for (const c of candidates) {
      try {
        await client.send(new UpdateCommand({
          TableName: TABLE,
          Key: { assistantId: c.assistantId, Timestamp: c.Timestamp },
          UpdateExpression: 'SET generationStatus = :failed, lastError = :err, updatedAt = :now, attemptCount = if_not_exists(attemptCount, :zero) + :one, completed = :completed',
          ExpressionAttributeValues: {
            ':failed': 'failed',
            ':err': errorMessage,
            ':now': new Date().toISOString(),
            ':one': 1,
            ':zero': 0,
            ':completed': false
          }
        }));
        updated.push({
          assistantId: c.assistantId,
          Timestamp: c.Timestamp,
          fileId: c.fileId,
          fileName: c.fileName,
          unitId: c.unitId
        });
      } catch (e: any) {
        failedUpdates.push({
          assistantId: c.assistantId,
          Timestamp: c.Timestamp,
          error: e?.message || 'Unknown update error'
        });
      }
    }

    return NextResponse.json({
      success: true,
      dryRun: false,
      table: TABLE,
      staleMinutes,
      limit,
      candidateCount: candidates.length,
      updatedCount: updated.length,
      updateErrorCount: failedUpdates.length,
      updated,
      failedUpdates
    });
  } catch (e: any) {
    return NextResponse.json({
      success: false,
      error: e?.message || 'Unknown error'
    }, { status: 500 });
  }
}
