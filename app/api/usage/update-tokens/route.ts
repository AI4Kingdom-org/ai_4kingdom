import { NextResponse } from 'next/server';
import { updateMonthlyTokenUsage } from '@/app/utils/monthlyTokenUsage';

/**
 * POST /api/usage/update-tokens
 * 伺服器端更新用戶 Token 使用量（替代直接從 client 呼叫 DynamoDB）
 *
 * Body: {
 *   userId: string,
 *   type: 'upload' | 'process',
 *   estimatedPages?: number
 * }
 */

// 各操作的 Token 消耗估算常數（與 fileProcessingTokens.ts 保持一致）
const FILE_PROCESSING_TOKENS = {
  UPLOAD: {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    retrieval_tokens: 0,
  },
  PROCESS: {
    prompt_tokens: 1500,
    completion_tokens: 800,
    total_tokens: 2300,
    retrieval_tokens: 1000,
  },
  PER_PAGE: {
    prompt_tokens: 250,
    completion_tokens: 120,
    total_tokens: 370,
    retrieval_tokens: 200,
  },
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, type, estimatedPages = 1 } = body;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (type !== 'upload' && type !== 'process') {
      return NextResponse.json(
        { error: 'type must be "upload" or "process"' },
        { status: 400 }
      );
    }

    let usage;

    if (type === 'upload') {
      const pages = Math.max(1, Number(estimatedPages) || 1);
      usage = {
        prompt_tokens: FILE_PROCESSING_TOKENS.UPLOAD.prompt_tokens * pages,
        completion_tokens: FILE_PROCESSING_TOKENS.UPLOAD.completion_tokens * pages,
        total_tokens: FILE_PROCESSING_TOKENS.UPLOAD.total_tokens * pages,
        retrieval_tokens: 0,
      };
    } else {
      // process
      const pages = Math.max(1, Number(estimatedPages) || 5);
      usage = {
        prompt_tokens:
          FILE_PROCESSING_TOKENS.PROCESS.prompt_tokens +
          FILE_PROCESSING_TOKENS.PER_PAGE.prompt_tokens * pages,
        completion_tokens:
          FILE_PROCESSING_TOKENS.PROCESS.completion_tokens +
          FILE_PROCESSING_TOKENS.PER_PAGE.completion_tokens * pages,
        total_tokens:
          FILE_PROCESSING_TOKENS.PROCESS.total_tokens +
          FILE_PROCESSING_TOKENS.PER_PAGE.total_tokens * pages,
        retrieval_tokens:
          FILE_PROCESSING_TOKENS.PROCESS.retrieval_tokens +
          FILE_PROCESSING_TOKENS.PER_PAGE.retrieval_tokens * pages,
      };
    }

    console.log('[update-tokens] Deducting tokens:', { userId, type, estimatedPages, usage });

    await updateMonthlyTokenUsage(userId, usage);

    return NextResponse.json({ success: true, deducted: usage });
  } catch (error: any) {
    console.error('[update-tokens] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to update token usage' },
      { status: 500 }
    );
  }
}
