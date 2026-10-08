import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
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

const UNIT_MAP = {
  'asst_Vm0kpSHh7snqF5SAJ32SmAMN': 'agape',
  'asst_XMyPwcJsH7TiTcAsGEu1GuY2': 'eastChristHome',
  'asst_bGYjfmBTbjuF0tCGbJ0yEa8I': 'jianZhu',
  'asst_6JH0Gph4Mmdwskp56YkQVIh5': 'cfscChurch',
  'asst_4QKJubuGno3Rw4iALWHExIh4': 'default',
};

const dynamo = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.NEXT_PUBLIC_REGION || 'us-east-2',
    credentials: {
      accessKeyId: process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
      secretAccessKey: process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
    }
  })
);

let items = [], lastKey;
do {
  const res = await dynamo.send(new ScanCommand({
    TableName: process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide',
    ExclusiveStartKey: lastKey,
  }));
  items = items.concat(res.Items || []);
  lastKey = res.LastEvaluatedKey;
} while (lastKey);

// 只保留有生成內容但 generatedFileIds 為空的記錄
const unsynced = items.filter(r => {
  const hasContent = (r.summary?.length > 50) || (r.devotional?.length > 50) || (r.bibleStudy?.length > 50);
  const synced = Array.isArray(r.generatedFileIds) && r.generatedFileIds.length > 0;
  return hasContent && !synced;
});

// 按單位分組
const byUnit = {};
for (const r of unsynced) {
  const unit = r.unitId || UNIT_MAP[r.assistantId] || 'unknown';
  if (!byUnit[unit]) byUnit[unit] = [];
  byUnit[unit].push(r);
}

console.log(`\n共 ${unsynced.length} 筆記錄有生成內容但未同步到 VS\n`);
for (const [unit, records] of Object.entries(byUnit)) {
  console.log(`── ${unit} (${records.length} 筆)`);
  records
    .sort((a, b) => new Date(b.Timestamp || '').getTime() - new Date(a.Timestamp || '').getTime())
    .forEach(r => {
      console.log(`   ${r.Timestamp?.slice(0, 10)}  ${(r.fileName || '').slice(0, 50)}`);
    });
}
