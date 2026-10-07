import { NextResponse } from 'next/server';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamoDBConfig } from "@/app/utils/dynamodb";
import { requireMember } from "@/app/lib/identity/server";

export async function GET(request: Request) {
  // 只能查自己的用量
  const auth = requireMember(request);
  if ('response' in auth) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const userId = auth.identity.userId;
    const year = searchParams.get("year") || new Date().getFullYear();

    const config = await getDynamoDBConfig();
    const client = new DynamoDBClient(config);
    const docClient = DynamoDBDocumentClient.from(client);

    // 查询指定年份的所有月份数据
    const command = new QueryCommand({
      TableName: "MonthlyTokenUsage",
      KeyConditionExpression: "UserId = :userId AND begins_with(YearMonth, :year)",
      ExpressionAttributeValues: {
        ":userId": userId,
        ":year": `${year}`
      }
    });

    const response = await docClient.send(command);
    
    return NextResponse.json({
      success: true,
      usage: response.Items || []
    });

  } catch (error) {
    console.error('[ERROR] 获取月度使用统计失败:', error);
    return NextResponse.json({
      error: '获取使用统计失败',
      details: error instanceof Error ? error.message : '未知错误'
    }, { status: 500 });
  }
} 