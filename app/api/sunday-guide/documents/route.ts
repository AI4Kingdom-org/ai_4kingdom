import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { createDynamoDBClient } from '../../../utils/dynamodb';
import { PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 獲取文件記錄列表的API端點
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const assistantId = searchParams.get('assistantId');
    
    // 獲取數據庫連接
    const docClient = await createDynamoDBClient();
    
    // 構建查詢參數
    const params: any = {
      TableName: process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide',
    };
    
    // 如果提供了assistantId，則按助手ID過濾
    if (assistantId) {
      params.FilterExpression = "assistantId = :assistantId";
      params.ExpressionAttributeValues = {
        ":assistantId": assistantId
      };
    }
    
    // 查詢文件記錄
    const result = await docClient.send(new ScanCommand(params));
    
    // 返回結果
    return NextResponse.json({
      success: true,
      records: result.Items?.map(item => ({
        assistantId: item.assistantId,
        vectorStoreId: item.vectorStoreId,
        fileId: item.fileId,
        fileName: item.fileName || '未命名文件',
        updatedAt: item.updatedAt || item.Timestamp,
        summary: item.summary ? '已生成' : '未生成',
        fullText: item.fullText ? '已生成' : '未生成',
        devotional: item.devotional ? '已生成' : '未生成', 
        bibleStudy: item.bibleStudy ? '已生成' : '未生成'
      })) || []
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

    console.log('请求参数详情:', {
      文件信息: file ? {
        名称: file.name,
        类型: file.type,
        大小: file.size,
        最后修改时间: file.lastModified
      } : '无文件',
      助手ID: assistantId || '未提供',
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

    // 转换文件格式
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

      // 4. 更新 DynamoDB 记录
      currentStep = '更新 DynamoDB 記錄';
      stepStartTime = Date.now();
      console.log(`[DEBUG] 步驟 4: 開始${currentStep}`);
      
      const docClient = await createDynamoDBClient();
      const tableName = process.env.NEXT_PUBLIC_SUNDAY_GUIDE_TABLE || 'SundayGuide';
      
      console.log(`[DEBUG] 使用數據表: ${tableName}`);
      
      const command = new PutCommand({
        TableName: tableName,
        Item: {
          assistantId,
          vectorStoreId: vectorStore.id,
          fileId: openaiFile.id,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          uploadTimestamp: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });

      await docClient.send(command);
      console.log(`[DEBUG] 步驟 4: ${currentStep}成功，耗時: ${Date.now() - stepStartTime}ms`);
      console.log(`[DEBUG] 整個處理流程完成，總耗時: ${Date.now() - startTime}ms`);

      return NextResponse.json({
        success: true,
        vectorStoreId: vectorStore.id,
        fileId: openaiFile.id,
        fileName: file.name,
        processingTime: Date.now() - startTime
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
      const enhancedError = new Error(`處理失敗於步驟 "${currentStep}": ${processError.message || '未知錯誤'}`);
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