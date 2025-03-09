# Payload Dumper Online

一个纯前端的 Android OTA 更新包分区提取工具。

## 功能特点

- 支持从本地文件或远程 URL 提取分区
- 支持直接从 ZIP 文件中提取，无需解压
- 支持选择性提取指定分区
- 纯浏览器端处理，无需服务器
- 基于 Web Worker，不阻塞主线程

## 技术栈

- Next.js
- React
- TypeScript
- Tailwind CSS
- Web Workers

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

## 部署

本项目可以直接部署到 Vercel：

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/yourusername/payload-dumper-online)

## 许可证

MIT
