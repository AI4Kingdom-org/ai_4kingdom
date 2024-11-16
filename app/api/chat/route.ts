import { OpenAI } from "openai";
import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { NextResponse } from "next/server";

const dynamoClient = new DynamoDBClient({ region: "us-east-2" });
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 保存聊天记录到 DynamoDB
async function saveChatMessage(userId: string, message: string, reply: string) {
  const params = {
    TableName: "ChatHistory",
    Item: {
      UserId: { S: userId },
      Timestamp: { S: new Date().toISOString() },
      Message: { S: JSON.stringify({ userMessage: message, botReply: reply }) },
    },
  };

  await dynamoClient.send(new PutItemCommand(params));
}

async function getChatHistory(userId: string) {
    const params = {
      TableName: "ChatHistory",
      KeyConditionExpression: "UserId = :userId",
      ExpressionAttributeValues: {
        ":userId": { S: userId },
      },
      ScanIndexForward: true, // 按时间升序返回
    };
  
    try {
      const command = new QueryCommand(params);
      const response = await dynamoClient.send(command);
  
      // 遍历记录，解析用户消息和机器人回复
      return (response.Items || []).flatMap((item) => {
        const message = JSON.parse(item.Message.S || "{}");
        return [
          { sender: "user", text: message.userMessage },
          { sender: "bot", text: message.botReply },
        ];
      });
    } catch (error) {
      console.error("Error fetching chat history:", error);
      return [];
    }
  }

// 处理 POST 请求：保存用户消息并生成回复
export async function POST(req: Request) {
  const { userId, message } = await req.json();

  if (!userId || !message) {
    return NextResponse.json({ error: "Invalid userId or message" }, { status: 400 });
  }

  try {
    // 调用 OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: message }],
    });

    const botReply = response.choices[0]?.message?.content || "I couldn't understand that.";

    // 保存聊天记录
    await saveChatMessage(userId, message, botReply);

    return NextResponse.json({ reply: botReply });
  } catch (error) {
    console.error("Error handling POST request:", error);
    return NextResponse.json({ error: "Failed to process request" }, { status: 500 });
  }
}

// 处理 GET 请求：获取聊天历史记录
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
  
    if (!userId) {
      return NextResponse.json({ error: "UserId is required" }, { status: 400 });
    }
  
    try {
      const history = await getChatHistory(userId);
      return NextResponse.json({ history });
    } catch (error) {
      console.error("Error fetching chat history:", error);
      return NextResponse.json({ error: "Failed to fetch chat history" }, { status: 500 });
    }
  }
