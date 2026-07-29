import { NextResponse } from 'next/server';

// ⚠️ 已棄用：Assistants API 移除後不再有「assistant 本體綁定向量庫」的概念。
// 現在所有生成/聊天呼叫都在 Responses API 呼叫層級以
// tools: [{ type: 'file_search', vector_store_ids: [...] }] 綁定向量庫
// （見 app/lib/openai/responses.ts 與 /api/chat）。
// 此端點保留為相容用的 no-op，僅回傳成功。
export async function POST(
  request: Request,
  { params }: { params: { assistantId: string } }
) {
  try {
    const { assistantId } = params;
    const { vectorStoreId } = await request.json();

    if (!vectorStoreId) {
      return NextResponse.json({ error: '未提供 vectorStoreId' }, { status: 400 });
    }

    console.log('[INFO] bind-vector-store 已棄用（Responses API 為呼叫層級綁定），no-op:', { assistantId, vectorStoreId });

    return NextResponse.json({
      success: true,
      message: 'Vector Store 綁定已改為呼叫層級（Responses API），此端點為相容性 no-op',
      assistant: {
        id: assistantId,
        vectorStoreId,
      }
    });
  } catch (error) {
    console.error('绑定失败:', error);
    return NextResponse.json(
      {
        error: '绑定失败',
        details: error instanceof Error ? error.message : '未知错误'
      },
      { status: 500 }
    );
  }
}
