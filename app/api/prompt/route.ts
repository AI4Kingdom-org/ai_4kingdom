import { NextResponse } from 'next/server';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import OpenAI from 'openai';
import { ASSISTANT_IDS, VECTOR_STORE_IDS } from "@/app/config/constants";
import { createDynamoDBClient } from '../../utils/dynamodb';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 使用統一的 DynamoDB 客戶端
const getDocClient = async () => {
  return await createDynamoDBClient();
};

// 获取当前Prompt
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const vectorStoreId = searchParams.get('vectorStoreId') || VECTOR_STORE_IDS.GENERAL;
    
    const docClient = await getDocClient();
    const command = new GetCommand({
      TableName: "AIPrompts",
      Key: { id: vectorStoreId }
    });

    const response = await docClient.send(command);
    
    if (!response.Item) {
      console.log('[DEBUG] 未找到 Prompt，返回默认值');
      return NextResponse.json({
        id: vectorStoreId,
        content: "You are an AI assistant...",
        lastUpdated: new Date().toISOString()
      });
    }

    return NextResponse.json(response.Item);
  } catch (error) {
    console.error('[ERROR] 获取Prompt失败:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    
    return NextResponse.json(
      { 
        error: '获取Prompt失败',
        details: error instanceof Error ? error.message : '未知错误',
        type: error instanceof Error ? error.name : typeof error,
        envCheck: {
          hasRegion: !!process.env.NEXT_PUBLIC_AWS_REGION || !!process.env.NEXT_PUBLIC_REGION,
          hasAccessKey: !!process.env.NEXT_PUBLIC_ACCESS_KEY_ID,
          hasSecretKey: !!process.env.NEXT_PUBLIC_SECRET_ACCESS_KEY,
          availableEnvVars: Object.keys(process.env).filter(key => key.startsWith('NEXT_PUBLIC_'))
        }
      },
      { status: 500 }
    );
  }
}

// 更新Prompt
export async function PUT(request: Request) {
  try {
    const { content, vectorStoreId = VECTOR_STORE_IDS.GENERAL, assistantId = ASSISTANT_IDS.GENERAL } = await request.json();
    
    // 若是 johnsung 助手，強制加上簡體中文指令
    let finalContent = content;
    if (assistantId === ASSISTANT_IDS.JOHNSUNG) {
      const zhHint = "请始终用简体中文回答用户问题。";
      if (!content.includes(zhHint)) {
        finalContent = zhHint + "\n" + content;
      }
    }
    // 1. 更新 OpenAI Assistant 的 instructions
    try {
      await openai.beta.assistants.update(
        assistantId,
        {
          instructions: finalContent
        }
      );
    } catch (error) {
      console.error('[ERROR] 更新 OpenAI Assistant 失败:', error);
      throw error;
    }// 2. 更新 DynamoDB
    const docClient = await getDocClient();
    const command = new PutCommand({
      TableName: "AIPrompts",
      Item: {
        id: vectorStoreId,        content: finalContent,
        lastUpdated: new Date().toISOString()
      }
    });

    await docClient.send(command);
    
    return NextResponse.json({ 
      message: 'Prompt更新成功',
      assistant: true,
      database: true
    });
  } catch (error) {
    console.error('[ERROR] 更新Prompt失败:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    
    return NextResponse.json(
      { 
        error: '更新Prompt失败',
        details: error instanceof Error ? error.message : '未知错误',
        type: error instanceof Error ? error.name : typeof error
      },
      { status: 500 }
    );
  }
}