# IM Bridge - Claude 移动端对话桥接

通过 Telegram / 企业微信 在手机上与 Claude 对话。

## 快速开始

### 1. 安装依赖

```bash
cd D:\im-bridge
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，填入你的 API Key：

```bash
cp .env.example .env
```

必须配置：
- `ANTHROPIC_API_KEY` - Claude API 密钥

### 3. 选择通道启动

#### 方案 A：Telegram Bot（推荐，最快）

1. 在 Telegram 搜索 `@BotFather`，发送 `/newbot` 创建机器人
2. 获取 Bot Token，填入 `.env` 的 `TELEGRAM_BOT_TOKEN`
3. 启动：
```bash
npm run telegram
```
4. 手机 Telegram 搜索你的 Bot 名字，直接发消息即可对话

#### 方案 B：企业微信

1. 注册 [企业微信](https://work.weixin.qq.com/)（免费）
2. 创建群聊 → 添加"群机器人" → 复制 Webhook URL
3. 填入 `.env` 的 `WECOM_WEBHOOK_URL`
4. 启动：
```bash
npm run wecom
```
5. 在群里 @机器人 发消息即可对话

#### 同时启动两个通道

```bash
npm start
```

## 命令

| 命令 | 说明 |
|------|------|
| `/start` | 查看帮助信息（Telegram） |
| `/clear` | 清除对话历史，重新开始 |
| `/turns` | 查看当前对话轮数 |

## 调试

直接 HTTP 调用（不依赖 IM）：

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","message":"你好"}'
```

## 文件结构

```
src/
├── index.js      # 主入口，启动各通道
├── config.js     # 环境变量配置
├── claude.js     # Claude API 调用封装（支持多轮对话）
├── telegram.js   # Telegram Bot 模块
└── wecom.js      # 企业微信模块（Webhook + 回调）
```
