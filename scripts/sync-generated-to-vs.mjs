/**
 * 一次性腳本：把 DynamoDB 中已有 summary/devotional/bibleStudy 的記錄
 * 直接上傳到對應單位的 OpenAI Vector Store，不重跑 AI。
 *
 * 用法：
 *   node scripts/sync-generated-to-vs.mjs [--dates 2026-03-22,2026-03-15] [--dry-run]
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── 載入 .env.local ───────────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env.local');
const envVars = readFileSync(envPath, 'utf-8')
  .split('\n')
  .filter(l => l.trim() && !l.startsWith('#'))
  .reduce((acc, l) => {
    const [k, ...v] = l.split('=');
    acc[k.trim()] = v.join('=').trim().replace(/^["']|["']$/g, '');
    return acc;
  }, {});
Object.assign(process.env, envVars);

// ── 設定 ──────────────────────────────────────────────────────────────────────
const REGION    = process.env.NEXT_PUBLIC_REGION || 'us-east-2';
const TABLE     = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
const OPENAI_KEY = process.env.OPENAI_API_KEY;

// 單位 → 共用向量庫 ID
const UNIT_VECTOR_STORES = {
  agape:         'vs_68a9ee54724c8191b6a7d574a59ca91a',
  eastChristHome:'vs_69f204caa1f88191ab85505bcd04f09f',
  jianZhu:       'vs_6853c96fdfb88191a8421097e5bea232',
  cfscChurch:    'vs_6a033b3feb8c8191a802c848539322a1',
  default:       'vs_67c549731c10819192a57550f0dd37f4',
};

// ── CLI 參數 ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const datesArg = args.find(a => a.startsWith('--dates'));
const targetDates = datesArg
  ? datesArg.split('=')[1].split(',').map(d => d.trim())
  : ['2026-03-22', '2026-03-15'];

console.log('目標日期:', targetDates);
console.log('Dry-run:', dryRun);

// ── DynamoDB ──────────────────────────────────────────────────────────────────
const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: REGION,
    credentials: {
      accessKeyId: process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
      secretAccessKey: process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
    }
  })
);

async function scanAll(filterFn) {
  let items = [], lastKey;
  do {
    const res = await dynamo.send(new ScanCommand({
      TableName: TABLE,
      ExclusiveStartKey: lastKey,
    }));
    items = items.concat((res.Items || []).filter(filterFn));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// ── OpenAI ────────────────────────────────────────────────────────────────────
const openai = new OpenAI({ apiKey: OPENAI_KEY });

async function uploadToVS(vsId, name, content) {
  const f = new File([content], name, { type: 'text/plain' });
  const uploaded = await openai.files.create({ file: f, purpose: 'assistants' });
  await openai.vectorStores.files.create(vsId, { file_id: uploaded.id });
  return uploaded.id;
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
// 比對 Timestamp（上傳日期）或 fileName（包含講道日期）
const records = await scanAll(item => {
  if (!item.Timestamp) return false;
  const tsDate = item.Timestamp.slice(0, 10);
  const name = item.fileName || '';
  return targetDates.some(d => tsDate === d || name.includes(d));
});

console.log(`\n找到 ${records.length} 筆符合日期的記錄`);

for (const r of records) {
  const unitId = r.unitId || 'default';
  const vsId = UNIT_VECTOR_STORES[unitId] || UNIT_VECTOR_STORES.default;
  const base = (r.sermonTitle || r.fileName || 'doc').replace(/\.[^.]+$/, '').slice(0, 60);
  const date = r.Timestamp?.slice(0, 10);

  console.log(`\n── ${r.fileName} (${date}, unit=${unitId})`);
  console.log(`   fileId=${r.fileId}, VS=${vsId}`);
  console.log(`   summary=${r.summary?.length || 0}字, devotional=${r.devotional?.length || 0}字, bibleStudy=${r.bibleStudy?.length || 0}字`);

  const hasSummary    = !!r.summary    && r.summary.length > 50;
  const hasDevotional = !!r.devotional && r.devotional.length > 50;
  const hasBibleStudy = !!r.bibleStudy && r.bibleStudy.length > 50;

  if (!hasSummary && !hasDevotional && !hasBibleStudy) {
    console.log('   ⚠ 無生成內容，跳過');
    continue;
  }

  if (dryRun) {
    console.log('   [dry-run] 略過實際上傳');
    continue;
  }

  const genFileIds = [];
  const types = [
    { key: 'summary',    label: '講道總結', content: r.summary },
    { key: 'devotional', label: '每日靈修', content: r.devotional },
    { key: 'bibleStudy', label: '查經指引', content: r.bibleStudy },
  ];

  for (const { key, label, content } of types) {
    if (!content || content.length < 50) continue;
    try {
      const fid = await uploadToVS(vsId, `${base}_${key}.txt`, content);
      genFileIds.push(fid);
      console.log(`   ✅ ${label} → ${fid}`);
    } catch (e) {
      console.error(`   ❌ ${label} 上傳失敗:`, e.message);
    }
  }

  // 存回 DynamoDB
  if (genFileIds.length > 0 && r.assistantId && r.Timestamp) {
    try {
      await dynamo.send(new UpdateCommand({
        TableName: TABLE,
        Key: { assistantId: r.assistantId, Timestamp: r.Timestamp },
        UpdateExpression: 'SET generatedFileIds = :ids',
        ExpressionAttributeValues: { ':ids': genFileIds },
      }));
      console.log(`   📝 generatedFileIds 已存回 DynamoDB: ${genFileIds.join(', ')}`);
    } catch (e) {
      console.warn('   ⚠ 存回 DynamoDB 失敗:', e.message);
    }
  }
}

console.log('\n完成。');
