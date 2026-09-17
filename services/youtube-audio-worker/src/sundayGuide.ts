/**
 * 講章內容生成（summary / devotional / bibleStudy）的背景執行端點。
 *
 * Amplify 的 /api/sunday-guide/process-document 會把工作轉交到這裡：收到即回 202，
 * 在背景跑完後把結果（或 failed 狀態）寫回 DynamoDB，前端照舊輪詢 check-result。
 * 狀態全在 DynamoDB，因此不需要像 YouTube job 那樣做跨機器 fly-replay。
 *
 * 核心邏輯來自主專案 app/lib/sunday-guide/processDocument.ts，經 scripts/bundle-shared.mjs 打包。
 */
import express from 'express';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

interface ProcessDocumentRequest {
  assistantId: string;
  vectorStoreId: string;
  fileName: string;
  fileId?: string;
  userId?: string;
  unitId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const core: {
  runProcessDocument(req: ProcessDocumentRequest, options?: { fetch?: (url: any, init?: any) => Promise<any> }): Promise<boolean>;
  recordProcessingFailure(req: ProcessDocumentRequest, errorMsg: string): Promise<void>;
} = require('../generated/process-document.cjs');

const MACHINE_ID = process.env.FLY_MACHINE_ID || 'local';
const APP_NAME = process.env.FLY_APP_NAME;

// 與 index.ts 的 getOpenAI 一致：設了 OPENAI_HTTP_PROXY 就讓 OpenAI 請求走 proxy
function openaiFetch() {
  const httpProxy = process.env.OPENAI_HTTP_PROXY;
  if (!httpProxy) return undefined;
  const dispatcher = new ProxyAgent(httpProxy);
  return (url: any, init?: any) => {
    const undiciInit: any = { ...(init || {}), dispatcher };
    if (undiciInit.body && !undiciInit.duplex) undiciInit.duplex = 'half';
    return undiciFetch(url, undiciInit) as any;
  };
}

const running = new Map<string, { req: ProcessDocumentRequest; startedAt: number }>();

// fly.toml 設了 auto_stop_machines='suspend'：Fly 只看經過 proxy 的流量判斷閒置，
// 背景工作沒有連線，機器可能在生成途中被暫停 —— 正是在 Amplify 上遇到的凍結問題。
// 有工作執行時，每 30 秒透過 Fly proxy 打自己一次，讓這台機器維持「有流量」。
let keepAliveTimer: NodeJS.Timeout | null = null;
function updateKeepAlive() {
  if (running.size > 0 && !keepAliveTimer && APP_NAME) {
    keepAliveTimer = setInterval(() => {
      fetch(`https://${APP_NAME}.fly.dev/health`, {
        headers: { 'fly-force-instance-id': MACHINE_ID },
        signal: AbortSignal.timeout(10_000),
      }).catch((e) => console.warn('[sunday-guide] keep-alive ping failed:', e?.message));
    }, 30_000);
  } else if (running.size === 0 && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

function jobKey(req: ProcessDocumentRequest) {
  return req.fileId || `${req.vectorStoreId}#${req.fileName}`;
}

export function registerSundayGuideRoutes(app: express.Express, auth: express.RequestHandler) {
  app.post('/api/sunday-guide/process-document', auth, (req: express.Request, res: express.Response) => {
    const { assistantId, vectorStoreId, fileName, fileId, userId, unitId } = req.body || {};
    if (!assistantId || !vectorStoreId || !fileName) {
      res.status(400).json({ error: 'MISSING_PARAMS', message: 'assistantId, vectorStoreId, fileName 為必填' });
      return;
    }
    const job: ProcessDocumentRequest = {
      assistantId, vectorStoreId, fileName,
      fileId: fileId || undefined,
      userId: userId ? String(userId) : undefined,
      unitId: unitId || undefined,
    };
    const key = jobKey(job);

    // 使用者重複點「開始處理」時不重跑，避免兩份生成互相覆寫
    if (running.has(key)) {
      console.log(`[sunday-guide] ${fileName} 已在處理中，略過重複請求`);
      res.status(202).json({ accepted: true, alreadyRunning: true, machineId: MACHINE_ID });
      return;
    }

    running.set(key, { req: job, startedAt: Date.now() });
    updateKeepAlive();
    console.log(`[sunday-guide] 開始處理 ${fileName} (unit=${unitId || 'default'}, fileId=${job.fileId || '-'})`);
    res.status(202).json({ accepted: true, machineId: MACHINE_ID });

    core.runProcessDocument(job, { fetch: openaiFetch() })
      .then((ok) => console.log(`[sunday-guide] ${fileName} ${ok ? '完成' : '失敗（已寫入 failed 狀態）'}，耗時 ${((Date.now() - running.get(key)!.startedAt) / 1000).toFixed(1)}s`))
      .catch(async (err) => {
        // runProcessDocument 內部已處理生成錯誤；走到這裡代表連 failed 狀態都沒寫成
        console.error(`[sunday-guide] ${fileName} 未預期錯誤:`, err);
        await core.recordProcessingFailure(job, err?.message || '處理失敗').catch(() => {});
      })
      .finally(() => {
        running.delete(key);
        updateKeepAlive();
      });
  });

  app.get('/api/sunday-guide/jobs', auth, (_req: express.Request, res: express.Response) => {
    res.json({
      machineId: MACHINE_ID,
      running: [...running.values()].map(({ req, startedAt }) => ({
        fileName: req.fileName, unitId: req.unitId, fileId: req.fileId, elapsedSec: Math.round((Date.now() - startedAt) / 1000),
      })),
    });
  });
}

/**
 * 機器被停止（fly deploy、手動重啟）時，把尚未完成的講章標記為 failed，
 * 前端會立刻顯示錯誤讓使用者重試，而不是空等到逾時。
 * fly.toml 的 kill_timeout 需留足時間給這裡寫 DynamoDB。
 */
export async function failRunningJobsOnShutdown(signal: string) {
  if (running.size === 0) return;
  console.warn(`[sunday-guide] 收到 ${signal}，將 ${running.size} 個進行中的講章標記為 failed`);
  await Promise.allSettled([...running.values()].map(({ req }) =>
    core.recordProcessingFailure(req, '處理伺服器重新啟動，請重新點擊「開始處理」。'),
  ));
}
