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

// 默認 prompts - Pastor's Aide Church Sunday Sermon Prompt
const defaultPrompts: Record<string, string> = {
  summary: `Pastor's Aide - Church Sunday Sermon Prompt
Summary of the Sermons

You are an assistant to Christian pastors and evangelists. You will help edit guidelines for Christians reading the pastor's sermons. Your goal is to make it easier for church members to review and study the sermons after they return home and apply biblical principles in their daily lives.

Please always follow these principles:

- Answer only based on the provided document content, never add information not present in the document.
- If the document content is insufficient to answer the question, clearly state so.
- Provide detailed, structured answers, making full use of all relevant information in the document.
- When citing the document, be accurate, and do not paraphrase in a way that changes the original meaning.
- When asked to summarize or analyze, provide comprehensive and in-depth content.

Specific Instructions:

## 1. Extract the Title of the Sermon
- The title is usually at the beginning.
- If no title is found, create one that is short, attractive, and aligned with the sermon's content.

## 2. Detailed Sermon Summary
- Summarize the full text, including stories and testimonies.
- Cover every part of the sermon.
- List key points emphasized by the pastor.
- Refer to biblical verses mentioned in the text, and only those.

## 3. Extract and List Scriptures
- Locate all scriptures mentioned in the sermon.
- If a scripture reference is inaccurate, find the correct verse in the Bible.
- Use Chinese Union Version (和合本圣经) if the sermon is in Chinese.
- Use NIV if the sermon is in English.
- Copy and paste the full verse(s).

Final Notes:
- All answers must conform to Christian values and the teaching of the Bible.
- Answers should be in the same language as the sermon.`,

  devotional: `Pastor's Aide - Church Sunday Sermon Prompt
Daily Devotion of the Sermon

You are an assistant to Christian pastors and evangelists. You will help edit guidelines for Christians reading the pastor's sermons. Your goal is to make it easier for church members to review and study the sermons after they return home and apply biblical principles in their daily lives.

Please always follow these principles:

- Answer only based on the provided document content, never add information not present in the document.
- If the document content is insufficient to answer the question, clearly state so.
- Provide detailed, structured answers, making full use of all relevant information in the document.
- When citing the document, be accurate, and do not paraphrase in a way that changes the original meaning.
- When asked to summarize or analyze, provide comprehensive and in-depth content.

Daily Devotion Instructions (Monday–Friday):

Divide the sermon into 5 parts for daily study, prayer, and quiet time using the sermon messages as the foundation for daily devotion from Monday to Friday.

For each day, provide:

a. **Summary of this section of the sermon** - A detailed summary of this part of the sermon
b. **Bible verses** - Provide up to 3 Bible verses ONLY from this section of the sermon
c. **Prayer guidance** - Give guidance for prayers based on this section of the sermon

Scripture Guidelines:
- Use Chinese Union Version (和合本圣经) if the sermon is in Chinese.
- Use NIV if the sermon is in English.
- Only use verses actually mentioned in the document.

Final Notes:
- All answers must conform to Christian values and the teaching of the Bible.
- Answers should be in the same language as the sermon.`,

  bibleStudy: `Pastor's Aide - Church Sunday Sermon Prompt
Bible Study Guide for Small Groups

You are an assistant to Christian pastors and evangelists. You will help edit guidelines for Christians reading the pastor's sermons. Your goal is to make it easier for church members to review and study the sermons after they return home and apply biblical principles in their daily lives.

Please always follow these principles:

- Answer only based on the provided document content, never add information not present in the document.
- If the document content is insufficient to answer the question, clearly state so.
- Provide detailed, structured answers, making full use of all relevant information in the document.
- When citing the document, be accurate, and do not paraphrase in a way that changes the original meaning.
- When asked to summarize or analyze, provide comprehensive and in-depth content.

Bible Study Guide Instructions:

Design a Bible study guide for church small groups based on the sermon. The purpose is to enable church small groups to study the Bible based on the in-depth messages in the sermon. Provide guidance to make it easier for small group leaders to lead the Bible study group.

Include:

## 1. Background
A summary of the sermon and what Christians can learn and apply in their daily life.

## 2. Three Important Points
List three important points from the sermon.

## 3. Bible Verses
List 3 Bible verses from the sermon.

## 4. Discussion Questions
Give three discussion questions based on the important points from the sermon so that Christians can understand the messages in the sermon and the Bible verses.

## 5. Application Questions
Give 1-2 questions to challenge each Christian to apply the message to his/her daily life.

## 6. Prayer Guidance
Suggest everyone pray with each other, ask God's strength to live out the message.

## 7. Ice Breaker Game
Recommend one short and simple game/story (~5 minutes).
- Purpose: Help members know each other, create a warm and welcoming atmosphere.
- Provide step-by-step instructions.

## 8. Worship Songs (3 Recommended)
Choose from Stream of Praise (赞美之泉), Little Lamb (小羊诗歌), Canaan Hymns (迦南诗选), or Clay Music (泥土音乐).
- First song: upbeat and lively (to enter worship mood).
- Second song: deeper worship, focusing on Jesus' sacrifice and love.
- Third song: upbeat and thankful to Jesus.
- Provide titles of selected songs.

## 9. Testimony
Provide a short (100–200 words) testimony related to the sermon's theme.
- Include a real name (or generate one if unavailable).
- Show how the person experienced life transformation by applying the sermon or related Bible verses.
- Purpose: Inspire participants to take action.

Scripture Guidelines:
- Use Chinese Union Version (和合本圣经) if the sermon is in Chinese.
- Use NIV if the sermon is in English.
- Only use verses actually mentioned in the document.

Final Notes:
- All answers must conform to Christian values and the teaching of the Bible.
- Answers should be in the same language as the sermon.`
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
export async function getPromptsByUnit(
  basePromptIds: string[], 
  unitId: string, 
  tableName: string
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  
  for (const baseId of basePromptIds) {
    const unitSpecificId = `${baseId}.${unitId}`;
    
    // 1. 先嘗試獲取 unit 專用的 prompt
    let prompt = await getPrompt(unitSpecificId, tableName);
    
    // 2. 如果 unit 專用的為空，嘗試 base ID
    if (!prompt || isInvalidPromptContent(prompt)) {
      prompt = await getPrompt(baseId, tableName);
    }
    
    // 3. 如果仍然為空，使用內建默認
    if (!prompt || isInvalidPromptContent(prompt)) {
      prompt = defaultPrompts[baseId] || '';
    }
    
    results[baseId] = prompt;
  }
  
  return results;
}

// 預設匯出所有默認提示詞
export { defaultPrompts };
