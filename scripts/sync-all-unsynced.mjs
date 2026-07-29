/**
 * 批量補同步：把所有有生成內容但未同步 VS 的記錄上傳到對應向量庫
 * 排除 default 和 jianZhu
 *
 * 用法：node scripts/sync-all-unsynced.mjs [--dry-run]
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = resolve(process.cwd(), '.env.local');
const envVars = readFileSync(envPath, 'utf-8')
  .split('\n')
  .filter(l => l.trim() && !l.startsWith('#'))
  .reduce((acc, l) => {
    const eqIdx = l.indexOf('=');
    if (eqIdx < 0) return acc;
    acc[l.slice(0, eqIdx).trim()] = l.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    return acc;
  }, {});
Object.assign(process.env, envVars);

const dryRun = process.argv.includes('--dry-run');

const UNIT_VECTOR_STORES = {
  agape:          'vs_68a9ee54724c8191b6a7d574a59ca91a',
  eastChristHome: 'vs_69f204caa1f88191ab85505bcd04f09f',
  cfscChurch:     'vs_6a033b3feb8c8191a802c848539322a1',
};

const UNIT_MAP = {
  'asst_Vm0kpSHh7snqF5SAJ32SmAMN': 'agape',
  'asst_XMyPwcJsH7TiTcAsGEu1GuY2': 'eastChristHome',
  'asst_6JH0Gph4Mmdwskp56YkQVIh5': 'cfscChurch',
};

const SKIP_UNITS = new Set(['default', 'jianZhu']);

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.NEXT_PUBLIC_REGION || 'us-east-2',
    credentials: {
      accessKeyId: process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
      secretAccessKey: process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
    }
  })
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 掃描全表
let items = [], lastKey;
do {
  const res = await dynamo.send(new ScanCommand({
    TableName: process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide',
    ExclusiveStartKey: lastKey,
  }));
  items = items.concat(res.Items || []);
  lastKey = res.LastEvaluatedKey;
} while (lastKey);

// 篩選：有內容、未同步、不在排除單位
const targets = items.filter(r => {
  const unit = r.unitId || UNIT_MAP[r.assistantId];
  if (!unit || SKIP_UNITS.has(unit)) return false;
  if (!UNIT_VECTOR_STORES[unit]) return false;
  const hasContent = (r.summary?.length > 50) || (r.devotional?.length > 50) || (r.bibleStudy?.length > 50);
  const synced = Array.isArray(r.generatedFileIds) && r.generatedFileIds.length > 0;
  return hasContent && !synced;
});

// 去重：同 fileId 只跑一次（取最新）
const seen = new Map();
for (const r of targets) {
  const key = r.fileId || r.Timestamp;
  const existing = seen.get(key);
  if (!existing || new Date(r.Timestamp) > new Date(existing.Timestamp)) {
    seen.set(key, r);
  }
}
const deduped = [...seen.values()].sort((a, b) =>
  new Date(b.Timestamp || '').getTime() - new Date(a.Timestamp || '').getTime()
);

console.log(`Dry-run: ${dryRun}`);
console.log(`共 ${deduped.length} 筆（去重後）待同步\n`);

let successCount = 0, skipCount = 0, errorCount = 0;

for (const r of deduped) {
  const unit = r.unitId || UNIT_MAP[r.assistantId];
  const vsId = UNIT_VECTOR_STORES[unit];
  const base = (r.sermonTitle || r.fileName || 'doc').replace(/\.[^.]+$/, '').slice(0, 60);

  console.log(`── [${unit}] ${r.fileName?.slice(0, 50)} (${r.Timestamp?.slice(0, 10)})`);

  if (dryRun) {
    console.log(`   [dry-run] 略過\n`);
    continue;
  }

  const types = [
    { key: 'summary',    label: '講道總結', content: r.summary },
    { key: 'devotional', label: '每日靈修', content: r.devotional },
    { key: 'bibleStudy', label: '查經指引', content: r.bibleStudy },
  ];

  const genFileIds = [];
  for (const { key, label, content } of types) {
    if (!content || content.length < 50) continue;
    try {
      const f = new File([content], `${base}_${key}.txt`, { type: 'text/plain' });
      const uploaded = await openai.files.create({ file: f, purpose: 'assistants' });
      await openai.vectorStores.files.create(vsId, { file_id: uploaded.id });
      genFileIds.push(uploaded.id);
      console.log(`   ✅ ${label} → ${uploaded.id}`);
    } catch (e) {
      console.error(`   ❌ ${label} 失敗: ${e.message}`);
      errorCount++;
    }
  }

  if (genFileIds.length > 0 && r.assistantId && r.Timestamp) {
    try {
      await dynamo.send(new UpdateCommand({
        TableName: process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide',
        Key: { assistantId: r.assistantId, Timestamp: r.Timestamp },
        UpdateExpression: 'SET generatedFileIds = :ids',
        ExpressionAttributeValues: { ':ids': genFileIds },
      }));
      console.log(`   📝 generatedFileIds 存回 DynamoDB\n`);
      successCount++;
    } catch (e) {
      console.warn(`   ⚠ 存回 DynamoDB 失敗: ${e.message}\n`);
    }
  } else {
    skipCount++;
    console.log();
  }

  // throttle
  await new Promise(r => setTimeout(r, 500));
}

console.log(`\n完成。成功: ${successCount}，跳過: ${skipCount}，錯誤: ${errorCount}`);
