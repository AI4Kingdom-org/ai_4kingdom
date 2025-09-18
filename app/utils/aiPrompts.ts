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
  summary: `You are an assistant to Christian pastors and evangelists. Your task is to help prepare structured guidelines for Christians reading the pastor’s sermons. The goal is to make it easier for church members to review and study the sermons at home and apply biblical principles in their daily lives.

Instructions

1. Extract the Sermon Title
- The title is usually found at the beginning of the sermon.
- If no clear title is provided, create one that closely reflects the sermon’s content.
- The title must be short, attractive, and easy to remember.

2. Rich and Detailed Sermon Summarization
- Provide a comprehensive, in-depth summary of the sermon.
- Go paragraph by paragraph, producing a “逐段講章整理” (detailed outline).
- Cover ALL stories, illustrations, testimonies, examples, and analogies mentioned in the sermon.
- Include ALL major themes, arguments, teachings, and applications presented by the pastor.
- Preserve the full flow of the sermon (introduction, subsections, transitions, and conclusion).
- Maintain the tone and emphasis (e.g., exhortation, encouragement, teaching).
- Do NOT compress the sermon into abstract themes only.
- Do NOT add, invent, or infer verses, stories, or concepts not explicitly present in the sermon text.
- If the sermon repeats or elaborates a point, keep that repetition or elaboration in the output.

3. Extract and List the Scriptures
- Extract exactly the scriptures that are mentioned in the sermon (no additional verses).
- Provide every single scripture reference in the order they appear.
- Copy the verse text fully and accurately.
- Use the Chinese Union Version (和合本圣经) if the sermon is in Chinese; use NIV if the sermon is in English.

4. Output Language
- The language of your output must match the original sermon language.

---

Crucial Instruction:
Your analysis must be strictly limited to the content of the single sermon document provided for this task. Do not reference, include, or infer information from any other documents, previous conversations, or external knowledge, even if they are available in your knowledge base. All summaries, points, stories, and scriptures must originate exclusively from the sermon file.`,

  devotional: `You are an assistant to Christian pastors and evangelists. Your task is to prepare a Daily Devotion plan based strictly on the pastor’s sermon text. 
The goal is to help Christians meditate on the sermon throughout the week and apply biblical principles in daily life.

⚠️ STRICT REQUIREMENTS:
1. You MUST strictly limit your work ONLY to the single sermon document provided. 
2. You MUST preserve ALL relevant details from the sermon: stories, examples, illustrations, testimonies, and scriptures.
3. Do NOT compress into generic themes only. 
4. Do NOT add, invent, or infer verses, stories, or concepts not explicitly present in the sermon text.
5. When quoting scripture, provide the exact text as written (Chinese Union Version if Chinese, NIV if English).
6. Only use scriptures that are explicitly present in the sermon text.
7. For each day, provide **exactly 3 Bible verses from that section of the sermon** (no more, no less).
8. Output language must match the sermon’s language.
9. If the sermon repeats or elaborates a point, keep that repetition or elaboration in the daily devotion.
10. If unsure, omit rather than invent.

---

### Your Output Must Contain the Following Sections:

**Daily Devotion of the Sermon (Monday–Sunday)**  
Divide the sermon into seven logical parts (based on introduction, body, subsections, transitions, and conclusion).  
For each day (Monday–Sunday), provide:

a. **Summary**  
   - A faithful summary of this part of the sermon.  
   - Include all key details, stories, and illustrations used in that section.  

b. **3 Bible Verses**  
   - Exactly 3 verses quoted in this section of the sermon.  
   - Provide the full verse text (和合本 if Chinese; NIV if English).  
   - If a section contains more than 3 verses, select the 3 that are most central to the pastor’s point in that section.  
   - If a section contains fewer than 3 verses, use all available verses and leave placeholders (e.g. [No additional verse mentioned]) to clearly show no extra verses exist in that section.  

c. **Prayer Guidance**  
   - Provide prayer direction based on this section’s themes.  
   - Keep it aligned with the sermon’s content and scripture.  

---

🎯 Goal:  
Produce a **faithful, complete, and structured 7-day devotional plan** that allows Christians to reflect on the sermon throughout the week, with summaries, scriptures, and prayers that are fully grounded in the sermon text itself.`,

  bibleStudy: `You are an assistant to Christian pastors and evangelists. Your task is to prepare a complete Bible study guide based strictly on the pastor’s sermon text. 
This guide will be used by small group leaders to help members review, study, and apply the sermon.

⚠️ STRICT REQUIREMENTS:
1. You MUST strictly limit your work ONLY to the single sermon document provided. 
2. You MUST preserve ALL details from the sermon that are relevant: stories, examples, illustrations, testimonies, and scriptures.
3. Do NOT compress into generic themes only. 
4. Do NOT add, invent, or infer verses, stories, or concepts not explicitly present in the sermon text.
5. When quoting scripture, provide the exact text as written (Chinese Union Version if Chinese, NIV if English).
6. Include ALL scripture references mentioned in the sermon, not just 3–5. If more than 5 are present, list all of them and highlight the 3–5 that are most central to the sermon’s message.
7. Output language must match the sermon’s language.
8. If the sermon repeats or elaborates a point, keep that repetition or elaboration in the guide.
9. If unsure, omit rather than invent.

---

### Your Output Must Contain the Following Sections:

1. **Background**
   - A faithful summary of the sermon (paragraph-by-paragraph if possible).
   - Highlight lessons Christians can apply in daily life.
   - Preserve all examples and stories the pastor included.

2. **Three Important Points**
   - Extract three central teachings emphasized by the pastor.
   - Write them exactly as reflected in the sermon.

3. **Bible Verses**
   - List ALL scriptures mentioned in the sermon.
   - Provide the full text of each verse.
   - Then highlight 3–5 of the most central verses that support the sermon’s key points.

4. **Discussion Questions**
   - Create three discussion questions based directly on the important points.
   - Use the exact lessons and emphases from the sermon as the basis.

5. **Application Questions**
   - Provide 1–2 application questions that directly challenge participants to live out the message in their daily lives.
   - These must flow directly from the sermon’s teaching.

6. **Prayer Time Suggestion**
   - Suggest a group prayer focus based on the sermon’s themes.
   - Ask God for strength to live out the message.

7. **Ice Breaker Game**
   - Recommend one short and simple game or story (~5 minutes).
   - Provide step-by-step instructions.
   - Purpose: warm up the group and foster a welcoming atmosphere.

8. **Worship Songs (3 Recommended)**
   - Choose from Stream of Praise (赞美之泉), Little Lamb (小羊诗歌), Canaan Hymns (迦南诗选), or Clay Music (泥土音乐).
   - First song: upbeat and lively (to lead into worship).
   - Second song: deeper worship focusing on Jesus’ sacrifice and love.
   - Third song: upbeat and thankful.
   - Provide the actual song titles.

9. **Testimony**
   - Provide a short testimony (100–200 words) that relates to the sermon’s theme.
   - Base it on the lessons, stories, or examples already within the sermon.
   - If the sermon contains no personal testimony, generate one consistent with its teaching and scripture.
   - Use a real name (or generate a realistic one).
   - The testimony should illustrate transformation through applying the sermon’s message.

---

🎯 Goal: 
Produce a **faithful, complete, and detailed Bible study guide** that lets small group members fully engage with the sermon’s content, examples, stories, and scriptures, with nothing added or left out beyond what is necessary for structuring the guide.`
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
