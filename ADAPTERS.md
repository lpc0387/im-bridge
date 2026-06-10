# IM Bridge 适配器配置指南

支持 13 个 IM 平台。在 `.env` 中填入对应配置，重启即可启用。

---

## 1. 企业微信（WeChat Work）

**连接方式**: Webhook 回调（需要公网 IP 或隧道）

```env
WECOM_CORPID=ww4a417a7419e691c5
WECOM_CORPSECRET=your_secret
WECOM_AGENTID=1000002
WECOM_TOKEN=your_token
WECOM_ENCODING_AES_KEY=your_aes_key
```

**配置步骤**:
1. 登录 [企微管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 应用管理 → 创建自建应用
3. 记录 AgentId、Secret
4. 我的企业 → 记录 CorpID
5. 应用详情 → 接收消息 → 设置API接收
   - URL: `http://你的域名/wecom/callback`
   - Token / EncodingAESKey: 自定义
6. 企业可信IP → 添加服务器出口 IP

---

## 2. 个人微信（Wechaty）

**连接方式**: wechaty 框架 + puppet 协议

```env
WECHAT_PERSONAL_PUPPET=wechaty-puppet-wechat4u
WECHAT_PERSONAL_TOKEN=
```

**Puppet 方案对比**:

| Puppet | 费用 | 稳定性 | 功能 |
|--------|------|--------|------|
| `wechaty-puppet-wechat4u` | 免费 | ⚠️ 一般 | 基础文本消息 |
| `wechaty-puppet-padlocal` | 付费 | ✅ 稳定 | 完整功能 |
| `wechaty-puppet-xp` | 免费 | ⚠️ 需 Windows | 较完整 |

**配置步骤**:
1. 安装 puppet: `npm install wechaty-puppet-wechat4u`（或对应 puppet）
2. 配置 `.env`
3. 启动后查看日志中的二维码链接，用微信扫码登录
4. 群聊中需要 @机器人 才会响应

**⚠️ 风险提示**: 个人微信使用第三方接口有封号风险，建议使用小号。

---

## 3. 飞书（Feishu/Lark）

**连接方式**: WebSocket 长连接（无需公网 IP）

```env
FEISHU_APP_ID=cli_xxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxx
```

**配置步骤**:
1. 登录 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 添加"机器人"能力
4. 记录 App ID 和 App Secret
5. 权限管理 → 开通 `im:message`、`im:message.create_v1` 等权限
6. 发布应用

---

## 4. 钉钉（DingTalk）

**连接方式**: Stream 模式（无需公网 IP）

```env
DINGTALK_APP_KEY=your_app_key
DINGTALK_APP_SECRET=your_app_secret
DINGTALK_ROBOT_CODE=your_robot_code
```

**配置步骤**:
1. 登录 [钉钉开放平台](https://open.dingtalk.com/)
2. 创建企业内部应用
3. 添加"机器人"能力
4. 记录 AppKey、AppSecret、Robot Code
5. 权限管理 → 开通消息相关权限
6. 发布应用

---

## 5. Telegram

**连接方式**: Long Polling（无需公网 IP）

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
```

**配置步骤**:
1. 在 Telegram 搜索 `@BotFather`
2. 发送 `/newbot`，按提示创建机器人
3. 获取 Bot Token
4. 填入 `.env`

---

## 6. Slack

**连接方式**: Socket Mode（无需公网 IP）

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
```

**配置步骤**:
1. 登录 [Slack API](https://api.slack.com/apps)
2. Create New App → From scratch
3. **OAuth & Permissions** → 添加 Bot Token Scopes:
   - `chat:write`, `channels:history`, `im:history`, `im:read`, `im:write`
4. Install to Workspace → 复制 Bot User OAuth Token (`xoxb-...`)
5. **Socket Mode** → 启用 → 创建 App Token (`xapp-...`)
6. **Event Subscriptions** → 启用 → Subscribe to bot events:
   - `message.channels`, `message.im`
7. 安装依赖: `npm install @slack/bolt`

---

## 7. Discord

**连接方式**: WebSocket（无需公网 IP）

```env
DISCORD_BOT_TOKEN=...
```

**配置步骤**:
1. 登录 [Discord Developer Portal](https://discord.com/developers/applications)
2. New Application → Bot
3. 复制 Bot Token
4. **Privileged Gateway Intents** → 启用:
   - Message Content Intent
5. OAuth2 → URL Generator → 选择 `bot` scope
6. 选择权限: `Send Messages`, `Read Message History`
7. 用生成的链接邀请 Bot 到服务器
8. 安装依赖: `npm install discord.js`

---

## 8. LINE

**连接方式**: Webhook 回调（需要公网 IP）

```env
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_CHANNEL_SECRET=...
```

**配置步骤**:
1. 登录 [LINE Developers](https://developers.line.biz/)
2. 创建 Provider → 创建 Messaging API Channel
3. 记录 Channel Secret
4. Issue Channel Access Token
5. Webhook URL 设置: `http://你的域名/line/webhook`
6. 启用 Webhook

---

## 9. WhatsApp

**连接方式**: Cloud API Webhook（需要公网 IP + Meta Business 账号）

```env
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=your_custom_token
```

**配置步骤**:
1. 登录 [Meta Business Suite](https://business.facebook.com/)
2. 创建 App → WhatsApp
3. 获取 Permanent Access Token
4. 记录 Phone Number ID
5. 设置 Webhook:
   - URL: `http://你的域名/whatsapp/webhook`
   - Verify Token: 自定义字符串
6. 订阅 `messages` 事件

---

## 10. Signal

**连接方式**: signal-cli-rest API 轮询（无需公网 IP）

```env
SIGNAL_API_URL=http://localhost:8080
SIGNAL_NUMBER=+8613800138000
```

**配置步骤**:
1. 安装 [signal-cli](https://github.com/AsamK/signal-cli)
2. 注册: `signal-cli -u +8613800138000 register`
3. 安装 [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api)
4. 启动 REST API 服务
5. 配置 `.env`

---

## 11. Matrix

**连接方式**: Sync API 轮询（无需公网 IP）

```env
MATRIX_HOMESERVER=https://matrix.org
MATRIX_ACCESS_TOKEN=...
MATRIX_USER_ID=@bot:matrix.org
```

**配置步骤**:
1. 注册 Matrix 账号（如在 matrix.org）
2. 获取 Access Token:
   ```
   curl -X POST https://matrix.org/_matrix/client/v3/login -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"你的用户名"},"password":"你的密码"}'
   ```
3. 配置 `.env`

---

## 12. Microsoft Teams

**连接方式**: Bot Framework（需要公网 IP 或隧道）

```env
TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...
```

**配置步骤**:
1. 登录 [Azure Portal](https://portal.azure.com/)
2. 创建 Bot Channels Registration
3. 记录 App ID 和 App Password
4. Messaging endpoint: `http://你的域名:3978/api/messages`
5. 在 Teams 中安装 Bot
6. 安装依赖: `npm install botbuilder`

---

## 13. Google Chat

**连接方式**: Webhook 回调（需要 Google Workspace）

```env
GOOGLECHAT_CREDENTIALS=/path/to/service-account.json
GOOGLECHAT_PROJECT_ID=your_project_id
```

**配置步骤**:
1. 登录 [Google Cloud Console](https://console.cloud.google.com/)
2. 启用 Google Chat API
3. 创建 Service Account → 下载 JSON 密钥文件
4. 配置 Google Chat API:
   - HTTP endpoint: `http://你的域名/googlechat/webhook`
5. 安装依赖: `npm install googleapis`
