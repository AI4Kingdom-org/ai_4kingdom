import { NextResponse } from 'next/server';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import OpenAI from 'openai';
import { createDynamoDBClient } from '../../utils/dynamodb';
import { ASSISTANT_IDS } from '../../config/constants';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 由于统一使用 utils/dynamodb.ts 中的客户端
const getDocClient = async () => {
  const client = await createDynamoDBClient();
  return client;
};

// 获取用户的家校信息
export async function GET(request: Request) {
  try {
    console.log('[DEBUG] 开始获取家校信息');
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    console.log('[DEBUG] 请求参数:', { userId });

    if (!userId) {
      console.log('[DEBUG] 缺少 userId');
      return NextResponse.json({ error: 'UserId is required' }, { status: 400 });
    }

    const docClient = await getDocClient();
    const command = new GetCommand({
      TableName: 'HomeschoolPrompts',
      Key: { UserId: userId }
    });

    console.log('[DEBUG] DynamoDB 命令:', {
      TableName: command.input.TableName,
      Key: command.input.Key
    });

    const response = await docClient.send(command);
    console.log('[DEBUG] DynamoDB 响应:', response);
    
    return NextResponse.json(response.Item || {
      childName: '',
      basicInfo: '',
      recentChanges: ''
    });
  } catch (error) {
    console.error('[ERROR] 获取数据失败:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: '获取数据失败' }, { status: 500 });
  }
}

// 修改 POST 处理函数
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, childName, basicInfo, recentChanges } = body;

    if (!userId) {
      return NextResponse.json({ error: 'UserId is required' }, { status: 400 });
    }

    const docClient = await getDocClient();
    
    const command = new PutCommand({
      TableName: 'HomeschoolPrompts',
      Item: {
        UserId: String(userId),
        childName,
        basicInfo,
        recentChanges,
        assistantId: ASSISTANT_IDS.HOMESCHOOL,
        updatedAt: new Date().toISOString()
      }
    });

    await docClient.send(command);

    return NextResponse.json({ 
      success: true,
      assistantId: ASSISTANT_IDS.HOMESCHOOL
    });
  } catch (error) {
    console.error('[ERROR] 保存数据失败:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: '保存数据失败' }, { status: 500 });
  }
}

