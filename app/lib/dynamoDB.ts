import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
  region: process.env.NEXT_PUBLIC_AWS_REGION || "us-east-2",
  // 在 Lambda 环境中不需要显式指定凭证
  // AWS 会自动使用 Lambda 执行角色的权限
});

export const docClient = DynamoDBDocumentClient.from(client); 