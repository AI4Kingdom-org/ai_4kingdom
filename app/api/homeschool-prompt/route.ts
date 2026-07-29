import { NextResponse } from 'next/server';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoDBClient } from '../../utils/dynamodb';
import { ASSISTANT_IDS } from '../../config/constants';
import { HomeschoolPromptData, getConcernLabel } from '../../types/homeschool';
import { getOpenAI } from '../../lib/openai/client';
import { ensureConversation, isConversationId, isLegacyThreadId } from '../../lib/openai/conversation';
import { generateResponse } from '../../lib/openai/responses';

const openai = getOpenAI();

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

// 構建系統消息，將所有 prompt 資料格式化
function buildSystemMessage(data: Omit<HomeschoolPromptData, 'userId' | 'threadId' | 'assistantId' | 'updatedAt'> & { otherConcern?: string }): string {
  let message = '📋 **家長提供的孩子資料** (請根據以下資訊提供個人化建議)\n\n';
  message += '═══════════════════════════════\n\n';
  
  message += `👤 **姓名:** ${data.childName}\n`;
  
  if (data.age !== undefined) {
    message += `🎂 **年齡:** ${data.age} 歲\n`;
  }
  
  if (data.gender) {
    const genderText = data.gender === 'male' ? '男孩' : '女孩';
    message += `⚧ **性別:** ${genderText}\n`;
  }
  
  if (data.concerns && data.concerns.length > 0) {
    const concernLabels = data.concerns.map(c => getConcernLabel(c));
    message += `⚠️ **主要關注問題:** ${concernLabels.join('、')}`;
    
    // 如果選擇了「其他」且有具體說明，追加到關注問題後面
    if (data.concerns.includes('other') && data.otherConcern) {
      message += ` (其他: ${data.otherConcern})`;
    }
    message += '\n';
  }
  
  message += `\n📝 **基本情況:**\n${data.basicInfo}\n`;
  message += `\n🔄 **近期變化:**\n${data.recentChanges}\n`;
  message += '\n═══════════════════════════════\n';
  message += '💡 **請針對以上資料，提供個人化且具體的教育建議**';
  
  return message;
}

// 修改 POST 处理函数
export async function POST(request: Request) {
  console.log('[DEBUG] ========== POST /api/homeschool-prompt 開始 ==========');
  try {
    const body = await request.json();
    console.log('[DEBUG] 解析後的 body:', body);
    const { userId, childName, age, gender, concerns, otherConcern, basicInfo, recentChanges } = body;

    console.log('[DEBUG] 收到保存请求:', { userId, childName, age, gender, concerns, otherConcern });

    if (!userId) {
      return NextResponse.json({ error: 'UserId is required' }, { status: 400 });
    }

    // 验证年龄范围
    if (age !== undefined && age !== null && (age < 0 || age > 18)) {
      return NextResponse.json({ error: '年龄必须在 0-18 之间' }, { status: 400 });
    }

    // 验证性别
    if (gender && gender !== 'male' && gender !== 'female') {
      return NextResponse.json({ error: '性别值无效' }, { status: 400 });
    }

    const docClient = await getDocClient();

    // 先讀取既有的 threadId（必須在 Put 覆寫整個 item 之前讀，否則會遺失）
    const getCommand = new GetCommand({
      TableName: 'HomeschoolPrompts',
      Key: { UserId: String(userId) }
    });
    const existingData = await docClient.send(getCommand);
    let threadId = existingData.Item?.threadId;

    // 保存到 DynamoDB（保留既有 threadId，避免覆寫遺失）
    const putCommand = new PutCommand({
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
        ...(threadId ? { threadId } : {}),
        updatedAt: new Date().toISOString()
      }
    });

    await docClient.send(putCommand);
    console.log('[DEBUG] 数据已保存到 DynamoDB');

    // 构建系统消息
    const systemMessage = buildSystemMessage({
      childName,
      age,
      gender,
      concerns,
      otherConcern,
      basicInfo,
      recentChanges
    });

    console.log('[DEBUG] 系统消息已构建:', systemMessage.substring(0, 100) + '...');

    // 舊 thread_ ID 懶遷移為 conversation；conv_ ID 直接沿用
    if (threadId && isLegacyThreadId(threadId)) {
      const { conversationId } = await ensureConversation(openai, threadId, {
        userId: String(userId),
        type: 'homeschool',
        assistantId: ASSISTANT_IDS.HOMESCHOOL,
      });
      console.log('[DEBUG] 舊 homeschool thread 已遷移:', { threadId, conversationId });
      threadId = conversationId;
    }

    if (threadId) {
      // 更新現有 Conversation：構建更新訊息（與初始格式一致）
      console.log('[DEBUG] 更新現有 Conversation:', threadId);
      console.log('[DEBUG] 收到的資料:', { age, gender, concerns, otherConcern, childName });
      
      // 構建學生資料摘要
      const summaryParts: string[] = [];
      if (age !== undefined) {
        summaryParts.push(`年齡：${age} 歲`);
        console.log('[DEBUG] ✅ 加入年齡:', age);
      } else {
        console.log('[DEBUG] ❌ 年齡未定義');
      }
      if (gender) {
        const genderText = gender === 'male' ? '男孩' : '女孩';
        summaryParts.push(`性別：${genderText}`);
        console.log('[DEBUG] ✅ 加入性別:', genderText);
      } else {
        console.log('[DEBUG] ❌ 性別未定義');
      }
      if (concerns && concerns.length > 0) {
        const concernLabels = concerns.map((c: string) => getConcernLabel(c));
        const concernText = concernLabels.join('、');
        const extraText = concerns.includes('other') && otherConcern ? `（${otherConcern}）` : '';
        summaryParts.push(`主要關注：${concernText}${extraText}`);
        console.log('[DEBUG] ✅ 加入關注問題:', concernText, extraText);
      } else {
        console.log('[DEBUG] ❌ 關注問題為空');
      }
      
      console.log('[DEBUG] summaryParts:', summaryParts);
      
      // 構建更新訊息
      let updateMsg = '';
      if (summaryParts.length > 0) {
        updateMsg = `📋 學生資料：${summaryParts.join('；')}\n\n`;
      }
      updateMsg += `✅ 已收到家長更新的 **${childName}** 資料。我會根據這些最新資訊為您提供建議。`;
      
      console.log('[DEBUG] 準備發送的更新訊息:', updateMsg);
      
      await openai.conversations.items.create(threadId, {
        items: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: updateMsg }]
          },
          // 也加入詳細的內部參考資料
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: `[內部參考資料]\n${systemMessage}` }]
          }
        ] as any
      });
      console.log('[DEBUG] Conversation 訊息已更新，包含學生資料摘要');

      // 前面的 PutCommand 已重寫整個 item，需把（可能已遷移的）threadId 寫回
      await docClient.send(new PutCommand({
        TableName: 'HomeschoolPrompts',
        Item: {
          ...putCommand.input.Item,
          threadId: threadId
        }
      }));
    } else {
      // 創建新 Conversation 並生成初始建議
      console.log('[DEBUG] 創建新 Conversation');
      const conversation = await openai.conversations.create({
        metadata: {
          userId: String(userId),
          type: 'homeschool',
          assistantId: ASSISTANT_IDS.HOMESCHOOL,
        }
      });
      threadId = conversation.id;
      
      // 構建學生資料摘要（與後續回覆格式一致）
      const summaryParts: string[] = [];
      if (age !== undefined) {
        summaryParts.push(`年齡：${age} 歲`);
      }
      if (gender) {
        const genderText = gender === 'male' ? '男孩' : '女孩';
        summaryParts.push(`性別：${genderText}`);
      }
      if (concerns && concerns.length > 0) {
        const concernLabels = concerns.map((c: string) => getConcernLabel(c));
        const concernText = concernLabels.join('、');
        const extraText = concerns.includes('other') && otherConcern ? `（${otherConcern}）` : '';
        summaryParts.push(`主要關注：${concernText}${extraText}`);
      }
      
      // 構建完整的初始訊息（包含資料摘要 + 系統訊息），讓 AI 直接基於這些資料提供建議
      let initialPrompt = '';
      if (summaryParts.length > 0) {
        initialPrompt = `📋 學生資料：${summaryParts.join('；')}\n\n`;
      }
      
      // 加入詳細的學生資訊
      initialPrompt += `${systemMessage}\n\n`;
      
      // 要求 AI 提供初步建議
      initialPrompt += `請根據以上資料，為家長提供初步的教育建議和輔導方向。`;
      
      console.log('[DEBUG] 準備發送初始提示給 AI:', initialPrompt.substring(0, 150) + '...');

      // 單次呼叫：把初始提示寫入 conversation 並生成初始建議（取代舊的 messages.create + run + 輪詢）
      const result = await generateResponse(openai, {
        assistantId: ASSISTANT_IDS.HOMESCHOOL,
        conversationId: threadId,
        input: [{ role: 'user', content: initialPrompt }],
      });
      console.log('[DEBUG] 初始建議生成完成, status:', result.status);

      console.log('[DEBUG] 新 Conversation 已創建:', threadId);

      // 將 threadId 保存回 DynamoDB
      const updateCommand = new PutCommand({
        TableName: 'HomeschoolPrompts',
        Item: {
          ...putCommand.input.Item,
          threadId: threadId
        }
      });
      await docClient.send(updateCommand);
      console.log('[DEBUG] ThreadId 已保存到 DynamoDB');
    }

    return NextResponse.json({ 
      success: true,
      assistantId: ASSISTANT_IDS.HOMESCHOOL,
      threadId: threadId,
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

