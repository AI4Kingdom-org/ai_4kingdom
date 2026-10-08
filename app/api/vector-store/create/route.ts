import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { requireAdmin } from '@/app/lib/identity/admin';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function POST(request: Request) {
  // 管理用端點：僅限管理員或帶 service token 的內部呼叫（見 app/lib/identity/admin.ts）
  const auth = await requireAdmin(request);
  if ('response' in auth) return auth.response;

  try {
    console.log('開始創建 Vector Store');
    
    // 添加 vs_ 前綴到名稱中以確保正確的 ID 格式
    const timestamp = new Date().toISOString();
    const params = {
      name: `vs_${timestamp}`
    };
    
    console.log('創建參數:', params);
    
    try {
      const vectorStore = await openai.vectorStores.create(params);
      
      console.log('Vector Store 創建成功:', {
        id: vectorStore.id,
        name: vectorStore.name,
        created_at: vectorStore.created_at
      });

      return NextResponse.json({
        success: true,
        vectorStoreId: vectorStore.id,
        details: {
          name: vectorStore.name,
          created_at: vectorStore.created_at
        }
      });
    } catch (apiError) {
      console.error('OpenAI API 錯誤:', {
        error: apiError,
        message: apiError instanceof Error ? apiError.message : '未知錯誤',
        params: params,
        response: apiError instanceof Error ? (apiError as any).response?.data : undefined
      });

      if (apiError instanceof Error) {
        const openaiError = apiError as any;
        console.error('OpenAI 錯誤詳情:', {
          status: openaiError.status,
          type: openaiError.type,
          code: openaiError.code,
          param: openaiError.param,
          error: openaiError.error
        });
      }
      
      throw apiError;
    }
  } catch (error) {
    console.error('創建 Vector Store 失敗:', {
      error,
      message: error instanceof Error ? error.message : '未知錯誤',
      stack: error instanceof Error ? error.stack : undefined
    });
    
    return NextResponse.json(
      { 
        error: '創建 Vector Store 失敗',
        details: error instanceof Error ? error.message : '未知錯誤'
      },
      { status: 500 }
    );
  }
}