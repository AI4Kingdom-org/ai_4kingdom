import { updateMonthlyTokenUsage } from './monthlyTokenUsage';

// 文件處理的 token 使用量估算常數
const FILE_PROCESSING_TOKENS = {
  UPLOAD: {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150,
    retrieval_tokens: 0
  },
  PROCESS: {
    prompt_tokens: 1500,
    completion_tokens: 800,
    total_tokens: 2300,
    retrieval_tokens: 1000
  },
  PER_PAGE: {
    prompt_tokens: 250,
    completion_tokens: 120,
    total_tokens: 370,
    retrieval_tokens: 200
  }
};

/**
 * 更新文件上傳的 token 使用量
 * @param userId 用戶 ID
 * @param estimatedPages 估計頁數 (默認 1)
 */
export async function updateFileUploadTokenUsage(userId: string, estimatedPages: number = 1) {
  try {
    const usage = {
      ...FILE_PROCESSING_TOKENS.UPLOAD,
      prompt_tokens: FILE_PROCESSING_TOKENS.UPLOAD.prompt_tokens * estimatedPages,
      completion_tokens: FILE_PROCESSING_TOKENS.UPLOAD.completion_tokens * estimatedPages,
      total_tokens: FILE_PROCESSING_TOKENS.UPLOAD.total_tokens * estimatedPages
    };
    
    console.log('[DEBUG] 更新文件上傳 token 使用量:', {
      userId,
      estimatedPages,
      usage
    });
    
    await updateMonthlyTokenUsage(userId, usage);
    
    return true;
  } catch (error) {
    console.error('[ERROR] 更新文件上傳 token 使用量失敗:', error);
    return false;
  }
}

/**
 * 更新文件處理的 token 使用量
 * @param userId 用戶 ID
 * @param estimatedPages 估計頁數 (默認 5)
 */
export async function updateFileProcessingTokenUsage(userId: string, estimatedPages: number = 5) {
  try {
    // 基礎處理 token 加上每頁使用量
    const usage = {
      prompt_tokens: FILE_PROCESSING_TOKENS.PROCESS.prompt_tokens + FILE_PROCESSING_TOKENS.PER_PAGE.prompt_tokens * estimatedPages,
      completion_tokens: FILE_PROCESSING_TOKENS.PROCESS.completion_tokens + FILE_PROCESSING_TOKENS.PER_PAGE.completion_tokens * estimatedPages,
      total_tokens: FILE_PROCESSING_TOKENS.PROCESS.total_tokens + FILE_PROCESSING_TOKENS.PER_PAGE.total_tokens * estimatedPages,
      retrieval_tokens: FILE_PROCESSING_TOKENS.PROCESS.retrieval_tokens + FILE_PROCESSING_TOKENS.PER_PAGE.retrieval_tokens * estimatedPages
    };
    
    console.log('[DEBUG] 更新文件處理 token 使用量:', {
      userId,
      estimatedPages,
      usage
    });
    
    await updateMonthlyTokenUsage(userId, usage);
    
    return true;
  } catch (error) {
    console.error('[ERROR] 更新文件處理 token 使用量失敗:', error);
    return false;
  }
}