import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../../utils/dynamodb';
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

// 簡繁轉換映射表（簡化版）
const traditionalToSimplified: Record<string, string> = {
  '個': '个', '東': '东', '義': '义', '並': '并', '餘': '余', '傑': '杰',
  '這': '这', '為': '为', '來': '来', '後': '后', '點': '点', '國': '国',
  '說': '说', '當': '当', '時': '时', '從': '从', '學': '学', '實': '实',
  '進': '进', '與': '与', '產': '产', '還': '还', '會': '会', '發': '发',
  // ... 可以按需添加更多字符
};

// 定義常數
const SUNDAY_GUIDE_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
// 默認助手ID，用於查詢內容
const DEFAULT_ASSISTANT_ID = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_ASSISTANT_ID || 'asst_KsH3Sm5fB968SLr2TaAIuZF8';

// 將繁體中文轉換為簡體中文
function convertToSimplified(text: string): string {
  if (!text) return '';
  try {
    return text.split('').map(char => traditionalToSimplified[char] || char).join('');
  } catch (error) {
    console.error('繁簡轉換出錯:', error);
    return text;
  }
}

// 定義主日信息導航 PDF 下載的 API 路由
export async function GET(
  request: Request,
  { params }: { params: { id?: string } }
) {
  try {
    // 獲取查詢參數
    const url = new URL(request.url);
    const type = url.searchParams.get('type') || 'summary';
    const userId = url.searchParams.get('userId');
    const assistantId = url.searchParams.get('assistantId') || DEFAULT_ASSISTANT_ID;
    const includeAll = url.searchParams.get('includeAll') === 'true';
    
    if (!userId) {
      return NextResponse.json(
        { error: '缺少必要參數: userId' },
        { status: 400 }
      );
    }

    console.log(`[DEBUG] PDF下載請求: type=${type}, userId=${userId}, assistantId=${assistantId}, includeAll=${includeAll}`);

    // 如果是包含所有內容的請求
    if (includeAll) {
      const allContent = await getAllContentForPDF(assistantId);
      
      if (!allContent || (!allContent.summary && !allContent.devotional && !allContent.bible)) {
        console.error(`[ERROR] 找不到完整內容: assistantId=${assistantId}`);
        return NextResponse.json(
          { error: '找不到請求的內容' },
          { status: 404 }
        );
      }

      console.log(`[DEBUG] 成功獲取所有內容`);

      // 創建當前日期字符串作為檔案名的一部分
      const today = new Date();
      const dateStr = today.toISOString().split('T')[0];
      const safeFileName = `sunday-guide-complete-${dateStr}.html`;

      // 準備所有內容的 HTML
      const htmlContent = createCompleteHTML(allContent, today);

      // 設置內容類型標頭
      const headers = {
        'Content-Type': 'text/html; charset=UTF-8'
      };

      console.log(`[DEBUG] 準備下載完整文件: ${safeFileName}`);

      return new Response(htmlContent, {
        status: 200,
        headers
      });
    }

    // 原有的單個內容下載邏輯
    const content = await getContentForPDF(type, assistantId);
    
    if (!content) {
      console.error(`[ERROR] 找不到內容: type=${type}, assistantId=${assistantId}`);
      return NextResponse.json(
        { error: '找不到請求的內容' },
        { status: 404 }
      );
    }

    console.log(`[DEBUG] 成功獲取內容，長度: ${content.length} 字符`);

    // 準備標題和內容數據
    const titles = {
      summary: '讲道总结',
      text: '信息文字',
      devotional: '每日灵修',
      bible: '查经指引'
    };
    const title = titles[type as keyof typeof titles] || '主日信息';
    
    // 將內容轉換為簡體中文
    const simplifiedTitle = convertToSimplified(title);
    const simplifiedContent = convertToSimplified(content);
    
    // 創建當前日期字符串作為檔案名的一部分
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    // 準備英文檔案名
    const fileTypes = {
      summary: 'summary',
      text: 'fulltext',
      devotional: 'devotional',
      bible: 'biblestudy'
    };
    const safeFileName = `sunday-guide-${fileTypes[type as keyof typeof fileTypes] || 'content'}-${dateStr}.html`;
    
    // 準備 HTML 結構
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>${simplifiedTitle}</title>
        <style>
          body {
            font-family: Arial, "Microsoft YaHei", sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
          }
          h1 {
            text-align: center;
            color: #000;
            font-weight: normal;
            margin-bottom: 10px;
          }
          .date {
            text-align: center;
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
          }
          .content {
            text-align: justify;
            white-space: pre-line;
          }
        </style>
      </head>
      <body>
        <h1>${simplifiedTitle}</h1>
        <div class="date">生成日期: ${today.toLocaleDateString('zh-CN')}</div>
        <div class="content">${simplifiedContent}</div>
      </body>
      </html>
    `;

    // 設置內容類型標頭，移除 Content-Disposition 以便直接預覽
    const headers = {
      'Content-Type': 'text/html; charset=UTF-8'
    };

    console.log(`[DEBUG] 準備下載文件: ${safeFileName}`);

    // 直接返回 HTML 檔案作為下載內容
    return new Response(htmlContent, {
      status: 200,
      headers
    });
  } catch (error) {
    console.error('[ERROR] PDF下載請求處理失敗:', error);
    return NextResponse.json(
      { error: '處理請求時發生錯誤', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}

// 獲取所有內容類型的輔助函數
async function getAllContentForPDF(assistantId: string) {
  try {
    const docClient = await createDynamoDBClient();
    
    console.log(`[DEBUG] 查詢所有內容: 表=${SUNDAY_GUIDE_TABLE}, assistantId=${assistantId}`);
    
    const command = new ScanCommand({
      TableName: SUNDAY_GUIDE_TABLE,
      FilterExpression: 'assistantId = :assistantId',
      ExpressionAttributeValues: {
        ':assistantId': assistantId
      }
    });

    const response = await docClient.send(command);
    const items = response.Items;

    if (!items || items.length === 0) {
      console.error('[ERROR] 未找到任何內容記錄');
      return null;
    }

    // 獲取最新的文件內容
    const latestItem = items.sort((a, b) => 
      new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime()
    )[0];

    console.log(`[DEBUG] 找到最新記錄: ${latestItem.id || 'unknown ID'}, 時間戳: ${latestItem.Timestamp}`);
    
    return {
      summary: latestItem.summary || '',
      devotional: latestItem.devotional || '',
      bible: latestItem.bibleStudy || '',
      timestamp: latestItem.Timestamp
    };
  } catch (error) {
    console.error('[ERROR] 獲取所有內容失敗:', error);
    throw error;
  }
}

// 創建包含所有內容的完整 HTML
function createCompleteHTML(allContent: { summary: string; devotional: string; bible: string; timestamp?: string }, today: Date) {
  // 轉換所有內容為簡體中文
  const summarySimplified = convertToSimplified(allContent.summary);
  const devotionalSimplified = convertToSimplified(allContent.devotional);
  const bibleSimplified = convertToSimplified(allContent.bible);
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>主日信息导航完整版</title>
      <style>
        body {
          font-family: Arial, "Microsoft YaHei", sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }
        h1 {
          text-align: center;
          color: #000;
          font-weight: bold;
          margin-bottom: 10px;
          font-size: 28px;
        }
        h2 {
          color: #2c5282;
          border-bottom: 2px solid #2c5282;
          padding-bottom: 5px;
          margin-top: 40px;
          margin-bottom: 20px;
          font-size: 22px;
        }
        .date {
          text-align: center;
          color: #666;
          margin-bottom: 40px;
          font-size: 14px;
        }
        .content {
          text-align: justify;
          white-space: pre-line;
          margin-bottom: 30px;
        }
        .section {
          margin-bottom: 50px;
          page-break-inside: avoid;
        }
        @media print {
          body {
            max-width: none;
            margin: 0;
            padding: 15px;
          }
          h2 {
            page-break-after: avoid;
          }
          .section {
            page-break-inside: avoid;
          }
        }
      </style>
    </head>
    <body>
      <h1>主日信息导航完整版</h1>
      <div class="date">生成日期: ${today.toLocaleDateString('zh-CN')}</div>
      
      ${summarySimplified ? `
      <div class="section">
        <h2>一、讲道总结</h2>
        <div class="content">${summarySimplified}</div>
      </div>
      ` : ''}
      
      ${devotionalSimplified ? `
      <div class="section">
        <h2>二、每日灵修</h2>
        <div class="content">${devotionalSimplified}</div>
      </div>
      ` : ''}
      
      ${bibleSimplified ? `
      <div class="section">
        <h2>三、查经指引</h2>
        <div class="content">${bibleSimplified}</div>
      </div>
      ` : ''}
    </body>
    </html>
  `;
}

// 獲取內容的輔助函數，使用與內容 API 相同的邏輯
async function getContentForPDF(type: string, assistantId: string) {
  try {
    const docClient = await createDynamoDBClient();
    
    console.log(`[DEBUG] 查詢內容: 表=${SUNDAY_GUIDE_TABLE}, assistantId=${assistantId}`);
    
    // 使用與內容 API 相同的查詢邏輯 - 根據 assistantId 查詢
    const command = new ScanCommand({
      TableName: SUNDAY_GUIDE_TABLE,
      FilterExpression: 'assistantId = :assistantId',
      ExpressionAttributeValues: {
        ':assistantId': assistantId
      }
    });

    const response = await docClient.send(command);
    const items = response.Items;

    if (!items || items.length === 0) {
      console.error('[ERROR] 未找到任何內容記錄');
      return null;
    }

    // 獲取最新的文件內容
    const latestItem = items.sort((a, b) => 
      new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime()
    )[0];

    console.log(`[DEBUG] 找到最新記錄: ${latestItem.id || 'unknown ID'}, 時間戳: ${latestItem.Timestamp}`);
    
    // 根據類型返回對應內容
    let content: string | null = null;
    switch (type) {
      case 'summary':
        content = latestItem.summary;
        break;
      case 'text':
        content = latestItem.fullText;
        break;
      case 'devotional':
        content = latestItem.devotional;
        break;
      case 'bible':
        content = latestItem.bibleStudy;
        break;
    }

    if (!content) {
      console.error(`[ERROR] 在找到的記錄中未找到 ${type} 類型的內容`);
    } else {
      console.log(`[DEBUG] 成功獲取 ${type} 類型的內容，長度: ${content.length} 字符`);
    }
    
    return content;
  } catch (error) {
    console.error('[ERROR] 獲取PDF內容失敗:', error);
    throw error;
  }
}