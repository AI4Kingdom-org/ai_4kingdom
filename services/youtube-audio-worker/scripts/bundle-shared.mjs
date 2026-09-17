// 把 Next.js 專案的講章生成核心（app/lib/sunday-guide/processDocument.ts）連同依賴
// （openai、@aws-sdk、@/app/* 工具）打包成單一 CJS 檔，供 worker 直接 require。
//
// 產物 generated/process-document.cjs 需一併提交：Fly 的建置 context 只有本資料夾，
// Docker 內看不到上層的 app/ 原始碼。修改 app/lib/sunday-guide 或其依賴後務必重跑本腳本。
import { createRequire } from 'module';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const workerDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(workerDir, '../..');
// esbuild 取自主專案的 devDependencies，worker 不另外安裝
const esbuild = createRequire(resolve(repoRoot, 'package.json'))('esbuild');

const outfile = resolve(workerDir, 'generated/process-document.cjs');
const result = await esbuild.build({
  absWorkingDir: repoRoot,
  entryPoints: ['app/lib/sunday-guide/processDocument.ts'],
  tsconfig: 'tsconfig.json', // 解析 @/ 路徑別名
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile,
  legalComments: 'none',
  metafile: true,
  banner: { js: '// 自動產生，請勿手動修改。來源：app/lib/sunday-guide/processDocument.ts（npm run bundle:shared）' },
});

const bytes = Object.values(result.metafile.outputs)[0].bytes;
console.log(`[bundle-shared] ${outfile} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
