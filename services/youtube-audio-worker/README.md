# YouTube Audio Worker — Fly.io 微服務

YouTube 音頻轉錄微服務，部署於 Fly.io（免費方案），繞過 AWS datacenter IP 封鎖。

## 架構

```
Amplify (AWS Lambda)
  └── route.ts 偵測 YOUTUBE_WORKER_URL 環境變數
        ├── 有設定 → 透過 HTTP 代理到 Fly.io 微服務
        └── 未設定 → 本地 yt-dlp 直接處理（Windows 開發）

Fly.io VM (GCP IP，非 AWS)
  └── Express server
        └── yt-dlp 下載 → ffmpeg 分片 → Whisper 轉錄 → GPT 格式化
```

## 部署步驟

### 1. 安裝 Fly CLI

```bash
# macOS / Linux
curl -L https://fly.io/install.sh | sh

# Windows（PowerShell）
pwsh -c "iwr https://fly.io/install.ps1 -useb | iex"
```

### 2. 登入 Fly.io

```bash
fly auth login
```

### 3. 首次部署

```bash
cd services/youtube-audio-worker

# 建立 app（首次）
fly launch --no-deploy

# 設定 secrets
fly secrets set OPENAI_API_KEY=sk-your-key-here
fly secrets set WORKER_SECRET=your-shared-secret-here

# 部署
fly deploy
```

### 4. 設定 Amplify 環境變數

在 AWS Amplify Console → Environment variables 加入：

| 環境變數 | 值 | 說明 |
|---------|---|------|
| `YOUTUBE_WORKER_URL` | `https://youtube-audio-worker.fly.dev` | Fly.io 服務 URL |
| `YOUTUBE_WORKER_SECRET` | `your-shared-secret-here` | 與 Fly.io 共用的驗證金鑰 |

## 本地開發

```bash
cd services/youtube-audio-worker
npm install
npm run dev    # 啟動 dev server (port 8080)
```

## 工作原理

### route.ts 自動偵測邏輯

```
if (YOUTUBE_WORKER_URL 已設定) {
  → 代理到 Fly.io（Amplify 生產模式）
} else {
  → 本地 yt-dlp 直接處理（Windows 開發模式）
}
```

### API

**POST /api/youtube-audio**

Request:
```json
{
  "url": "https://www.youtube.com/watch?v=...",
  "startTime": "00:05:00",  // optional
  "endTime": "00:25:00"     // optional
}
```

Response:
```json
{
  "transcript": "格式化後的轉錄文字...",
  "source": "whisper",
  "videoId": "abc123def45",
  "charCount": 1234
}
```

**GET /health** — 健康檢查

### Fly.io 免費方案

- 3 個 shared-cpu-1x VM（256MB RAM）
- 160 GB 出站流量/月
- 自動休眠（`auto_stop_machines = 'stop'`），省流量
- GCP 基礎建設，IP 不被 YouTube 封鎖

## 故障排除

```bash
# 查看日誌
fly logs

# 查看 app 狀態
fly status

# SSH 進入容器
fly ssh console

# 重新部署
fly deploy
```

## 費用

**完全免費** — Fly.io 免費方案包含足夠的資源供此微服務使用。
