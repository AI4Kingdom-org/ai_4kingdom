import { NextRequest, NextResponse } from 'next/server';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { getUnitConfigsFromDB } from '@/app/utils/getUnitAllowedUploaders';

const TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
const UNIT_CONFIG_KEY = '__SYSTEM_UNIT_CONFIGS__';
const UNIT_CONFIG_TYPE = 'SUNDAY_GUIDE_UNIT_CONFIGS';

export async function GET() {
  try {
    const configs = await getUnitConfigsFromDB();
    return NextResponse.json({
      success: true,
      data: {
        units: {
          agape: { allowedUploaders: configs.agape },
          eastChristHome: { allowedUploaders: configs.eastChristHome },
          jianZhu: { allowedUploaders: configs.jianZhu },
        },
      },
    });
  } catch (error) {
    console.error('讀取單位配置失敗:', error);
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

    if (userId !== '1') {
      return NextResponse.json({ success: false, error: '沒有權限執行此操作' }, { status: 403 });
    }

    if (!['agape', 'eastChristHome', 'jianZhu'].includes(unitId)) {
      return NextResponse.json({ success: false, error: '不支援的單位' }, { status: 400 });
    }

    const normalizedUploaders = [...new Set(allowedUploaders.map((id) => String(id).trim()).filter(Boolean))];

    // Read current configs so we only overwrite the target unit
    const current = await getUnitConfigsFromDB();
    const updated = { ...current, [unitId]: normalizedUploaders };

    const client = await createDynamoDBClient();
    await client.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          assistantId: UNIT_CONFIG_KEY,
          Timestamp: new Date().toISOString(),
          recordType: UNIT_CONFIG_TYPE,
          agapeUploaders: updated.agape,
          eastChristHomeUploaders: updated.eastChristHome,
          jianZhuUploaders: updated.jianZhu,
          updatedBy: String(userId),
          updatedAt: new Date().toISOString(),
        },
      })
    );

    return NextResponse.json({ success: true, message: `${unitId} 單位上傳權限已更新` });
  } catch (error) {
    console.error('更新 allowedUploaders 失敗:', error);
    return NextResponse.json({ success: false, error: '更新失敗' }, { status: 500 });
  }
}
