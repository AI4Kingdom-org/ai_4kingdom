# 新增教會單位指南

本文件說明如何以 `/east-christ-home` 為範本，在此 Next.js 應用中新增一個完整的教會單位（church unit）。  
包含所有上傳功能（PDF、YouTube、音頻）、自動轉錄生成、ChatKit 問答、以及管理後台權限控制。

---

## 一、架構概覽

每個教會單位由兩個前端頁面組成：

| 頁面 | 路徑範例 | 說明 |
|------|----------|------|
| 上傳/管理頁 | `/east-christ-home/page.tsx` | 使用 `<SermonInputTabs>` 處理 PDF／YouTube／音頻上傳，顯示文件列表，支援重新命名與刪除 |
| 導航/閱覽頁 | `/east-christ-home/navigator/page.tsx` | 讓使用者選擇內容模式（摘要／靈修／查經），並嵌入 ChatKit 問答 |

後端資料存於 DynamoDB `SundayGuide` 表，以 `assistantId` + `Timestamp` 為複合主鍵，並帶有 `unitId` 欄位以區分教會單位。單位設定（allowedUploaders 等）以特殊 key `__SYSTEM_UNIT_CONFIGS__` 存於同一表，但可由 `app/config/constants.ts` 的靜態設定覆蓋作為備援。

**前置條件（在 OpenAI Platform 手動完成，腳本執行前需備妥）：**
1. 在 [platform.openai.com/assistants](https://platform.openai.com/assistants) 建立新 Assistant，記下 `asst_xxxx`
2. 建立新 Vector Store 並綁定給該 Assistant，記下 `vs_xxxx`
3. 在 ChatKit 建立新 Workflow，記下 `wf_xxxx`

---

## 二、使用自動腳本（推薦）

```bash
node add-church-unit.js
```

腳本會互動式詢問以下資訊，然後自動修改所有必要檔案：

| 輸入項目 | 範例值 |
|----------|--------|
| 單位顯示名稱 | `CFSC Church` |
| 路由路徑（kebab-case） | `cfsc-church` |
| unitId（camelCase） | `cfscChurch` |
| 常數名稱（UPPER_SNAKE） | `CFSC_CHURCH` |
| OpenAI Assistant ID | `asst_xxxx` |
| OpenAI Vector Store ID | `vs_xxxx` |
| ChatKit Workflow ID | `wf_xxxx` |
| 可上傳的 user_id（逗號分隔） | `1,24` |

腳本完成後會列出需要手動確認的項目（中文 UI 文字、functions.php）。

---

## 三、腳本修改的檔案（共 8 個）

| # | 檔案 | 改動內容 |
|---|------|----------|
| 1 | `app/config/constants.ts` | 加入 `ASSISTANT_IDS`、`VECTOR_STORE_IDS`、`SUNDAY_GUIDE_UNITS` 各一筆 |
| 2 | `app/components/AssistantManager.tsx` | 兩處 pathname 映射加入新路由 → unitId |
| 3 | `app/api/chatkit/session/route.ts` | 加入新 module 的 ChatKit Workflow 映射 |
| 4 | `app/utils/getUnitAllowedUploaders.ts` | `UnitConfigs` 介面、DB 讀取、靜態備援均加入新單位欄位 |
| 5 | `app/api/admin/sunday-guide-units/route.ts` | GET 回傳、POST 白名單驗證、DynamoDB 寫入均加入新單位 |
| 6 | `app/user-permissions/page.tsx` | 加入新單位的 state、load／add／remove 函數、UI 區塊 |
| 7 | `app/[routePath]/page.tsx` | 從 east-christ-home 複製改寫（所有 unitId 字串、變數名、導航連結） |
| 8 | `app/[routePath]/navigator/page.tsx` | 從 east-christ-home/navigator 複製改寫（含 ChatKit module） |

---

## 四、腳本完成後手動確認事項

### 1. UI 文字
腳本只替換技術性識別字，不改動中文 UI 文字。請在以下頁面確認顯示文字是否符合新單位：
- `app/[routePath]/page.tsx`：頁面標題、上傳說明、導航連結文字
- `app/[routePath]/navigator/page.tsx`：頁面標題、模式按鈕文字

### 2. 環境變數（選用）
若不想將 Workflow ID 硬寫在程式碼中，可在 `.env.local` 加入：
```
NEW_UNIT_NAVIGATOR_WORKFLOW_ID=wf_xxxx
```
腳本已在 chatkit route 中預留 `process.env` 讀取，若 env 有值則優先使用。

### 3. functions.php（WordPress）
在此 Next.js repo 完成並部署後，在 WordPress 佈景主題的 `functions.php` 加入新助手的 iframe shortcode。格式參考現有其他單位的實作。

### 4. 部署後驗證
- 前往 `/user-permissions`，確認新單位的上傳權限欄位正常顯示
- 前往 `/{routePath}`，測試 PDF、YouTube、音頻上傳
- 前往 `/{routePath}/navigator`，測試摘要、靈修、查經三種模式
- 確認 ChatKit 問答正常載入

---

## 五、完成後檢查清單

- [ ] `constants.ts`：已加入 `ASSISTANT_IDS`、`VECTOR_STORE_IDS`、`SUNDAY_GUIDE_UNITS` 新單位
- [ ] `AssistantManager.tsx`：兩處 pathname 映射已加入新路由
- [ ] `chatkit/session/route.ts`：已加入新 module 的 workflow 映射
- [ ] `getUnitAllowedUploaders.ts`：`UnitConfigs` 介面、DB 讀取、靜態備援已加入新欄位
- [ ] `sunday-guide-units/route.ts`：GET、POST、DynamoDB 寫入已加入新單位
- [ ] `user-permissions/page.tsx`：新單位的 state、函數、UI 區塊已加入
- [ ] `app/[routePath]/page.tsx`：已建立，UI 文字已確認
- [ ] `app/[routePath]/navigator/page.tsx`：已建立，202 處理已保留，UI 文字已確認
- [ ] 部署後：`/user-permissions` 確認正常
- [ ] 部署後：`/{routePath}` 和 `/{routePath}/navigator` 功能測試完成
- [ ] `functions.php`：iframe shortcode 已新增（WordPress repo）

---

## 六、已知 Bug 修正紀錄

### Bug 1 — DynamoDB UpdateExpression 含未定義欄位（已修正）

- **檔案**：`app/api/sunday-guide/process-document/route.ts`
- **症狀**：YouTube 上傳成功，但後處理失敗，DynamoDB 拋出 `Invalid UpdateExpression`
- **原因**：靜態 `UpdateExpression` 含 `:devotional`，當 `results.devotional` 為 `undefined` 時觸發錯誤
- **修正**：動態建立 `UpdateExpression`，只包含有值的欄位

### Bug 2 — Navigator 頁未處理 HTTP 202（已修正）

- **檔案**：`app/east-christ-home/navigator/page.tsx`（範本中已修正，腳本複製時會保留）
- **症狀**：內容仍在生成時點選模式，畫面空白，無任何提示
- **原因**：202 的 `response.ok === true`，繞過錯誤判斷，`data.content` 為 `undefined`
- **修正**：在 `if (!response.ok)` 前加入 `if (response.status === 202)` 處理分支

### Bug 3 — AssistantManager 觸發處理時未傳 unitId（已修正）

- **檔案**：`app/components/AssistantManager.tsx`（`handleProcessDocument`）
- **症狀**：process-document 建立的 DynamoDB 記錄缺少 `unitId`，可能導致單位過濾時記錄消失
- **原因**：`handleProcessDocument` 的 fetch body 缺少 `unitId`，雖 `handleUpload` 已正確傳送
- **修正**：從 `window.location.pathname` 萃取 `unitId`，加入 process-document 的請求 body

### Bug 4 — east-christ-home 與 agape 共用 ChatKit Workflow ID（已修正）

- **檔案**：`app/api/chatkit/session/route.ts`
- **症狀**：更換 east-christ-home 的 Workflow 時，agape 的也會被影響
- **原因**：兩個 module 共用同一個 `CHURCH_NAVIGATOR_WORKFLOW_ID` env var
- **修正**：2026-05 拆開，`east-christ-home-navigator` 改用獨立的 `EAST_CHRIST_HOME_NAVIGATOR_WORKFLOW_ID`；腳本為每個新單位生成獨立的 env var 名稱
