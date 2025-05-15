// 提供優化過的 DynamoDB 查詢和批量操作
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, BatchGetCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoDBClient } from "./dynamodb";

/**
 * 使用索引或主鍵查詢 DynamoDB 資料表
 * 優先使用 QueryCommand，如果索引條件不符合則退回到 ScanCommand
 */
export async function optimizedQuery(params: {
  tableName: string;
  indexName?: string;
  keyCondition: { [key: string]: any };
  filterExpression?: string;
  expressionAttributeValues?: { [key: string]: any };
  expressionAttributeNames?: { [key: string]: string };
  limit?: number;
}) {
  const { tableName, indexName, keyCondition, filterExpression, expressionAttributeValues, expressionAttributeNames, limit } = params;
  
  const client = await createDynamoDBClient();
  const keyConditionKeys = Object.keys(keyCondition);
  
  try {
    // 先嘗試使用 QueryCommand (假設表有適當的索引)
    if (keyConditionKeys.length > 0) {
      const keyConditionExpressions = keyConditionKeys.map(key => `${key} = :${key}`);
      const queryParams: any = {
        TableName: tableName,
        KeyConditionExpression: keyConditionExpressions.join(" AND "),
        ExpressionAttributeValues: {},
      };
      
      // 建立 ExpressionAttributeValues
      for (const key of keyConditionKeys) {
        queryParams.ExpressionAttributeValues[`:${key}`] = keyCondition[key];
      }
      
      // 如果有提供額外的 expressionAttributeValues，合併它們
      if (expressionAttributeValues) {
        queryParams.ExpressionAttributeValues = {
          ...queryParams.ExpressionAttributeValues,
          ...expressionAttributeValues,
        };
      }
      
      // 可選參數
      if (indexName) queryParams.IndexName = indexName;
      if (filterExpression) queryParams.FilterExpression = filterExpression;
      if (expressionAttributeNames) queryParams.ExpressionAttributeNames = expressionAttributeNames;
      if (limit) queryParams.Limit = limit;
      
      console.log(`[DEBUG] 使用 QueryCommand 查詢: ${tableName}`);
      return await client.send(new QueryCommand(queryParams));
    }
  } catch (queryError: any) {
    console.log(`[DEBUG] QueryCommand 失敗，退回到 ScanCommand: ${queryError.message}`);
  }
  
  // 如果 QueryCommand 失敗或無法使用，退回到 ScanCommand
  const scanParams: any = {
    TableName: tableName,
  };
  
  // 從 keyCondition 建立 FilterExpression
  if (keyConditionKeys.length > 0) {
    scanParams.FilterExpression = keyConditionKeys.map(key => `${key} = :${key}`).join(" AND ");
    scanParams.ExpressionAttributeValues = {};
    
    for (const key of keyConditionKeys) {
      scanParams.ExpressionAttributeValues[`:${key}`] = keyCondition[key];
    }
  }
  
  // 添加額外的 filterExpression (如果有)
  if (filterExpression) {
    if (scanParams.FilterExpression) {
      scanParams.FilterExpression = `${scanParams.FilterExpression} AND ${filterExpression}`;
    } else {
      scanParams.FilterExpression = filterExpression;
    }
  }
  
  // 合併 expressionAttributeValues
  if (expressionAttributeValues) {
    scanParams.ExpressionAttributeValues = {
      ...(scanParams.ExpressionAttributeValues || {}),
      ...expressionAttributeValues,
    };
  }
  
  // 可選參數
  if (expressionAttributeNames) scanParams.ExpressionAttributeNames = expressionAttributeNames;
  if (limit) scanParams.Limit = limit;
  
  console.log(`[DEBUG] 使用 ScanCommand 查詢: ${tableName}`);
  return await client.send(new ScanCommand(scanParams));
}

/**
 * 批量獲取項目
 */
export async function batchGetItems(params: {
  tableName: string;
  keys: Record<string, any>[];
}) {
  const { tableName, keys } = params;
  const client = await createDynamoDBClient();
  
  const batchParams = {
    RequestItems: {
      [tableName]: {
        Keys: keys
      }
    }
  };
  
  return await client.send(new BatchGetCommand(batchParams));
}
