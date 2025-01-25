# 项目名称

## 简介
这是一个基于 Next.js 的聊天应用，支持多种对话类型。

## 创建新页面的流程

1. **定义页面类型**
   - 在 `app/config/chatTypes.ts` 中添加新的对话类型。

2. **创建新的页面目录和文件**
   - 在 `app/` 目录下创建一个新的子目录，例如 `app/new-page/`。
   - 在新目录中创建 `page.tsx` 文件。

3. **配置路由**
   - 创建目录和 `page.tsx` 文件会自动生成路由。

4. **使用现有组件**
   - 在新页面中使用 `Chat` 组件，传入对应的 `type`、`assistantId` 和 `vectorStoreId`。

5. **数据库支持**
   - 确保 DynamoDB 表支持新的对话类型。

6. **更新导航（可选）**
   - 在应用的导航中添加新页面的链接。

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
```