import { NextResponse } from 'next/server';
import { createDynamoDBClient } from '../../utils/dynamodb';
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

// 获取用户的所有对话
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const type = searchParams.get('type') || 'general';

  console.log('[DEBUG] API收到获取对话列表请求:', {
    userId,
    type,
    url: request.url,
    headers: Object.fromEntries(request.headers)
  });

  if (!userId) {
    return NextResponse.json({ error: 'UserId is required' }, { status: 400 });
  }

  try {
    const docClient = await createDynamoDBClient();
    
    // 使用 Query 而不是 Scan 来提高效率
    const command = new QueryCommand({
      TableName: "ChatHistory",
      KeyConditionExpression: "UserId = :userId",
      FilterExpression: "#type = :type",
      ExpressionAttributeNames: {
        "#type": "Type"
      },
      ExpressionAttributeValues: {
        ":userId": userId,
        ":type": type
      }
    });

    const response = await docClient.send(command);
    
    console.log('[DEBUG] DynamoDB原始响应:', {
      Items: response.Items,
      首条记录: response.Items?.[0]
    });

    // 确保返回的数据格式正确，并处理时间戳
    const threads = (response.Items || []).map(item => {
      console.log('[DEBUG] 处理单条记录:', {
        原始数据: item,
        原始时间戳: item.Timestamp
      });

      // 确保时间戳是有效的ISO格式
      let timestamp = item.Timestamp;
      let formattedTimestamp;

      try {
        if (!timestamp) {
          console.warn('[WARN] 时间戳为空，使用当前时间');
          formattedTimestamp = new Date().toISOString();
        } else if (typeof timestamp === 'number') {
          console.log('[DEBUG] 数字类型时间戳，转换为ISO');
          formattedTimestamp = new Date(timestamp).toISOString();
        } else if (typeof timestamp === 'string') {
          if (timestamp.includes('T')) {
            console.log('[DEBUG] 已是ISO格式时间戳');
            formattedTimestamp = timestamp;
          } else {
            console.log('[DEBUG] 非ISO格式字符串时间戳，尝试转换');
            formattedTimestamp = new Date(timestamp).toISOString();
          }
        } else {
          console.warn('[WARN] 未知时间戳格式，使用当前时间');
          formattedTimestamp = new Date().toISOString();
        }

        console.log('[DEBUG] 时间戳处理结果:', {
          输入: timestamp,
          输出: formattedTimestamp,
          类型: typeof timestamp
        });

      } catch (e) {
        console.error('[ERROR] 时间戳处理失败:', {
          输入: timestamp,
          错误: e instanceof Error ? e.message : String(e)
        });
        formattedTimestamp = new Date().toISOString();
      }

      const thread = {
        id: item.threadId,
        userId: item.UserId,
        type: item.Type,
        timestamp: formattedTimestamp,
        threadId: item.threadId,
        title: item.title || '新对话',
        lastUpdated: formattedTimestamp
      };

      console.log('[DEBUG] 格式化后的记录:', thread);

      return thread;
    });
    
    // 按时间戳降序排序
    threads.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    console.log('[DEBUG] 最终返回数据:', {
      总数: threads.length,
      示例: threads[0],
      所有时间戳: threads.map(t => t.timestamp)
    });

    return NextResponse.json(threads);

  } catch (error) {
    console.error('[ERROR] 获取线程列表失败:', {
      error,
      message: error instanceof Error ? error.message : '未知错误',
      stack: error instanceof Error ? error.stack : undefined,
      type: error instanceof Error ? error.name : typeof error
    });
    
    return NextResponse.json(
      { 
        error: '获取线程列表失败',
        details: error instanceof Error ? error.message : '未知错误',
        env: {
          hasRegion: !!process.env.NEXT_PUBLIC_AWS_REGION,
          hasIdentityPool: !!process.env.NEXT_PUBLIC_IDENTITY_POOL_ID,
          hasUserPool: !!process.env.NEXT_PUBLIC_USER_POOL_ID
        }
      },
      { status: 500 }
    );
  }
} 