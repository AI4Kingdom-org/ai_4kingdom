# 项目名称

## 简介
这是一个基于 Next.js 的聊天应用，支持多种对话类型。

## 初次运行项目流程

1. **克隆项目**
   ```bash
   git clone [项目地址]
   cd [项目目录]
   ```

2. **环境配置**
   创建 `.env.local` 文件：
   ```env
   NEXT_PUBLIC_REGION=your_aws_region
   NEXT_PUBLIC_USER_POOL_ID=your_cognito_user_pool_id
   NEXT_PUBLIC_USER_POOL_CLIENT_ID=your_cognito_client_id
   NEXT_PUBLIC_IDENTITY_POOL_ID=your_cognito_identity_pool_id
   NEXT_PUBLIC_API_URL=your_api_url
   NEXT_PUBLIC_API_KEY=your_api_key
   ```

3. **安装依赖**
   ```bash
   npm install
   ```

4. **配置 AWS Credentials**
   确保已配置 AWS 凭证，可以通过以下方式之一：
   - AWS CLI 配置
   - 环境变量设置
   - IAM 角色配置（如果在 AWS 服务上运行）

5. **启动开发服务器**
   ```bash
   npm run dev
   ```

6. **访问应用**
   打开浏览器访问 `http://localhost:3000`

## 创建新页面的流程

1. **定义页面类型**
   在 `app/config/chatTypes.ts` 中：
   ```typescript
   // 添加新的聊天类型
   export const CHAT_TYPES = {
     // ... existing types ...
     NEW_CHAT: 'new-chat'  // 将 'new-chat' 替换为你的聊天类型标识符
   } as const;

   // 更新类型定义
   export type ChatType = 'general' | 'new-chat';  // 添加你的聊天类型

   // 添加配置
   export const CHAT_TYPE_CONFIGS: Record<ChatType, ChatTypeConfig> = {
     'new-chat': {  // 将 'new-chat' 替换为你的聊天类型标识符
       type: 'new-chat',  // 保持与上面相同
       title: '新聊天',  // 修改为你的聊天页面标题
       description: '新聊天的描述',  // 修改为你的聊天页面描述
       assistantId: ASSISTANT_IDS.NEW_CHAT,
       vectorStoreId: VECTOR_STORE_IDS.NEW_CHAT
     }
   };
   ```

2. **配置助手和向量存储 ID**
   在 `app/config/constants.ts` 中：
   ```typescript
   export const ASSISTANT_IDS = {
     NEW_CHAT: 'your_assistant_id_here'  // 替换为你的 OpenAI Assistant ID
   };

   export const VECTOR_STORE_IDS = {
     NEW_CHAT: 'your_vector_store_id_here'  // 替换为你的向量存储 ID
   };
   ```

3. **创建新的聊天页面**
   创建文件 `app/new-chat/page.tsx`：  // 将 new-chat 替换为你的路由名称
   ```typescript
   'use client';

   import WithChat from '../components/layouts/WithChat';
   import Chat from '../components/Chat/Chat';
   import { ASSISTANT_IDS, VECTOR_STORE_IDS } from '../config/constants';

   export default function NewChatPage() {  // 将函数名改为符合你的页面名称
     return (
       <WithChat chatType="new-chat">  // 确保这里的 chatType 与 CHAT_TYPES 中定义的一致
         <Chat
           type="new-chat"  // 确保这里的 type 与 CHAT_TYPES 中定义的一致
           assistantId={ASSISTANT_IDS.NEW_CHAT}  // 确保这里的键名与 ASSISTANT_IDS 中定义的一致
           vectorStoreId={VECTOR_STORE_IDS.NEW_CHAT}  // 确保这里的键名与 VECTOR_STORE_IDS 中定义的一致
         />
       </WithChat>
     );
   }
   ```

4. **添加权限控制**
   在 `app/types/auth.ts` 中：
   ```typescript
   export type FeatureKey = 'chat' | 'new_chat';  // 将 new_chat 替换为你的功能键名

   export const FEATURE_ACCESS: Record<FeatureKey, MemberRole[]> = {
     new_chat: ['free_member', 'pro_member', 'ultimate_member']  // 根据需要调整访问权限级别
   };
   ```

## 运行项目
1. 安装依赖：
   ```bash
   npm install
   ```

2. 启动开发服务器：
   ```bash
   npm run dev
   ```

3. 打开浏览器访问 `http://localhost:3000`。

## 许可证
MIT