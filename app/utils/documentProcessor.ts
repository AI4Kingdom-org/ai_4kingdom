// 文件處理工具，用於管理與追蹤文件處理過程
import OpenAI from 'openai';
import { createDynamoDBClient } from '@/app/utils/dynamodb';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

// 文件大小閾值 (單位: 字元)，用於決定是否需要分段處理
const LARGE_DOCUMENT_THRESHOLD = 500000; // 約 500KB

// 定義文件分段的結構
interface DocumentSegment {
  title: string;
  range: string;
}

// 建立文件分段器
export async function splitDocumentIfNeeded(
  openai: OpenAI,
  vectorStoreId: string,
  fileId: string,
  assistantId: string
): Promise<{ needsSplit: boolean, segments?: { title: string, threadId: string }[] }> {
  try {
    // 獲取文件內容摘要，來判斷文件大小和結構
    console.log(`[DEBUG] 檢查文件大小和結構: ${fileId}`);
    
    // 建立一個執行緒
    const thread = await openai.beta.threads.create();
    
    // 發送請求，獲取文件的高層次結構
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: `這是一個檢查請求。請分析這個文件的大小和結構，不需要詳細內容，只需返回文件大概的字數、段落數，以及主要章節/部分數量。如果文件非常大，請建議如何將其分為多個邏輯部分。`
    });
    
    // 執行助手
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
      instructions: `請使用文件搜索工具查看此文件。僅返回文件結構概述和大小估計，不要分析內容。如果文件超過${LARGE_DOCUMENT_THRESHOLD / 1000}KB，請推薦如何按章節或邏輯部分分割。`
    });
    
    // 等待分析完成
    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    
    while (runStatus.status === 'queued' || runStatus.status === 'in_progress') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }
    
    if (runStatus.status !== 'completed') {
      console.error(`[ERROR] 檢查文件大小失敗: ${runStatus.status}`);
      return { needsSplit: false };
    }
    
    // 獲取回應
    const messages = await openai.beta.threads.messages.list(thread.id);
    const response = messages.data[0].content
      .filter(content => content.type === 'text')
      .map(content => (content.type === 'text' ? content.text.value : ''))
      .join('\n');
    
    console.log(`[DEBUG] 文件結構分析: ${response.substring(0, 200)}...`);
    
    // 分析回應，判斷是否需要分段
    const isLargeDocument = 
      response.toLowerCase().includes('large') || 
      response.toLowerCase().includes('big') || 
      response.includes('大型') || 
      response.includes('巨大') ||
      response.includes('分割') ||
      (response.match(/\d+\s*(kb|mb|字)/i) && 
       (() => {
          const match = response.match(/\d+/);
          return match && parseInt(match[0]) > LARGE_DOCUMENT_THRESHOLD / 1000;
       })());
    
    if (!isLargeDocument) {
      console.log(`[DEBUG] 文件大小適中，不需分段處理`);
      return { needsSplit: false };
    }
    
    console.log(`[DEBUG] 文件較大，需要分段處理`);
    
    // 請求助手提供分段建議
    await openai.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: `請提供 3-5 個邏輯分段點，以便我可以分段處理這個大型文件。每個分段應該包含一個段落範圍或章節範圍，以及一個簡短的標題。請使用 JSON 格式回應，例如:
      [
        {"title": "介紹和背景", "range": "第 1-3 章"},
        {"title": "主要分析", "range": "第 4-7 章"},
        {"title": "結論和建議", "range": "第 8-10 章"}
      ]`
    });
    
    // 執行助手
    const segmentRun = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
      instructions: `請提供文件的邏輯分割點，使每個部分可以獨立處理。回應必須是有效的JSON格式，包含3-5個分段，每個有標題和範圍。不需要分析內容。`
    });
    
    // 等待分析完成
    let segmentRunStatus = await openai.beta.threads.runs.retrieve(thread.id, segmentRun.id);
    
    while (segmentRunStatus.status === 'queued' || segmentRunStatus.status === 'in_progress') {
      await new Promise(resolve => setTimeout(resolve, 1000));
      segmentRunStatus = await openai.beta.threads.runs.retrieve(thread.id, segmentRun.id);
    }
    
    if (segmentRunStatus.status !== 'completed') {
      console.error(`[ERROR] 獲取分段建議失敗: ${segmentRunStatus.status}`);
      return { needsSplit: false };
    }
    
    // 獲取分段建議
    const segmentMessages = await openai.beta.threads.messages.list(thread.id);
    const segmentResponse = segmentMessages.data[0].content
      .filter(content => content.type === 'text')
      .map(content => (content.type === 'text' ? content.text.value : ''))
      .join('\n');
    
    console.log(`[DEBUG] 分段建議: ${segmentResponse}`);
    
    // 嘗試解析 JSON
    try {
      // 從文本中提取 JSON 部分
      const jsonMatch = segmentResponse.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('[ERROR] 無法從回應中提取JSON');
        return { needsSplit: false };
      }
      
      const segments = JSON.parse(jsonMatch[0]);
      
      // 為每個分段創建執行緒
      const segmentsWithThreads = await Promise.all(segments.map(async (segment: DocumentSegment) => {
        const segmentThread = await openai.beta.threads.create();
        return {
          title: segment.title,
          range: segment.range,
          threadId: segmentThread.id
        };
      }));
      
      console.log(`[DEBUG] 創建了 ${segmentsWithThreads.length} 個分段執行緒`);
      
      return {
        needsSplit: true,
        segments: segmentsWithThreads.map(s => ({ title: `${s.title} (${s.range})`, threadId: s.threadId }))
      };
      
    } catch (error) {
      console.error('[ERROR] 解析分段建議失敗:', error);
      return { needsSplit: false };
    }
  } catch (error) {
    console.error('[ERROR] 檢查文件大小和結構失敗:', error);
    return { needsSplit: false };
  }
}

// 記錄處理進度
export async function recordProcessingProgress(
  tableName: string,
  progressData: {
    assistantId: string;
    taskId: string;
    vectorStoreId: string;
    fileName: string;
    stage: string;
    progress: number; // 0-100
    status: 'pending' | 'processing' | 'completed' | 'failed';
    details?: string;
  }
): Promise<void> {
  try {
    const docClient = await createDynamoDBClient();
    
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        ...progressData,
        timestamp: new Date().toISOString()
      }
    }));
    
    console.log(`[DEBUG] 已記錄處理進度: ${progressData.stage} (${progressData.progress}%)`);
  } catch (error) {
    console.error('[ERROR] 記錄處理進度失敗:', error);
  }
}

// 建立多執行緒文件處理器
export async function createMultiThreadProcessor(
  openai: OpenAI,
  assistantId: string,
  vectorStoreId: string,
  fileId: string,
  fileName: string
): Promise<{ threadIds: string[], combinationThreadId: string }> {
  // 為不同類型的處理建立獨立的執行緒
  const summaryThread = await openai.beta.threads.create();
  const devotionalThread = await openai.beta.threads.create();
  const bibleStudyThread = await openai.beta.threads.create();
  const combinationThread = await openai.beta.threads.create();
  
  console.log(`[DEBUG] 建立多執行緒處理器:
    摘要執行緒: ${summaryThread.id}
    靈修指引執行緒: ${devotionalThread.id}
    查經指引執行緒: ${bibleStudyThread.id}
    匯總執行緒: ${combinationThread.id}
  `);
  
  return {
    threadIds: [summaryThread.id, devotionalThread.id, bibleStudyThread.id],
    combinationThreadId: combinationThread.id
  };
}
