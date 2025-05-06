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
    
    if (!userId) {
      return NextResponse.json(
        { error: '缺少必要參數: userId' },
        { status: 400 }
      );
    }

    // 獲取內容（從數據庫或其他來源）
    const content = await getContentForPDF(type, userId);
    
    if (!content) {
      return NextResponse.json(
        { error: '找不到請求的內容' },
        { status: 404 }
      );
    }

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
    
    // 創建當前日期字符串作為PDF檔案名的一部分
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
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
          }
        </style>
      </head>
      <body>
        <h1>${simplifiedTitle}</h1>
        <div class="date">生成日期: ${today.toLocaleDateString('zh-CN')}</div>
        <div class="content">${simplifiedContent.replace(/\n/g, '<br/>')}</div>
      </body>
      </html>
    `;

    // 設置內容類型和檔案名的標頭，指示瀏覽器這是要下載的內容
    const headers = {
      'Content-Type': 'text/html; charset=UTF-8',
      'Content-Disposition': `attachment; filename="${simplifiedTitle}-${dateStr}.html"`
    };

    // 直接返回 HTML 檔案作為下載內容
    return new Response(htmlContent, {
      status: 200,
      headers
    });
  } catch (error) {
    console.error('[ERROR] PDF下載請求處理失敗:', error);
    return NextResponse.json(
      { error: '處理請求時發生錯誤' },
      { status: 500 }
    );
  }
}

// 獲取內容的輔助函數
async function getContentForPDF(type: string, userId: string) {
  try {
    const docClient = await createDynamoDBClient();
    
    // 獲取最新的內容
    const command = new ScanCommand({
      TableName: process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide',
      FilterExpression: 'ContentType = :type',
      ExpressionAttributeValues: {
        ':type': type
      },
      Limit: 1
    });

    const response = await docClient.send(command);
    
    if (response.Items && response.Items.length > 0) {
      return response.Items[0].Content;
    }
    
    return null;
  } catch (error) {
    console.error('[ERROR] 獲取PDF內容失敗:', error);
    throw error;
  }
}