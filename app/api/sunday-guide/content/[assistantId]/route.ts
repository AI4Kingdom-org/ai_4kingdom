import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../../../utils/dynamodb';
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { updateMonthlyTokenUsage } from '../../../../utils/monthlyTokenUsage';

const SUNDAY_GUIDE_TABLE = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

// 定義各種內容類型估算的 token 使用量
const CONTENT_TYPE_TOKEN_USAGE = {
  summary: {
    prompt_tokens: 50,
    completion_tokens: 250,
    total_tokens: 300,
    retrieval_tokens: 150
  },
  text: {
    prompt_tokens: 100,
    completion_tokens: 400,
    total_tokens: 500,
    retrieval_tokens: 300
  },
  devotional: {
    prompt_tokens: 100,
    completion_tokens: 350,
    total_tokens: 450,
    retrieval_tokens: 200
  },
  bible: {
    prompt_tokens: 120,
    completion_tokens: 380,
    total_tokens: 500,
    retrieval_tokens: 250
  }
};

export async function GET(
  request: Request,
  { params }: { params: { assistantId: string } }
) {
  try {
    const { assistantId } = params;
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');  // 獲取內容類型
    const userId = searchParams.get('userId'); // 獲取用戶 ID
    
    // 確認必要參數
    if (!type) {
      return NextResponse.json({ error: '缺少內容類型參數' }, { status: 400 });
    }
    
    const docClient = await createDynamoDBClient();
    
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
      return NextResponse.json({ error: '未找到內容' }, { status: 404 });
    }

    // 獲取最新的文件內容
    const latestItem = items.sort((a, b) => 
      new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime()
    )[0];

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
      default:
        return NextResponse.json({ error: '無效的內容類型' }, { status: 400 });
    }

    if (!content) {
      return NextResponse.json({ error: '未找到請求的內容類型' }, { status: 404 });
    }
    
    // 如果提供了用戶 ID，記錄 token 使用量
    if (userId) {
      try {
        // 根據內容類型獲取預設的 token 使用量
        const tokenUsage = CONTENT_TYPE_TOKEN_USAGE[type as keyof typeof CONTENT_TYPE_TOKEN_USAGE];
        
        // 根據內容長度調整 token 使用量
        const contentLength = content.length;
        const scaleFactor = Math.max(1, contentLength / 1000); // 每 1000 字符為一個單位
        const adjustedUsage = {
          prompt_tokens: Math.round(tokenUsage.prompt_tokens * scaleFactor),
          completion_tokens: Math.round(tokenUsage.completion_tokens * scaleFactor),
          total_tokens: Math.round(tokenUsage.total_tokens * scaleFactor),
          retrieval_tokens: Math.round(tokenUsage.retrieval_tokens * scaleFactor)
        };
        
        // 更新用戶的 token 使用量
        await updateMonthlyTokenUsage(userId, adjustedUsage);
        console.log(`[DEBUG] 已記錄用戶 ${userId} 訪問 ${type} 內容的 token 使用量:`, adjustedUsage);
      } catch (usageError) {
        // 記錄錯誤但不中斷請求
        console.error('[ERROR] 記錄 token 使用量失敗:', usageError);
      }
    }

    return NextResponse.json({ content });

  } catch (error) {
    console.error('獲取內容失敗:', error);
    return NextResponse.json(
      { error: '獲取內容失敗', details: error instanceof Error ? error.message : '未知錯誤' },
      { status: 500 }
    );
  }
}