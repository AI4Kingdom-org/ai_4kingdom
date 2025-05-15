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

// 默認 prompts
const defaultPrompts: Record<string, string> = {
  summary: '請用中文總結這篇文章的主要內容，以摘要markdown的方式呈現。請確保包含所有關鍵信息。如果文章包含多個部分，請確保每個部分都有被覆蓋。',
  devotional: '請用中文基於這篇文章的內容，提供每日靈修指引，為了幫助教會成員在一周內學習和反思文章，將文章分為五個部分進行每日學習（周一到周五）。對於每一天：提供該部分文章的總結。從該部分提取最多三節聖經經文。根據文章的信息提供祷告指導, 並推薦一周共5首對應的敬拜或靈修詩歌。',
  bibleStudy: '請用中文創造文章的小組查經指引。為了促進基於講道的小組查經，請提供：背景：文章的總結及其與基督教生活的相關性。文章中強調的三個重要點。文章中提到的三到五節聖經經文。提供三個討論問題，幫助成員反思信息及其聖經基礎。一到两個個人應用問題，挑戰成員將文章的信息付諸實踐。祷告指導，鼓勵成員為應用信息的力量祈禱。'
};

/**
 * 從快取或資料庫獲取 prompt
 * @param promptId prompt 的 ID
 * @param tableName 資料表名稱
 * @returns prompt 內容
 */
export async function getPrompt(promptId: string, tableName: string): Promise<string> {
  // 1. 先檢查快取
  if (promptsCache[promptId]) {
    console.log(`[DEBUG] 從快取獲取 ${promptId} prompt`);
    return promptsCache[promptId];
  }
  
  // 2. 從資料庫獲取
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
          // 存入快取
          promptsCache[promptId] = promptItem.content;
          console.log(`[DEBUG] 成功獲取 ${promptId} prompt，已加入快取`);
          return promptsCache[promptId];
        }
      }
    } catch (queryError) {
      console.log(`[DEBUG] QueryCommand 失敗，可能是資料表未設置索引，嘗試使用 ScanCommand`);
      // 如果 QueryCommand 失敗 (可能是表沒有適當的索引)，退回使用 ScanCommand
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
          // 存入快取
          promptsCache[promptId] = promptItem.content;
          console.log(`[DEBUG] 成功獲取 ${promptId} prompt，已加入快取`);
          return promptsCache[promptId];
        }
      }
    }
    
    // 3. 如果資料庫中找不到或出錯，使用默認值
    console.log(`[DEBUG] 資料庫中找不到 ${promptId} prompt，使用默認值`);
  } catch (error) {
    console.error(`[ERROR] 獲取 ${promptId} prompt 失敗:`, error);
  }
  
  // 使用默認值
  promptsCache[promptId] = defaultPrompts[promptId] || '';
  return promptsCache[promptId];
}

/**
 * 批量獲取多個 prompts
 * @param promptIds prompt ID 的數組
 * @param tableName 資料表名稱
 * @returns 包含所有請求的 prompt 的對象
 */
export async function getPromptsInBatch(promptIds: string[], tableName: string): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  
  // 並行獲取所有 prompts
  const promises = promptIds.map(async (promptId) => {
    const content = await getPrompt(promptId, tableName);
    return { promptId, content };
  });
  
  const prompts = await Promise.all(promises);
  
  // 組合結果
  prompts.forEach(({ promptId, content }) => {
    results[promptId] = content;
  });
  
  return results;
}

// 預設匯出所有默認提示詞
export { defaultPrompts };
