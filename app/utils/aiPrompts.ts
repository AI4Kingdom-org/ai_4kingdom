// AIPrompts 快取處理工具
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

// 定義 PromptItem 型別
export interface PromptItem {
  id: string;
  content: string;
  [key: string]: any; // 允許其他屬性
}

// 內存快取
const promptsCache: Record<string, string> = {};
const pendingFetches: Record<string, Promise<void>> = {};

// 默認 prompts
const defaultPrompts: Record<string, string> = {
  summary: '請用中文總結這篇文章的主要內容，以摘要markdown的方式呈現。請確保包含所有關鍵信息。如果文章包含多個部分，請確保每個部分都有被覆蓋。',
  devotional: '請用中文基於這篇文章的內容，提供每日靈修指引，為了幫助教會成員在一周內學習和反思文章，將文章分為五個部分進行每日學習（周一到周五）。對於每一天：提供該部分文章的總結。從該部分提取最多三節聖經經文。根據文章的信息提供祷告指導, 並推薦一周共5首對應的敬拜或靈修詩歌。',
  bibleStudy: '請用中文創造文章的小組查經指引。為了促進基於講道的小組查經，請提供：背景：文章的總結及其與基督教生活的相關性。文章中強調的三個重要點。文章中提到的三到五節聖經經文。提供三個討論問題，幫助成員反思信息及其聖經基礎。一到两個個人應用問題，挑戰成員將文章的信息付諸實踐。祷告指導，鼓勵成員為應用信息的力量祈禱。'
};

// 檢查回應是否為無效內容（錯誤訊息或空白）
function isInvalidPromptContent(text: string): boolean {
  if (!text || text.trim().length < 20) return true;
  
  const invalidPatterns = [
    /無法直接訪問文件/i,
    /我無法直接訪問/i,
    /由於技術限制/i,
    /請提供/i,
    /您可以告訴我/i,
    /分享要處理的特定文本/i
  ];
  
  return invalidPatterns.some(pattern => pattern.test(text));
}

/**
 * 從快取或資料庫獲取 prompt
 * @param promptId prompt 的 ID
 * @param tableName 資料表名稱
 * @returns prompt 內容
 */
export async function getPrompt(promptId: string, tableName: string): Promise<string> {
  // 1. 檢查快取，但驗證內容有效性
  if (promptsCache[promptId]) {
    const cachedContent = promptsCache[promptId];
    if (!isInvalidPromptContent(cachedContent)) {
      console.log(`[DEBUG] 從快取獲取有效 ${promptId} prompt，長度: ${cachedContent.length}`);
      return cachedContent;
    } else {
      console.log(`[DEBUG] 快取中的 ${promptId} prompt 無效，清除並重新獲取`);
      delete promptsCache[promptId];
    }
  }
  
  // 2. 檢查是否有正在進行的請求
  if (promptId in pendingFetches) {
    await pendingFetches[promptId];
    const result = promptsCache[promptId];
    return !isInvalidPromptContent(result) ? result : (defaultPrompts[promptId] || '');
  }
  
  // 3. 發起新的資料庫請求
  pendingFetches[promptId] = (async () => {
    try {
      console.log(`[DEBUG] 從資料庫獲取 ${promptId} prompt`);
      const aiPromptsClient = await createDynamoDBClient();
      
      // 嘗試使用 QueryCommand (如果資料表有適當的索引)
      try {
        const result = await aiPromptsClient.send(new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "id = :id",
          ExpressionAttributeValues: {
            ":id": promptId
          }
        }));
        
        if (result.Items && result.Items.length > 0) {
          const promptItem = result.Items[0] as PromptItem;
          if (promptItem && typeof promptItem.content === 'string') {
            const content = promptItem.content.trim();
            if (!isInvalidPromptContent(content)) {
              promptsCache[promptId] = content;
              console.log(`[DEBUG] 成功從 Query 獲取 ${promptId} prompt，長度: ${content.length}`);
              return;
            } else {
              console.log(`[DEBUG] Query 獲取的 ${promptId} prompt 內容無效，使用默認值`);
            }
          }
        }
      } catch (queryError) {
        console.log(`[DEBUG] QueryCommand 失敗，嘗試使用 ScanCommand`);
        // 如果 QueryCommand 失敗，退回使用 ScanCommand
        const result = await aiPromptsClient.send(new ScanCommand({
          TableName: tableName,
          FilterExpression: "id = :id",
          ExpressionAttributeValues: {
            ":id": promptId
          }
        }));
        
        if (result.Items && result.Items.length > 0) {
          const promptItem = result.Items[0] as PromptItem;
          if (promptItem && typeof promptItem.content === 'string') {
            const content = promptItem.content.trim();
            if (!isInvalidPromptContent(content)) {
              promptsCache[promptId] = content;
              console.log(`[DEBUG] 成功從 Scan 獲取 ${promptId} prompt，長度: ${content.length}`);
              return;
            } else {
              console.log(`[DEBUG] Scan 獲取的 ${promptId} prompt 內容無效，使用默認值`);
            }
          }
        }
      }
      
      // 4. 如果資料庫中找不到有效內容，使用默認值
      console.log(`[DEBUG] 資料庫中找不到有效的 ${promptId} prompt，使用默認值`);
      promptsCache[promptId] = defaultPrompts[promptId] || '';
    } catch (error) {
      console.error(`[ERROR] 獲取 ${promptId} prompt 失敗:`, error);
      promptsCache[promptId] = defaultPrompts[promptId] || '';
    }
  })();
  
  await pendingFetches[promptId];
  delete pendingFetches[promptId];
  
  const finalResult = promptsCache[promptId] || defaultPrompts[promptId] || '';
  console.log(`[DEBUG] 最終返回 ${promptId} prompt，長度: ${finalResult.length}, 使用默認: ${finalResult === (defaultPrompts[promptId] || '')}`);
  return finalResult;
}

/**
 * 批量獲取多個 prompts
 * @param promptIds prompt ID 的數組
 * @param tableName 資料表名稱
 * @returns 包含所有請求的 prompt 的對象
 */
export async function getPromptsInBatch(promptIds: string[], tableName: string): Promise<Record<string, string>> {
  console.log(`[DEBUG] 批量獲取 prompts:`, promptIds);
  const results: Record<string, string> = {};
  
  // 並行獲取所有 prompts
  const promises = promptIds.map(async (promptId) => {
    const content = await getPrompt(promptId, tableName);
    // 額外驗證：確保返回的內容有效
    const finalContent = !isInvalidPromptContent(content) ? content : (defaultPrompts[promptId] || '');
    results[promptId] = finalContent;
    
    console.log(`[DEBUG] Prompt ${promptId} 最終結果 - 長度: ${finalContent.length}, 預覽: ${finalContent.substring(0, 50)}...`);
    return { promptId, content: finalContent };
  });
  
  await Promise.all(promises);
  
  console.log(`[DEBUG] 批量獲取完成，所有 prompts 狀態:`, Object.fromEntries(
    Object.entries(results).map(([key, value]) => [key, { 
      length: value.length, 
      isDefault: value === (defaultPrompts[key] || ''),
      valid: !isInvalidPromptContent(value)
    }])
  ));
  
  return results;
}

/**
 * 依據單位（unitId）獲取 prompts：優先使用 `${baseId}.${unitId}` 變體，若為空則回退到 base，再回退到內建默認。
 * @param basePromptIds 基礎 prompt Id (不含單位後綴) 陣列，例如 ['summary','devotional']
 * @param unitId 單位 ID（default / agape ...）
 * @param tableName DynamoDB 資料表名稱
 */
// 預設匯出所有默認提示詞
export { defaultPrompts };
