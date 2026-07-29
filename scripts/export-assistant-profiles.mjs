#!/usr/bin/env node
// 將 OpenAI 平台上各 Assistant 的 model/instructions/temperature 匯出成
// app/config/assistantProfiles.ts 的快照，供 Responses API 遷移後使用。
//
// ⚠️ 必須在 Assistants API 移除（2026 年 8 月）前執行一次並 commit 結果，
//    否則日落後系統將 fallback 到預設模型且失去平台上設定的 instructions。
//
// 用法： node scripts/export-assistant-profiles.mjs
// 需要： OPENAI_API_KEY（.env.local 或環境變數）

import OpenAI from 'openai';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// 讀取 .env.local（若存在）
const envPath = resolve(root, '.env.local');
if (existsSync(envPath) && !process.env.OPENAI_API_KEY) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.error('缺少 OPENAI_API_KEY');
  process.exit(1);
}

// 從 constants.ts 抽出所有 asst_ ID（避免 ESM 載入 TS 的麻煩）
const constantsSrc = readFileSync(resolve(root, 'app/config/constants.ts'), 'utf8');
const assistantIds = [...new Set([...constantsSrc.matchAll(/asst_[A-Za-z0-9]+/g)].map((m) => m[0]))];
console.log(`在 constants.ts 找到 ${assistantIds.length} 個 assistant ID`);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const profiles = {};
const failed = []; // { id, error }

for (const id of assistantIds) {
  try {
    const a = await openai.beta.assistants.retrieve(id);
    profiles[id] = {
      model: a.model,
      ...(a.instructions ? { instructions: a.instructions } : {}),
      ...(a.temperature !== null && a.temperature !== undefined ? { temperature: a.temperature } : {}),
      ...(a.top_p !== null && a.top_p !== undefined ? { top_p: a.top_p } : {}),
    };
    console.log(`✅ ${id} (${a.name || '未命名'}): model=${a.model}, instructions=${a.instructions ? a.instructions.length + ' 字' : '無'}`);
  } catch (e) {
    console.warn(`⚠️ 無法取得 ${id}: ${e?.message || e}`);
    failed.push({ id, error: e?.message || String(e) });
  }
}

const knownIssuesBlock = failed.length
  ? `\n// ⚠️ 已知問題：以下 ${failed.length} 個 ID 在匯出當下（${new Date().toISOString()}）於 OpenAI 帳號中已不存在，\n` +
    `// 因此沒有快照可用；日落後這些 ID 會 fallback 到預設模型（無專屬 instructions）。\n` +
    `// 這是既有問題（並非本次 Responses API 遷移造成），使用者已確認暫時維持現狀，待之後再處理：\n` +
    failed.map((f) => `//   - ${f.id}: ${f.error}`).join('\n') +
    '\n'
  : '';

const banner = `// 各 Assistant 的模型/指令快照（Responses API 遷移用）。
// 由 scripts/export-assistant-profiles.mjs 產生於 ${new Date().toISOString()} —— 請勿手動編輯個別欄位以外的結構。
${knownIssuesBlock}export interface AssistantProfileOverride {
  model?: string;
  instructions?: string;
  temperature?: number;
  top_p?: number;
}

export const ASSISTANT_PROFILE_OVERRIDES: Record<string, AssistantProfileOverride> = `;

const outPath = resolve(root, 'app/config/assistantProfiles.ts');
writeFileSync(outPath, banner + JSON.stringify(profiles, null, 2) + ';\n', 'utf8');
console.log(`\n已寫入 ${outPath}（${Object.keys(profiles).length} 筆成功${failed.length ? `，${failed.length} 筆失敗（已於檔案頂部註記）` : ''}）`);
