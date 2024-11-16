import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { NextResponse } from "next/server";

const dynamoClient = new DynamoDBClient({ region: "us-east-2" });

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "UserId is required" }, { status: 400 });
  }

  try {
    const params = {
      TableName: "ChatHistory",
      KeyConditionExpression: "UserId = :userId",
      ExpressionAttributeValues: {
        ":userId": { S: userId },
      },
      ScanIndexForward: true,
    };

    const command = new QueryCommand(params);
    const response = await dynamoClient.send(command);

    const history = (response.Items || []).map((item) => {
      const message = JSON.parse(item.Message.S || "{}");
      return [
        { sender: "user", text: message.userMessage },
        { sender: "bot", text: message.botReply },
      ];
    }).flat();

    return NextResponse.json({ history });
  } catch (error) {
    console.error("Error fetching chat history:", error);
    return NextResponse.json({ error: "Failed to fetch chat history" }, { status: 500 });
  }
}
