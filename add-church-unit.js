#!/usr/bin/env node
/**
 * add-church-unit.js
 * 自動新增教會單位助手的腳本
 * 執行方式：node add-church-unit.js
 *
 * 會修改的檔案：
 *   app/config/constants.ts
 *   app/components/AssistantManager.tsx
 *   app/api/chatkit/session/route.ts
 *   app/utils/getUnitAllowedUploaders.ts
 *   app/api/admin/sunday-guide-units/route.ts
 *   app/user-permissions/page.tsx
 *   app/[routePath]/page.tsx          (從 east-christ-home 複製)
 *   app/[routePath]/navigator/page.tsx (從 east-christ-home 複製)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const rl   = require('readline').createInterface({ input: process.stdin, output: process.stdout });

const ROOT = __dirname;

// ─── helpers ─────────────────────────────────────────────────────────────────

const ask  = (q) => new Promise((r) => rl.question(q, r));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log(`  ✓ ${rel}`);
}

function patch(content, from, to, hint) {
  if (!content.includes(from)) {
    throw new Error(`找不到目標字串 [${hint}]:\n>>> ${from.slice(0, 120).replace(/\n/g, '\\n')} <<<`);
  }
  return content.replace(from, to);
}

function toPascal(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════╗');
  console.log('║      新增教會單位助手腳本           ║');
  console.log('╚════════════════════════════════════╝\n');

  const displayName   = (await ask('1. 單位顯示名稱（如 CFSC Church）: ')).trim();
  const routePath     = (await ask('2. 路由路徑，kebab-case（如 cfsc-church）: ')).trim();
  const unitId        = (await ask('3. unitId，camelCase（如 cfscChurch）: ')).trim();
  const constName     = (await ask('4. 常數名稱，UPPER_SNAKE（如 CFSC_CHURCH）: ')).trim();
  const assistantId   = (await ask('5. OpenAI Assistant ID（asst_xxxx）: ')).trim();
  const vectorStoreId = (await ask('6. OpenAI Vector Store ID（vs_xxxx）: ')).trim();
  const workflowId    = (await ask('7. ChatKit Workflow ID（wf_xxxx）: ')).trim();
  const uploaderInput = (await ask('8. 可上傳的 user_id，逗號分隔（如 1,24）: ')).trim();
  rl.close();

  const uploaders = uploaderInput.split(',').map((s) => s.trim()).filter(Boolean);
  const pascal    = toPascal(unitId);        // cfscChurch → CfscChurch
  const envPrefix = routePath.toUpperCase().replace(/-/g, '_'); // cfsc-church → CFSC_CHURCH

  console.log('\n─── 確認設定 ───────────────────────────');
  console.log(`  顯示名稱   : ${displayName}`);
  console.log(`  路由路徑   : /${routePath}`);
  console.log(`  unitId     : ${unitId}`);
  console.log(`  常數名稱   : ${constName}`);
  console.log(`  Assistant  : ${assistantId}`);
  console.log(`  VectorStore: ${vectorStoreId}`);
  console.log(`  Workflow   : ${workflowId}`);
  console.log(`  Uploaders  : ${uploaders.join(', ')}`);
  console.log('────────────────────────────────────────\n');

  const confirm = (await ask('確認開始修改？(y/N) ')).trim().toLowerCase();
  if (confirm !== 'y') { console.log('已取消。'); process.exit(0); }

  console.log('\n─── 修改檔案中 ──────────────────────────\n');

  const cfg = { displayName, routePath, unitId, constName, assistantId, vectorStoreId, workflowId, uploaders, pascal, envPrefix };

  try {
    step1_constants(cfg);
    step2_assistantManager(cfg);
    step3_chatkit(cfg);
    step4_unitAllowedUploaders(cfg);
    step5_sundayGuideUnitsRoute(cfg);
    step6_userPermissions(cfg);
    step7_mainPage(cfg);
    step8_navigatorPage(cfg);

    console.log('\n╔════════════════════════════════════╗');
    console.log('║            ✅ 全部完成！            ║');
    console.log('╚════════════════════════════════════╝\n');
    console.log('⚠️  請手動確認：');
    console.log(`   1. app/${routePath}/page.tsx 的中文 UI 文字`);
    console.log(`   2. app/${routePath}/navigator/page.tsx 的中文 UI 文字`);
    console.log(`   3. functions.php 的 iframe（在 WordPress repo 另行新增）`);
    console.log(`   4. git push 部署後，前往 /user-permissions 確認 ${displayName} 欄位正常顯示\n`);
  } catch (e) {
    console.error('\n❌ 錯誤：', e.message);
    console.error('\n腳本在錯誤發生前已修改部分檔案，請用 git diff 確認目前狀態後手動修正。');
    process.exit(1);
  }
}

// ─── step 1：app/config/constants.ts ─────────────────────────────────────────

function step1_constants({ displayName, unitId, constName, assistantId, vectorStoreId, uploaders }) {
  let c = read('app/config/constants.ts');
  const uploaderStr = uploaders.map((u) => `'${u}'`).join(', ');

  // ASSISTANT_IDS：在尾端注解前插入
  c = patch(c,
    `  // ... 其他类型的助手\n\n};`,
    `  ${constName}: '${assistantId}', // ${displayName} 專用牧者助手\n  // ... 其他类型的助手\n\n};`,
    'ASSISTANT_IDS'
  );

  // VECTOR_STORE_IDS：在尾端注解前插入
  c = patch(c,
    `  // ... 其他类型的向量存储\n};`,
    `  ${constName}: '${vectorStoreId}', // ${displayName} 專用向量庫\n  // ... 其他类型的向量存储\n};`,
    'VECTOR_STORE_IDS'
  );

  // SUNDAY_GUIDE_UNITS：在 `} as const` 前插入新單位
  c = patch(c,
    `} as const;\n\nexport type SundayGuideUnit`,
    `  ${unitId}: {\n    assistantId: ASSISTANT_IDS.${constName},\n    vectorStoreId: VECTOR_STORE_IDS.${constName},\n    allowedUploaders: [${uploaderStr}] as string[],\n    accessType: 'public' as const,\n  },\n} as const;\n\nexport type SundayGuideUnit`,
    'SUNDAY_GUIDE_UNITS'
  );

  write('app/config/constants.ts', c);
}

// ─── step 2：app/components/AssistantManager.tsx ──────────────────────────────

function step2_assistantManager({ routePath, unitId }) {
  let c = read('app/components/AssistantManager.tsx');

  // unitQS 鏈（handleUpload）
  c = patch(c,
    `(pathname.includes('jian-zhu') ? '&unitId=jianZhu' : '')`,
    `(pathname.includes('jian-zhu') ? '&unitId=jianZhu' : (pathname.includes('${routePath}') ? '&unitId=${unitId}' : ''))`,
    'unitQS chain'
  );

  // unitId 鏈（handleProcessDocument）
  c = patch(c,
    `        : _pathname.includes('jian-zhu') ? 'jianZhu'\n        : undefined;`,
    `        : _pathname.includes('jian-zhu') ? 'jianZhu'\n        : _pathname.includes('${routePath}') ? '${unitId}'\n        : undefined;`,
    'unitId chain'
  );

  write('app/components/AssistantManager.tsx', c);
}

// ─── step 3：app/api/chatkit/session/route.ts ─────────────────────────────────

function step3_chatkit({ routePath, workflowId, envPrefix }) {
  let c = read('app/api/chatkit/session/route.ts');

  const newBlock =
    `  if (m === '${routePath}-navigator') {\n` +
    `    return process.env.${envPrefix}_NAVIGATOR_WORKFLOW_ID\n` +
    `      || process.env.NEXT_PUBLIC_${envPrefix}_NAVIGATOR_WORKFLOW_ID\n` +
    `      || '${workflowId}';\n` +
    `  }\n` +
    `  if (m === 'jian-zhu-navigator') {`;

  c = patch(c,
    `  if (m === 'jian-zhu-navigator') {`,
    newBlock,
    'chatkit workflow block'
  );

  write('app/api/chatkit/session/route.ts', c);
}

// ─── step 4：app/utils/getUnitAllowedUploaders.ts ─────────────────────────────

function step4_unitAllowedUploaders({ unitId }) {
  let c = read('app/utils/getUnitAllowedUploaders.ts');

  // UnitConfigs 介面
  c = patch(c,
    `  jianZhu: string[];\n}`,
    `  jianZhu: string[];\n  ${unitId}: string[];\n}`,
    'UnitConfigs interface'
  );

  // DynamoDB 記錄讀取
  c = patch(c,
    `        jianZhu: Array.isArray(record.jianZhuUploaders) ? record.jianZhuUploaders.map(String) : [],`,
    `        jianZhu: Array.isArray(record.jianZhuUploaders) ? record.jianZhuUploaders.map(String) : [],\n        ${unitId}: Array.isArray(record.${unitId}Uploaders) ? record.${unitId}Uploaders.map(String) : [],`,
    'DB record read'
  );

  // 靜態備援
  c = patch(c,
    `    jianZhu: [...((SUNDAY_GUIDE_UNITS as any).jianZhu?.allowedUploaders ?? [])],`,
    `    jianZhu: [...((SUNDAY_GUIDE_UNITS as any).jianZhu?.allowedUploaders ?? [])],\n    ${unitId}: [...((SUNDAY_GUIDE_UNITS as any).${unitId}?.allowedUploaders ?? [])],`,
    'static fallback'
  );

  // getUnitAllowedUploaders 函數
  c = patch(c,
    `  if (unitId === 'jianZhu') return configs.jianZhu;`,
    `  if (unitId === 'jianZhu') return configs.jianZhu;\n  if (unitId === '${unitId}') return configs.${unitId};`,
    'getUnitAllowedUploaders fn'
  );

  write('app/utils/getUnitAllowedUploaders.ts', c);
}

// ─── step 5：app/api/admin/sunday-guide-units/route.ts ────────────────────────

function step5_sundayGuideUnitsRoute({ unitId }) {
  let c = read('app/api/admin/sunday-guide-units/route.ts');

  // GET 回傳
  c = patch(c,
    `          jianZhu: { allowedUploaders: configs.jianZhu },`,
    `          jianZhu: { allowedUploaders: configs.jianZhu },\n          ${unitId}: { allowedUploaders: configs.${unitId} },`,
    'GET response'
  );

  // POST 白名單驗證
  c = patch(c,
    `if (!['agape', 'eastChristHome', 'jianZhu'].includes(unitId))`,
    `if (!['agape', 'eastChristHome', 'jianZhu', '${unitId}'].includes(unitId))`,
    'POST whitelist'
  );

  // DynamoDB 寫入 Item
  c = patch(c,
    `          jianZhuUploaders: updated.jianZhu,`,
    `          jianZhuUploaders: updated.jianZhu,\n          ${unitId}Uploaders: updated.${unitId},`,
    'DynamoDB write'
  );

  write('app/api/admin/sunday-guide-units/route.ts', c);
}

// ─── step 6：app/user-permissions/page.tsx ────────────────────────────────────

function step6_userPermissions({ unitId, pascal, displayName }) {
  let c = read('app/user-permissions/page.tsx');

  // State 宣告
  c = patch(c,
    `  // Jian Zhu 單位專屬上傳者\n  const [jianZhuUploaders, setJianZhuUploaders] = useState<string[]>([]);\n  const [newJianZhuUserId, setNewJianZhuUserId] = useState('');`,
    `  // Jian Zhu 單位專屬上傳者\n  const [jianZhuUploaders, setJianZhuUploaders] = useState<string[]>([]);\n  const [newJianZhuUserId, setNewJianZhuUserId] = useState('');\n  // ${displayName} 單位專屬上傳者\n  const [${unitId}Uploaders, set${pascal}Uploaders] = useState<string[]>([]);\n  const [new${pascal}UserId, setNew${pascal}UserId] = useState('');`,
    'state declarations'
  );

  // loadCurrentPermissions try block
  c = patch(c,
    `  await loadJianZhuUploaders();\n        await fetchUserDetails();`,
    `  await loadJianZhuUploaders();\n  await load${pascal}Uploaders();\n        await fetchUserDetails();`,
    'load try block'
  );

  // loadCurrentPermissions catch block
  c = patch(c,
    `  await loadJianZhuUploaders();\n      await fetchUserDetails();`,
    `  await loadJianZhuUploaders();\n  await load${pascal}Uploaders();\n      await fetchUserDetails();`,
    'load catch block'
  );

  // load 函數（插入 loadJianZhuUploaders 之後）
  c = patch(c,
    `  // 讀取 Jian Zhu 單位 allowedUploaders\n  const loadJianZhuUploaders = async () => {\n    try {\n      const res = await fetch('/api/admin/sunday-guide-units');\n      const data = await res.json();\n      if (data.success) {\n        setJianZhuUploaders(data.data.units.jianZhu?.allowedUploaders || []);\n      }\n    } catch (e) {\n      console.error('載入 Jian Zhu 單位上傳者失敗', e);\n    }\n  };`,
    `  // 讀取 Jian Zhu 單位 allowedUploaders\n  const loadJianZhuUploaders = async () => {\n    try {\n      const res = await fetch('/api/admin/sunday-guide-units');\n      const data = await res.json();\n      if (data.success) {\n        setJianZhuUploaders(data.data.units.jianZhu?.allowedUploaders || []);\n      }\n    } catch (e) {\n      console.error('載入 Jian Zhu 單位上傳者失敗', e);\n    }\n  };\n\n  // 讀取 ${displayName} 單位 allowedUploaders\n  const load${pascal}Uploaders = async () => {\n    try {\n      const res = await fetch('/api/admin/sunday-guide-units');\n      const data = await res.json();\n      if (data.success) {\n        set${pascal}Uploaders(data.data.units.${unitId}?.allowedUploaders || []);\n      }\n    } catch (e) {\n      console.error('載入 ${displayName} 單位上傳者失敗', e);\n    }\n  };`,
    'load function'
  );

  // update 函數（插入 updateJianZhuUploaders 之後）
  c = patch(c,
    `  // 更新 Jian Zhu 單位 allowedUploaders\n  const updateJianZhuUploaders = async (uploaders: string[]) => {\n    try {\n      const res = await fetch('/api/admin/sunday-guide-units', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ unitId: 'jianZhu', allowedUploaders: uploaders, userId: user?.user_id })\n      });\n      const data = await res.json();\n      if (!data.success) throw new Error(data.error || '更新失敗');\n      return true;\n    } catch (e) {\n      console.error('更新 Jian Zhu 上傳者失敗', e);\n      setMessage({ type: 'error', text: '更新 Jian Zhu 上傳者失敗' });\n      return false;\n    }\n  };`,
    `  // 更新 Jian Zhu 單位 allowedUploaders\n  const updateJianZhuUploaders = async (uploaders: string[]) => {\n    try {\n      const res = await fetch('/api/admin/sunday-guide-units', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ unitId: 'jianZhu', allowedUploaders: uploaders, userId: user?.user_id })\n      });\n      const data = await res.json();\n      if (!data.success) throw new Error(data.error || '更新失敗');\n      return true;\n    } catch (e) {\n      console.error('更新 Jian Zhu 上傳者失敗', e);\n      setMessage({ type: 'error', text: '更新 Jian Zhu 上傳者失敗' });\n      return false;\n    }\n  };\n\n  // 更新 ${displayName} 單位 allowedUploaders\n  const update${pascal}Uploaders = async (uploaders: string[]) => {\n    try {\n      const res = await fetch('/api/admin/sunday-guide-units', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        body: JSON.stringify({ unitId: '${unitId}', allowedUploaders: uploaders, userId: user?.user_id })\n      });\n      const data = await res.json();\n      if (!data.success) throw new Error(data.error || '更新失敗');\n      return true;\n    } catch (e) {\n      console.error('更新 ${displayName} 上傳者失敗', e);\n      setMessage({ type: 'error', text: '更新 ${displayName} 上傳者失敗' });\n      return false;\n    }\n  };`,
    'update function'
  );

  // add/remove handlers（插入「清除消息」前）
  c = patch(c,
    `  // 清除消息`,
    `  const add${pascal}Uploader = async () => {\n    if (!new${pascal}UserId.trim()) { setMessage({ type: 'error', text: '請輸入用戶ID' }); return; }\n    if (${unitId}Uploaders.includes(new${pascal}UserId.trim())) { setMessage({ type: 'error', text: '該用戶已在 ${displayName} 上傳清單中' }); return; }\n    const updated = [...${unitId}Uploaders, new${pascal}UserId.trim()];\n    const ok = await update${pascal}Uploaders(updated);\n    if (ok) { set${pascal}Uploaders(updated); setNew${pascal}UserId(''); setMessage({ type: 'success', text: '${displayName} 上傳者已新增' }); await fetchUserDetails(); }\n  };\n\n  const remove${pascal}Uploader = async (uId: string) => {\n    if (!confirm(\`確定要移除用戶 \${userDetails[uId]?.displayName || uId} 的 ${displayName} 上傳權限嗎？\`)) return;\n    const updated = ${unitId}Uploaders.filter((id) => id !== uId);\n    const ok = await update${pascal}Uploaders(updated);\n    if (ok) { set${pascal}Uploaders(updated); setMessage({ type: 'success', text: '${displayName} 上傳者已移除' }); }\n  };\n\n  // 清除消息`,
    'add/remove handlers'
  );

  // UI section（插入「權限組管理」前）
  c = patch(c,
    `      {/* 權限組管理 */}`,
    `      {/* ${displayName} 單位專屬上傳權限管理 */}\n      <div className={styles.section}>\n        <h2 className={styles.sectionTitle}>${displayName} 單位專屬上傳權限</h2>\n        <div className={styles.addUserForm}>\n          <input type="text" placeholder="輸入用戶ID" value={new${pascal}UserId} onChange={(e) => setNew${pascal}UserId(e.target.value)} className={styles.input} />\n          <button onClick={add${pascal}Uploader} className={styles.button}>添加 ${displayName} 上傳權限</button>\n        </div>\n        <div className={styles.userList}>\n          <h3>${displayName} 具有上傳權限的用戶</h3>\n          {loading ? (\n            <div className={styles.loading}>載入中...</div>\n          ) : ${unitId}Uploaders.length === 0 ? (\n            <div className={styles.noUsers}>暫無用戶</div>\n          ) : (\n            <ul className={styles.list}>\n              {${unitId}Uploaders.map((userId) => (\n                <li key={userId} className={styles.listItem}>\n                  <div className={styles.userInfo}>\n                    <strong>{userDetails[userId]?.displayName || \`用戶\${userId}\`}</strong>\n                    <span className={styles.userId}>ID: {userId}</span>\n                    {userDetails[userId]?.email && <span className={styles.userEmail}>{userDetails[userId].email}</span>}\n                  </div>\n                  <button onClick={() => remove${pascal}Uploader(userId)} className={styles.removeButton}>移除</button>\n                </li>\n              ))}\n            </ul>\n          )}\n        </div>\n      </div>\n\n      {/* 權限組管理 */}`,
    'UI section'
  );

  // 更新權限說明文字
  c = patch(c,
    `<strong>單位專屬上傳權限（Agape／East Christ Home／Jian Zhu）：</strong>`,
    `<strong>單位專屬上傳權限（Agape／East Christ Home／Jian Zhu／${displayName}）：</strong>`,
    'permission description text'
  );

  write('app/user-permissions/page.tsx', c);
}

// ─── step 7：app/[routePath]/page.tsx（從 east-christ-home 複製）────────────────

function step7_mainPage({ routePath, unitId, pascal, displayName }) {
  let c = read('app/east-christ-home/page.tsx');

  c = c
    // unit config
    .replace(/const eastUnit /g, `const ${unitId}Unit `)
    .replace(/eastUnit\./g, `${unitId}Unit.`)
    .replace(/getSundayGuideUnitConfig\('eastChristHome'\)/g, `getSundayGuideUnitConfig('${unitId}')`)
    // unitId 字串（字面值與 URL query string）
    .replace(/unitId: 'eastChristHome'/g, `unitId: '${unitId}'`)
    .replace(/unitId=eastChristHome/g, `unitId=${unitId}`)
    .replace(/data\.units\.eastChristHome/g, `data.units.${unitId}`)
    .replace(/'currentUnitId', 'eastChristHome'/g, `'currentUnitId', '${unitId}'`)
    // localStorage 及 BroadcastChannel
    .replace(/'eastChristHome'/g, `'${unitId}'`)
    // 導航連結及文字
    .replace(/\/east-christ-home\/navigator/g, `/${routePath}/navigator`)
    .replace(/東基家信息導覽/g, `${displayName}信息導覽`)
    // component 名稱
    .replace(/EastChristHomePage/g, `${pascal}Page`);

  write(`app/${routePath}/page.tsx`, c);
}

// ─── step 8：app/[routePath]/navigator/page.tsx（從 east-christ-home 複製）──────

function step8_navigatorPage({ routePath, unitId, pascal, displayName }) {
  let c = read('app/east-christ-home/navigator/page.tsx');

  c = c
    // unit config 變數名
    .replace(/const eastUnit /g, `const ${unitId}Unit `)
    .replace(/eastUnit\./g, `${unitId}Unit.`)
    .replace(/getSundayGuideUnitConfig\('eastChristHome'\)/g, `getSundayGuideUnitConfig('${unitId}')`)
    // unitId 字串（URL query string 與字面值）
    .replace(/unitId=eastChristHome/g, `unitId=${unitId}`)
    .replace(/'eastChristHome'/g, `'${unitId}'`)
    // ChatKit module
    .replace(/module="east-christ-home-navigator"/g, `module="${routePath}-navigator"`)
    // component / type 名稱
    .replace(/EastRecord/g, `${pascal}Record`)
    .replace(/EastNavigatorContent/g, `${pascal}NavigatorContent`)
    .replace(/EastNavigatorPage/g, `${pascal}NavigatorPage`);

  write(`app/${routePath}/navigator/page.tsx`, c);
}

// ─── 執行 ─────────────────────────────────────────────────────────────────────

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
