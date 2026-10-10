import { NextResponse } from 'next/server';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../utils/dynamodb';
import { ASSISTANT_IDS } from '../../config/constants';
import { getRequestIdentity, requireMember, unauthorized } from '../../lib/identity/server';

// 由于统一使用 utils/dynamodb.ts 中的客户端
const getDocClient = async () => {
  const client = await createDynamoDBClient();
  return client;
};

// 获取用户的家校信息
export async function GET(request: Request) {
  // 孩子資料屬個資：只回傳本人的資料；訪客沒有資料，回傳空白讓聊天照常進行
  const identity = getRequestIdentity(request);
  if (!identity) return unauthorized();

  try {
    console.log('[DEBUG] 开始获取家校信息');
    const userId = identity.id;

    console.log('[DEBUG] 请求参数:', { userId });

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
    console.log('[DEBUG] response.Item:', response.Item);
    
    // 返回完整数据，包含新增的字段
    const defaultData = {
      childName: '',
      basicInfo: '',
      recentChanges: '',
      age: undefined,
      gender: undefined,
      concerns: [],
      otherConcern: ''
    };
    
    const result = response.Item || defaultData;
    console.log('[DEBUG] 準備返回的資料:', JSON.stringify(result, null, 2));
    console.log('[DEBUG] 包含的欄位:', Object.keys(result));
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('[ERROR] 获取数据失败:', {
      error,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({ error: '获取数据失败' }, { status: 500 });
  }
}

// 保存孩子資料。聊天時 /api/chat 會從這張表讀取並接在助手人設之後，
// 因此這裡只需寫入 DynamoDB，不再另外建立對話或預先產生建議。
export async function POST(request: Request) {
  const auth = requireMember(request);
  if ('response' in auth) return auth.response;
  const userId = auth.identity.userId;

  try {
    const body = await request.json();
    const { childName, age, gender, concerns, otherConcern, basicInfo, recentChanges } = body;

    // 验证年龄范围
    if (age !== undefined && age !== null && (age < 0 || age > 18)) {
      return NextResponse.json({ error: '年龄必须在 0-18 之间' }, { status: 400 });
    }

    // 验证性别
    if (gender && gender !== 'male' && gender !== 'female') {
      return NextResponse.json({ error: '性别值无效' }, { status: 400 });
    }

    const docClient = await getDocClient();
    await docClient.send(new PutCommand({
      TableName: 'HomeschoolPrompts',
      Item: {
        UserId: String(userId),
        childName,
        age: age !== undefined ? age : null,
        gender: gender || null,
        concerns: concerns || [],
        otherConcern: otherConcern || '',
        basicInfo,
        recentChanges,
        assistantId: ASSISTANT_IDS.HOMESCHOOL,
        updatedAt: new Date().toISOString()
      }
    }));

    return NextResponse.json({
      success: true,
      assistantId: ASSISTANT_IDS.HOMESCHOOL,
      message: '資料已儲存'
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
