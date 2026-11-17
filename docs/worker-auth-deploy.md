# 轉錄 Worker 驗證強化：部署步驟

分支：`fix/worker-auth-hardening`。目標是在**不中斷任何功能**的前提下，讓 Fly.io Worker 只接受可信的呼叫。

## 改了什麼

| 項目 | 以前 | 現在 |
|---|---|---|
| Worker 執行外部指令 | `exec` 拼接字串，請求裡的時間／檔名會進到 shell | 一律 `execFile` 參數陣列；時間只收 `HH`、`HH:MM`、`HH:MM:SS`，檔名副檔名走白名單 |
| YouTube 轉錄（開始／查進度） | 瀏覽器直連 Worker，靠 `Origin` 標頭通關（可偽造） | 走 app 的 `/api/sunday-guide/youtube-audio/start`、`/status/[jobId]`，app 確認會員後帶密鑰呼叫 |
| 上傳音訊檔（最大 250MB） | app 把 **Worker 總密鑰** 交給瀏覽器 | app 發 15 分鐘有效、只能上傳轉錄的通行證；瀏覽器照樣直傳 Worker |
| 講章處理等伺服器呼叫 | 帶密鑰 | 不變 |
| Worker 沒設密鑰時 | 全部放行 | 全部拒絕（503） |

## 舊頁面（更新前就開著的分頁）怎麼處理

- **上傳音訊**：app 回傳的 `workerSecret` 欄位現在放的是通行證，舊頁面照舊送出，Worker 也接受 → 不用重新整理就能用。
- **YouTube 轉錄**：舊頁面仍直連 Worker。Worker 在 `LEGACY_ORIGIN_AUTH_UNTIL` 之前，對 YouTube 三條路由仍接受來自 `main.d1b5nk0vz3t0hz.amplifyapp.com`、`ai4kingdom.org` 的 Origin（只限這些網域，不再接受任何 `*.amplifyapp.com`）。時間一到自動關閉，不需再部署。
- 過了期限還開著的舊頁面，會看到「系統已更新，請重新整理頁面後再試。」，重新整理即可。

## Worker 環境變數（Fly secrets）

| 變數 | 用途 |
|---|---|
| `WORKER_SECRET` | 目前的服務密鑰（必填） |
| `WORKER_SECRET_NEXT` | 換密鑰期間同時接受的第二把密鑰；換完就移除 |
| `LEGACY_ORIGIN_AUTH_UNTIL` | ISO 時間，例如 `2026-11-21T00:00:00Z`；之前接受舊頁面的 Origin，之後自動關閉 |
| `PUBLIC_ALLOWED_ORIGINS` | （選填）舊頁面允許的網域，逗號分隔，預設見上 |

## 部署順序

舊密鑰曾發給每位登入會員，所以這次一併換密鑰。做法不需要知道舊密鑰的值：
先把新密鑰加成「第二把」，app 換過去後再升為主密鑰。

1. **Worker（先）**
   ```bash
   cd services/youtube-audio-worker
   fly secrets set --stage WORKER_SECRET_NEXT=<新密鑰> LEGACY_ORIGIN_AUTH_UNTIL=<app 上線後約 2 天>
   npm run deploy
   ```
   這時新舊密鑰都有效，現有 app 不受影響，命令注入已修掉。
   `npm run deploy` 會重新打包 `generated/process-document.cjs`；與目前 commit 的版本相比，
   差異只有 2026-10 已上線的「人生導師」「寇世遠」助手人設文字，不影響講章處理。

2. **App（Amplify）**
   - Amplify 環境變數 `YOUTUBE_WORKER_SECRET` 改成 <新密鑰>。
   - `NEXT_PUBLIC_YOUTUBE_WORKER_URL` 已不再使用，可刪可留。
   - 合併 PR，等 Amplify 部署完成。

3. **收尾（`LEGACY_ORIGIN_AUTH_UNTIL` 過後）**
   ```bash
   fly secrets set --stage WORKER_SECRET=<新密鑰>
   fly secrets unset WORKER_SECRET_NEXT
   ```
   舊密鑰從此失效。若 app 上線時間比預期晚，用 `fly secrets set LEGACY_ORIGIN_AUTH_UNTIL=...` 延後即可。

## 上線後測試

- [ ] YouTube 有字幕的影片
- [ ] YouTube 沒字幕的影片（音訊 + Whisper）
- [ ] YouTube 指定轉錄片段（例如 00:10:00 → 00:20:00）
- [ ] 超過 30 分鐘的長影片（走背景任務 + 輪詢）
- [ ] 上傳 < 10MB 和 > 10MB 的音訊檔
- [ ] 上傳講章文件並生成內容
- [ ] `fly logs` 中 `Legacy origin auth used` 的次數隨時間歸零
