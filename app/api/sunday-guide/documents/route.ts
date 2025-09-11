import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createDynamoDBClient } from '../../../utils/dynamodb';
import { PutCommand, ScanCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { ASSISTANT_IDS, findUnitByAssistantId, getSundayGuideUnitConfig } from '@/app/config/constants';
import { canUploadToSundayGuideUnit } from '@/app/config/userPermissions';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 獲取文件記錄列表的API端點
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
  const assistantId = searchParams.get('assistantId');
  const agapeFilter = searchParams.get('agapeFilter') === 'true';
  const unitIdParam = searchParams.get('unitId') || undefined; // 新增：通用 unitId 過濾
    let userId = searchParams.get('userId');
    const allUsers = searchParams.get('allUsers') === 'true'; // 新增：是否獲取所有用戶的文檔
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    
    console.log('[DEBUG] 請求參數:', {
      assistantId,
      userId,
      allUsers,
      page,
      limit,
      url: request.url
    });
    
    // 獲取數據庫連接
    const docClient = await createDynamoDBClient();
    
    // 構建查詢參數
    const params: any = {
      TableName: process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide',
    };
    
    // 構建過濾表達式和表達式屬性值
    let filterExpressions = [];
    const expressionAttributeValues: Record<string, any> = {};
    
    // Agape 公開瀏覽特殊處理：
    // 現在 Agape 與 Sunday Guide 共用 assistantId；若 agapeFilter=true 則忽略傳入的 assistantId 過濾，稍後用 unitId / 舊 assistantId 二次篩選。
  // 若指定 unitId 或 agapeFilter，先不以 assistantId 篩選（改以二次過濾）
  if (!agapeFilter && !unitIdParam) {
      if (assistantId) {
        filterExpressions.push("assistantId = :assistantId");
        expressionAttributeValues[":assistantId"] = assistantId;
      } else {
        // 未指定 assistantId 且非 agapeFilter → 排除舊 Agape 專用助手資料
        filterExpressions.push("assistantId <> :agapeAid");
        expressionAttributeValues[":agapeAid"] = ASSISTANT_IDS.AGAPE_CHURCH;
      }
    }
    
    // 如果不是獲取所有用戶的文檔且提供了userId，加入用戶過濾條件
    if (!allUsers && userId) {
      // 檢查 userId 是否可以轉換為數字
      const numericUserId = !isNaN(Number(userId)) ? Number(userId) : null;
      
      if (numericUserId !== null) {
        // 如果可以轉換為數字，同時檢查字符串和數字類型
        filterExpressions.push("(userId = :userIdStr OR userId = :userIdNum OR UserId = :userIdStr OR UserId = :userIdNum)");
        expressionAttributeValues[":userIdStr"] = userId;
        expressionAttributeValues[":userIdNum"] = numericUserId;
      } else {
        // 如果不是數字，只檢查字符串
        filterExpressions.push("(userId = :userId OR UserId = :userId)");
        expressionAttributeValues[":userId"] = userId;
      }
    }
    
    // 如果有過濾條件，設置過濾表達式
    if (filterExpressions.length > 0) {
      params.FilterExpression = filterExpressions.join(" AND ");
      params.ExpressionAttributeValues = expressionAttributeValues;
    }
    
    console.log('[DEBUG] DynamoDB 查詢參數:', {
      FilterExpression: params.FilterExpression,
      ExpressionAttributeValues: params.ExpressionAttributeValues
    });
    
    // 查詢文件記錄
    const result = await docClient.send(new ScanCommand(params));
    
    console.log('[DEBUG] 查詢結果:', {
      itemCount: result.Items?.length || 0,
      firstItem: result.Items && result.Items.length > 0 ? JSON.stringify(result.Items[0]).substring(0, 200) : '無記錄'
    });

    // 處理查詢結果
    let recordsRaw = result.Items || [];

    // 單位過濾：
    // - 若有 unitIdParam：僅顯示該單位，並依該單位 allowedUploaders 篩選（公開瀏覽頁面 allUsers=true 場景）
    // - 若 agapeFilter=true（相容舊參數）：行為等同 unitIdParam='agape'
    const effectiveUnit = unitIdParam || (agapeFilter ? 'agape' : undefined);
    if (effectiveUnit) {
      const unitCfg = getSundayGuideUnitConfig(effectiveUnit);
      const allowed = unitCfg.allowedUploaders.map((u: string) => u.toString());
      recordsRaw = recordsRaw.filter(item => {
        const uploader = (item.uploadedBy || item.userId || item.UserId || '').toString();
        const itemUnit = (item.unitId || '').toString();
        return itemUnit === effectiveUnit && (allowed.length === 0 || allowed.includes(uploader));
      });
    }

    let records = recordsRaw.map(item => ({
      assistantId: item.assistantId,
      vectorStoreId: item.vectorStoreId,
      fileId: item.fileId,
      fileName: item.fileName || '未命名文件',
      updatedAt: item.updatedAt || item.Timestamp,
      userId: item.userId || item.UserId || '-',
      unitId: item.unitId || findUnitByAssistantId(item.assistantId),
      summary: item.summary ? '已生成' : '未生成',
      fullText: item.fullText ? '已生成' : '未生成',
      devotional: item.devotional ? '已生成' : '未生成', 
      bibleStudy: item.bibleStudy ? '已生成' : '未生成'
    })) || [];

    // 按時間排序（最新的在前面）
    records = records.sort((a, b) => {
      const dateA = new Date(a.updatedAt).getTime();
      const dateB = new Date(b.updatedAt).getTime();
      return dateB - dateA;
    });

    // 如果是分頁請求，進行分頁處理
    const totalCount = records.length;
    let paginatedRecords = records;
    
    if (allUsers && page && limit) {
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      paginatedRecords = records.slice(startIndex, endIndex);
    }
    
    // 返回結果
    return NextResponse.json({
      success: true,
      records: paginatedRecords,
      totalCount: totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit)
    });
    
  } catch (error) {
    console.error('獲取文件記錄錯誤:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '未知錯誤'
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    console.log('接收到文档上传请求');
    console.log('原始请求信息:', {
      方法: request.method,
      内容类型: request.headers.get('content-type'),
      请求体大小: request.headers.get('content-length'),
    });

    // 尝试获取原始请求体
    const clone = request.clone();
    const rawText = await clone.text();
    console.log('原始请求体预览:', rawText.substring(0, 500) + '...');

    const formData = await request.formData();
    
    // 详细检查 FormData 内容
    console.log('FormData 原始内容:');
    for (const [key, value] of formData.entries()) {
      console.log(`字段 ${key}:`, {
        类型: typeof value,
        是否为文件: value instanceof File,
        值: value instanceof File ? 
          `文件名: ${value.name}, 类型: ${value.type}, 大小: ${value.size}字节` : 
          value
      });
    }
    
    const file = formData.get('files') as File;
    const assistantId = formData.get('assistantId') as string;
    const userId = formData.get('userId') as string; // 獲取 userId

    // 標準化用戶 ID 的處理
    let parsedUserId = userId;
    if (userId && !isNaN(Number(userId))) {
      parsedUserId = userId;
    } else if (!userId) {
      parsedUserId = 'unknown';
    }

    console.log('请求参数详情:', {
      文件信息: file ? {
        名称: file.name,
        类型: file.type,
        大小: file.size,
        最后修改时间: file.lastModified
      } : '无文件',
      助手ID: assistantId || '未提供',
      用户ID: userId || '未提供',
      表单字段列表: Array.from(formData.keys())
    });

    if (!file || !assistantId) {
      console.error('缺少必要参数:', {
        接收到的数据: {
          文件: file ? '存在' : '不存在',
          助手ID: assistantId || '不存在',
          所有字段: Array.from(formData.keys()),
          请求头: request.headers
        }
      });
      
      return NextResponse.json({
        success: false,
        error: '缺少必要参数',
        详细信息: {
          是否有文件: !!file,
          是否有助手ID: !!assistantId,
          表单字段: Array.from(formData.keys())
        }
      }, { status: 400 });
    }

    // 轉換文件格式
    console.log('[DEBUG] 開始轉換文件格式');
    const buffer = await file.arrayBuffer();
    const blob = new Blob([buffer]);
    console.log('[DEBUG] 文件格式轉換成功，大小:', buffer.byteLength, '字節');
    
    // 記錄操作開始時間，用於計算每步執行時間
    const startTime = Date.now();
    let stepStartTime = startTime;
    let currentStep = '';
    
    try {
      // 1. 创建 vector store
      currentStep = '創建向量存儲';
      stepStartTime = Date.now();
      console.log(`[DEBUG] 步驟 1: 開始${currentStep}`);
      
      const vectorStore = await openai.beta.vectorStores.create({
        name: `Vector Store ${new Date().toISOString()}`
      });
      
      console.log(`[DEBUG] 步驟 1: ${currentStep}成功，ID: ${vectorStore.id}，耗時: ${Date.now() - stepStartTime}ms`);
      
      // 2. 创建文件
      currentStep = '上傳文件到 OpenAI';
      stepStartTime = Date.now();
      console.log(`[DEBUG] 步驟 2: 開始${currentStep}，文件名: ${file.name}，大小: ${file.size} 字節`);
      
      const openaiFile = await openai.files.create({
        file: new File([blob], file.name, { type: file.type }),
        purpose: "assistants"
      });
      
      console.log(`[DEBUG] 步驟 2: ${currentStep}成功，文件ID: ${openaiFile.id}，耗時: ${Date.now() - stepStartTime}ms`);

      // 3. 添加文件到 vector store
      currentStep = '將文件添加到向量存儲';
      stepStartTime = Date.now();
      console.log(`[DEBUG] 步驟 3: 開始${currentStep}`);
      
      await openai.beta.vectorStores.files.create(
        vectorStore.id,
        { file_id: openaiFile.id }
      );
      
      console.log(`[DEBUG] 步驟 3: ${currentStep}成功，耗時: ${Date.now() - stepStartTime}ms`);

      // 步驟 4: 呼叫 process-document 產生 summary/devotional/bibleStudy
      currentStep = '產生 summary/devotional/bibleStudy';
      stepStartTime = Date.now();
      console.log(`[DEBUG] 步驟 4: 開始${currentStep}`);
      // 呼叫內部 API 處理內容
      const processRes = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || ''}/api/sunday-guide/process-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistantId,
          vectorStoreId: vectorStore.id,
          fileName: file.name,
          userId: parsedUserId
        })
      });
      const processJson = await processRes.json();
      if (!processRes.ok) {
        throw new Error(processJson.error || '文件內容處理失敗');
      }
      console.log(`[DEBUG] 步驟 4: ${currentStep}成功，響應:`, processJson);
      // 回傳成功狀態，但不包含處理時間，因為實際的處理尚未完成
      // 處理時間將由 process-document 計算並存入資料庫，通過 check-result API 獲取
      return NextResponse.json({
        success: true,
        vectorStoreId: vectorStore.id,
        fileId: openaiFile.id,
        fileName: file.name,
        userId: parsedUserId,
        summary: processJson.summary || null,
        devotional: processJson.devotional || null,
        bibleStudy: processJson.bibleStudy || null,
        processingStarted: true  // 改為標記處理已開始，而非返回處理時間
      });
    } catch (processError) {
      // 詳細記錄處理過程中的錯誤
      const errorTime = Date.now();
      const errorDetails = {
        step: currentStep,
        errorMessage: processError instanceof Error ? processError.message : String(processError),
        errorName: processError instanceof Error ? processError.name : typeof processError,
        errorCode: (processError as any)?.status || (processError as any)?.code || 'unknown',
        stackTrace: processError instanceof Error ? processError.stack : undefined,
        elapsedTime: errorTime - startTime,
        stepElapsedTime: errorTime - stepStartTime,
        timeStamp: new Date().toISOString(),
        requestHeaders: Object.fromEntries([...request.headers.entries()].map(([key, value]) => [key, value])),
        environment: {
          nodeEnv: process.env.NODE_ENV,
          region: process.env.NEXT_PUBLIC_REGION,
          apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL,
        }
      };
      
      console.error(`[ERROR] 在步驟 "${currentStep}" 過程中出錯:`, errorDetails);
      
      // 重新拋出帶更多上下文的錯誤
      const enhancedError = new Error(`處理失敗於步驟 "${currentStep}": ${(processError as Error).message || '未知錯誤'}`);
      (enhancedError as any).originalError = processError;
      (enhancedError as any).errorDetails = errorDetails;
      throw enhancedError;
    }
  } catch (error) {
    // 最終捕獲所有錯誤並返回詳細信息
    const errorResponse = {
      success: false,
      error: error instanceof Error ? error.message : '未知錯誤',
      errorType: error instanceof Error ? error.name : typeof error,
      errorCode: (error as any)?.status || (error as any)?.code || 'unknown',
      details: error instanceof Error ? error.stack : undefined,
      context: (error as any)?.errorDetails || {},
      timestamp: new Date().toISOString()
    };
    
    console.error('[FATAL] 文件上傳處理失敗:', errorResponse);
    
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

// 單筆刪除：僅允許該筆上傳者且 unitId=agape (公開瀏覽) 刪除
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');
    const unitId = url.searchParams.get('unitId');
    const userId = url.searchParams.get('userId');

    if (!fileId || !unitId || !userId) {
      return NextResponse.json({ success: false, error: '缺少必要參數 fileId / unitId / userId' }, { status: 400 });
    }
    if (!['agape', 'eastChristHome', 'jianZhu', 'default'].includes(unitId)) {
      return NextResponse.json({ success: false, error: '不支援的單位' }, { status: 400 });
    }    const docClient = await createDynamoDBClient();
    const tableName = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';

    // 以 fileId 掃描定位紀錄（後續可用 GSI 優化）
    const scanRes = await docClient.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'fileId = :fid',
      ExpressionAttributeValues: { ':fid': fileId }
    }));
    const items = scanRes.Items || [];
    if (items.length === 0) {
      return NextResponse.json({ success: false, error: '找不到檔案紀錄' }, { status: 404 });
    }

    // 若有多筆同 fileId，取最新
    const target = items.sort((a: any, b: any) => new Date(b.Timestamp).getTime() - new Date(a.Timestamp).getTime())[0];
    const uploader = (target.uploadedBy || target.userId || target.UserId || '').toString();
    const recordUnit = (target.unitId || '').toString();

    if (uploader !== userId.toString()) {
      return NextResponse.json({ success: false, error: '無刪除權限 (非上傳者)' }, { status: 403 });
    }
    
    // 對於 default 單位，接受沒有 unitId 或 unitId 為空的記錄
    const recordUnitMatches = (unitId === 'default') 
      ? (!recordUnit || recordUnit === '' || recordUnit === 'default')
      : (recordUnit === unitId);
      
    if (!recordUnitMatches) {
      return NextResponse.json({ success: false, error: '紀錄單位與請求單位不一致' }, { status: 400 });
    }

    const assistantId = target.assistantId;
    const timestamp = target.Timestamp;
    if (!assistantId || !timestamp) {
      return NextResponse.json({ success: false, error: '紀錄缺少主鍵 (assistantId / Timestamp)' }, { status: 500 });
    }

    await docClient.send(new DeleteCommand({
      TableName: tableName,
      Key: { assistantId, Timestamp: timestamp }
    }));

    // TODO: 若需連動刪除 OpenAI vector store 或文件，於此擴充（需要保存 vectorStoreId / openai file id）

    return NextResponse.json({ success: true, message: '刪除成功', fileId });
  } catch (error) {
    console.error('[DELETE /api/sunday-guide/documents] 失敗', error);
    return NextResponse.json({ success: false, error: '刪除失敗' }, { status: 500 });
  }
}