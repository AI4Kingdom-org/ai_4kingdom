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
    const k = l.slice(0, eqIdx).trim();
    const v = l.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    acc[k] = v;
    return acc;
  }, {});
Object.assign(process.env, envVars);

console.log('Region:', process.env.NEXT_PUBLIC_REGION);
console.log('Table:', process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE);
console.log('HasKey:', !!process.env.NEXT_PUBLIC_ACCESS_KEY_ID);

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

console.log('\n全部記錄數:', items.length);

const agape = items.filter(i =>
  i.unitId === 'agape' || i.assistantId === 'asst_Vm0kpSHh7snqF5SAJ32SmAMN'
);
console.log('Agape 記錄數:', agape.length);

agape
  .sort((a, b) => new Date(b.Timestamp || '').getTime() - new Date(a.Timestamp || '').getTime())
  .forEach(r => {
    console.log(
      r.Timestamp?.slice(0, 10),
      `| ${(r.fileName || '').slice(0, 40).padEnd(40)}`,
      `| summary=${r.summary?.length || 0}`,
      `| devotional=${r.devotional?.length || 0}`,
      `| bibleStudy=${r.bibleStudy?.length || 0}`,
      `| genIds=${(r.generatedFileIds || []).length}`
    );
  });
