import { NextResponse } from 'next/server';
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { 
  DynamoDBDocumentClient, 
  GetCommand,
  PutCommand
} from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_REGION || "us-east-2",
  credentials: {
    accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY!,
    secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_KEY!
  }
});

const docClient = DynamoDBDocumentClient.from(client);

// 获取当前Prompt
export async function GET() {
  try {
    const command = new GetCommand({
      TableName: "AIPrompts",
      Key: { id: "current" }
    });

    const response = await docClient.send(command);
    
    if (!response.Item) {
      // 如果没有找到prompt，返回默认值
      return NextResponse.json({
        id: "current",
        content: "You are an AI assistant...",
        lastUpdated: new Date().toISOString()
      });
    }

    return NextResponse.json(response.Item);
  } catch (error) {
    console.error('获取Prompt失败:', error);
    return NextResponse.json(
      { error: '获取Prompt失败' },
      { status: 500 }
    );
  }
}

// 更新Prompt
export async function PUT(request: Request) {
  try {
    const { content } = await request.json();

    const command = new PutCommand({
      TableName: "AIPrompts",
      Item: {
        id: "current",
        content,
        lastUpdated: new Date().toISOString()
      }
    });

    await docClient.send(command);
    
    return NextResponse.json({ 
      message: 'Prompt更新成功' 
    });
  } catch (error) {
    console.error('更新Prompt失败:', error);
    return NextResponse.json(
      { error: '更新Prompt失败' },
      { status: 500 }
    );
  }
} 