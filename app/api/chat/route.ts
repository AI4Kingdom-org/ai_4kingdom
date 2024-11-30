import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { fromCognitoIdentityPool } from "@aws-sdk/credential-providers";
import OpenAI from 'openai';
import { promises as fs } from 'fs';

const REGION = process.env.NEXT_PUBLIC_REGION || "us-east-2";
const IDENTITY_POOL_ID = process.env.NEXT_PUBLIC_IDENTITY_POOL_ID!;
const isDev = process.env.NODE_ENV === 'development';

// 获取未认证凭证
const getUnAuthCredentials = () => {
  console.log('[DEBUG] 尝试获取未认证凭证');
  return fromCognitoIdentityPool({
    clientConfig: { region: REGION },
    identityPoolId: IDENTITY_POOL_ID
  })();
};

// 获取 DynamoDB 配置
async function getDynamoDBConfig() {
  if (isDev) {
    return {
      region: REGION,
      credentials: {
        accessKeyId: process.env.NEXT_PUBLIC_AWS_ACCESS_KEY!,
        secretAccessKey: process.env.NEXT_PUBLIC_AWS_SECRET_KEY!
      }
    };
  }
  
  const credentials = await getUnAuthCredentials();
  return {
    region: REGION,
    credentials
  };
}

// 直接从环境变量获取配置
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const OPENAI_ORG_ID = process.env.OPENAI_ORG_ID?.trim();

// 创建 OpenAI 客户端工厂函数
function createOpenAIClient() {
  console.log('[DEBUG] OpenAI 配置检查:', {
    apiKey: OPENAI_API_KEY ? '存在' : '缺失',
    orgId: OPENAI_ORG_ID ? '存在' : '缺失'
  });

  // 首先检查配置
  if (!OPENAI_API_KEY) {
    throw new Error('OpenAI API Key 缺失');
  }

  // 创建并返回客户端 (不再强制要求 organization)
  return new OpenAI({
    apiKey: OPENAI_API_KEY,
    ...(OPENAI_ORG_ID && { organization: OPENAI_ORG_ID })
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, message } = body;

    console.log('[DEBUG] 收到 POST 请求:', { userId, message });

    if (!userId || !message) {
      return new Response(JSON.stringify({ error: 'Missing userId or message' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      console.log('[DEBUG] 初始化 OpenAI 客户端...');
      const openai = createOpenAIClient();
      console.log('[DEBUG] OpenAI 客户端初始化成功');

      // 读取 vector store ID
      let vector_store_id = process.env.NEXT_PUBLIC_VECTOR_STORE_ID;
      if (!vector_store_id) {
        console.error('NEXT_PUBLIC_VECTOR_STORE_ID 环境变量未设置');
        throw new Error('Vector store ID 配置缺失');
      }

      // 创建 assistant
      const assistant = await openai.beta.assistants.create({
        name: "Research Assistant",
        instructions: "You are an AI Agent specializing in home schooling. Your role is to assist parents who are seeking help with their children home schooling education, but you must do so in a way that promotes learning and provide detailed instructions and direct solutions. The objective is to help the parents to evaluate the student’s progress in learning and providing guidance in next step of teaching the student in a personalized and customized way. Here are your guidelines: 1. Always maintain a supportive and encouraging tone. 2. Use the Socratic method by asking probing questions to help parent to understand the interests of the student and the weakness that needs special attention. 3. Focus on guiding the parent towards understanding the student’s problems, needs and issues at the moment. 4. Provide hints, explanations of relevant concepts, and suggestions for resources when appropriate. 5. Provide home schooling resources, websites, books, and detailed solutions and direct answers that would let the parent know exactly what to do. 6. Encourage good parenting and education practices. When the parent provides the initial input, first determine which category of the student falls under: 1. The student progresses normally and needs regular guidance for next step 2. The student is struggling in a specific subject and needs special attention 3. The student needs help outside of the main subjects and needs emotional help 4. The student needs some disciplinary help 5. The parent is additional support and guidance 6. None of above, needs experienced teacher’s consoling. After determining the category, follow the following steps: 1. Analyze the question to identify the core concept or problem the student is struggling with. 2. Consider what foundational knowledge the parent or the student might be missing. 3. Think about how you can guide the parent and the student towards the solution using available resources. 4. In your conversation, include: a. Clarifying questions (as needed) b. Explanations of relevant concepts c. Suggestions to guide the parent to the website, discussion groups, books and courses, etc. Please provide the link and references. d. Encouragement the parent to solve the problem himself or herself. 5. This is a back-and-forth conversation, so just ask a single question in each message. Wait for the answer to a given question before asking another. Only provide sufficient help for the parent to make forward progress. 6. Before writing extensive explanations that solve the questions asked, guide the parent towards self-learning and solving the problem. 7. Guide the parent and student using the principles in the Bible. Never suggest anything that is against what has been taught in the Bible. Quote the Bible verses if applicable. 8. If the parent’s input is off topic, guide the parent back to course related questions. 9. When answering questions, cite the sources explicitly. 10. For every statement or suggestion, provide the exact location in the uploaded research documents, indicating which specific parts you are quoting from. Include page numbers, sections, or chunk IDs as necessary. 11. For every quoted sentence or paragraph, add a citation in the following format: [Source: {filename}, Page: {page_number}, Excerpt: {snippet}]. When answering questions, cite the sources explicitly. For every statement or suggestion, provide the exact location in the uploaded research documents, indicating which specific parts you are quoting from. Include page numbers, sections, or chunk IDs as necessary. For every quoted sentence or paragraph, add a citation in the following format: [Source: {filename}, Page: {page_number}, Excerpt: {snippet}].",
        model: "gpt-4-turbo",
        tools: [{ type: "file_search" }]
      });

      // 更新 assistant 的 tool resources
      await openai.beta.assistants.update(
        assistant.id,
        {
          tool_resources: {
            file_search: {
              vector_store_ids: [vector_store_id]
            }
          }
        }
      );

      // 创建对话线程
      const thread = await openai.beta.threads.create({
        messages: [{ role: "user", content: message }]
      });

      // 运行对话
      const run = await openai.beta.threads.runs.create(
        thread.id,
        {
          assistant_id: assistant.id,
          instructions: "Please use the uploaded research documents to provide a comprehensive response."
        }
      );

      // 等待运行完成
      let runStatus;
      do {
        runStatus = await openai.beta.threads.runs.retrieve(
          thread.id,
          run.id
        );
        if (runStatus.status === 'failed') {
          throw new Error('Assistant run failed');
        }
        if (runStatus.status !== 'completed') {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } while (runStatus.status !== 'completed');

      // 获取回复
      const messages = await openai.beta.threads.messages.list(
        thread.id
      );

      let botReply = '';
      for (const message of messages.data) {
        if (message.role === 'assistant' && message.content) {
          for (const content of message.content) {
            if (content.type === 'text') {
              botReply += content.text.value + '\n';
            }
          }
        }
      }

      // 保存到 DynamoDB
      const dbConfig = await getDynamoDBConfig();
      const client = new DynamoDBClient(dbConfig);
      const docClient = DynamoDBDocumentClient.from(client);
      
      const timestamp = new Date().toISOString();
      
      const chatItem = {
        UserId: userId,
        Timestamp: timestamp,
        Message: JSON.stringify({
          userMessage: message,
          botReply: botReply.trim()
        })
      };

      await docClient.send(new PutCommand({
        TableName: "ChatHistory",
        Item: chatItem
      }));

      return new Response(JSON.stringify({ reply: botReply.trim() }), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (apiError) {
      console.error('[ERROR] OpenAI 相关错误:', {
        error: apiError,
        message: apiError instanceof Error ? apiError.message : String(apiError),
        stack: apiError instanceof Error ? apiError.stack : undefined
      });
      
      return new Response(JSON.stringify({
        error: 'OpenAI Error',
        details: apiError instanceof Error ? apiError.message : '调用 OpenAI API 失败'
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('[ERROR] 请求处理错误:', error);
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
      details: error instanceof Error ? error.message : '未知错误'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// 添加 GET 方法处理历史记录查询
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return new Response(JSON.stringify({ error: "UserId is required" }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    console.log('[DEBUG] GET 请求开始, 参数:', { userId });
    
    const dbConfig = await getDynamoDBConfig();
    const client = new DynamoDBClient(dbConfig);
    const docClient = DynamoDBDocumentClient.from(client);

    console.log('[DEBUG] 执行 DynamoDB 查询');
    
    const command = new QueryCommand({
      TableName: "ChatHistory",
      KeyConditionExpression: "UserId = :userId",
      ExpressionAttributeValues: {
        ":userId": userId
      }
    });

    const response = await docClient.send(command);
    console.log('[DEBUG] DynamoDB ���应:', JSON.stringify(response, null, 2));

    const items = response.Items?.map(item => ({
      UserId: item.UserId,
      Timestamp: item.Timestamp,
      Message: item.Message
    })) || [];

    return new Response(JSON.stringify(items), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('[ERROR] 获取聊天历史失败:', error);
    return new Response(JSON.stringify({
      error: "Failed to fetch chat history",
      details: error instanceof Error ? error.message : '未知错误'
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
