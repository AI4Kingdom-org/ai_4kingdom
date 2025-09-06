import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// 目標檔案：常數設定（含 SUNDAY_GUIDE_UNITS.agape.allowedUploaders）
const CONSTANTS_FILE_PATH = path.join(process.cwd(), 'app', 'config', 'constants.ts');

// 解析任意單位 allowedUploaders
function parseUnitAllowedUploaders(fileContent: string, unitKey: string): string[] {
  const match = fileContent.match(new RegExp(`${unitKey}:\\s*\\{[\\s\\S]*?allowedUploaders:\\s*\\[([\\s\\S]*?)\\]\\s*as\\s*string\\[]`));
  if (!match) return [];
  const inner = match[1];
  const ids = inner.match(/'([^']+)'/g) || [];
  return ids.map(s => s.slice(1, -1));
}

export async function GET() {
  try {
  const fileContent = fs.readFileSync(CONSTANTS_FILE_PATH, 'utf8');
  const agapeUploaders = parseUnitAllowedUploaders(fileContent, 'agape');
  const eastUploaders = parseUnitAllowedUploaders(fileContent, 'eastChristHome');
    return NextResponse.json({
      success: true,
      data: {
        units: {
      agape: { allowedUploaders: agapeUploaders },
      eastChristHome: { allowedUploaders: eastUploaders }
        }
      }
    });
  } catch (error) {
    console.error('讀取 SUNDAY_GUIDE_UNITS 失敗:', error);
    return NextResponse.json({ success: false, error: '讀取單位配置失敗' }, { status: 500 });
  }
}

interface PostBody {
  unitId: string;
  allowedUploaders: string[];
  userId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { unitId, allowedUploaders, userId } = (await req.json()) as PostBody;

    // 僅允許管理員（目前條件：userId === '1'）
    if (userId !== '1') {
      return NextResponse.json({ success: false, error: '沒有權限執行此操作' }, { status: 403 });
    }

    if (!['agape', 'eastChristHome'].includes(unitId)) {
      return NextResponse.json({ success: false, error: '不支援的單位' }, { status: 400 });
    }

    const fileContent = fs.readFileSync(CONSTANTS_FILE_PATH, 'utf8');
    const escapedList = allowedUploaders.map(id => ` '${id}'`).join(',');

    const newContent = fileContent.replace(
      new RegExp(`(${unitId}:\\s*\\{[\\s\\S]*?allowedUploaders:\\s*\\[)([\\s\\S]*?)(\\]\\s*as\\s*string\\[]\\s*,)`),
      (_m, p1, _p2, p3) => `${p1}${escapedList}${p3}`
    );

    if (newContent === fileContent) {
      return NextResponse.json({ success: false, error: '未能更新（可能未匹配到 agape 設定）' }, { status: 500 });
    }

    fs.writeFileSync(CONSTANTS_FILE_PATH, newContent, 'utf8');

  return NextResponse.json({ success: true, message: `${unitId} 單位上傳權限已更新` });
  } catch (error) {
  console.error('更新 allowedUploaders 失敗:', error);
    return NextResponse.json({ success: false, error: '更新失敗' }, { status: 500 });
  }
}
