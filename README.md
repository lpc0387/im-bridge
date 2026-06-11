<p align="center">
  <h1 align="center">🌉 IM Bridge</h1>
  <p align="center">在手机上随时与 Claude 对话。13 个 IM 平台，一键部署。</p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.2.1-blue" alt="version">
  <img src="https://img.shields.io/badge/node-%3E%3D18-green" alt="node">
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="license">
</p>

<p align="center">
  <a href="README.md">简体中文</a> |
  <a href="README.en.md">English</a> |
  <a href="README.ja.md">日本語</a>
</p>

---

## 一键部署

```bash
curl -fsSL https://raw.githubusercontent.com/lpc0387/im-bridge/master/install.sh | bash
```

打开 `http://服务器IP:81` → 配置向导 → 开始对话。

## 支持平台

| 平台 | 连接方式 | 需要公网 IP |
|------|----------|:----------:|
| 💼 企业微信 | Webhook 回调 | ✅ |
| 📱 个人微信 | iLink Bot API（官方，安全不封号） | ❌ |
| 🐦 飞书 | WebSocket | ❌ |
| 📌 钉钉 | Stream | ❌ |
| ✈️ Telegram | Long Polling | ❌ |
| 💬 Slack | Socket Mode | ❌ |
| 🎮 Discord | WebSocket | ❌ |
| 🟢 LINE | Webhook | ✅ |
| 📞 WhatsApp | Cloud API | ✅ |
| 🔒 Signal | REST API | ❌ |
| 🔮 Matrix | Sync API | ❌ |
| 🟦 Teams | Bot Framework | ❌ |
| 🔵 Google Chat | Webhook | ✅ |

## 核心功能

**对话能力**
- Claude API 直接调用（带工具、MCP、Skill，最多 12 轮工具调用）
- Claude Code CLI 透传（`@@密码 命令`，完整 Git/Agent 能力，无轮数限制）
- CLI 会话续传：只发 `@@密码` 自动接入上次会话；`/new` 强制新建；`/clear` 清空
- 14+ MCP 搜索工具内置（百度、Bing、GitHub、CSDN、掘金、知乎）
- Skill 扩展系统（动态创建、调用、导入适配多格式）

**会话管理**
- 多会话切换（`/switch` 编号选择，`/new` 新建）
- 历史持久化，Token 消耗统计
- 消息守卫：任务执行中自动拦截重复输入，提供「等待/新会话」选项
- 状态实时反馈（工具执行进度、CLI 命令追踪）
- CLI 断点续传：卡死自动重试，带上已执行上下文

**适配器守护**
- 长连接适配器自动检测离线（连续失败 5 次标记离线）
- 每 60 秒自动重连离线适配器
- Web 面板显示连接状态 + 手动重连按钮

**Web 管理面板**（端口 81）
- 概览：系统状态、适配器、Agent、MCP 工具一览
- 适配器：连接状态、错误信息、一键重连
- MCP：工具列表、添加/删除
- Skill：列表、新建、编辑、删除、导入（支持 Claude Code/Codex/Gemini/Cursor/Windsurf 格式自动适配）
- 会话：按用户查询、查看对话详情、删除会话
- 配置向导：13 平台傻瓜式配置（带参数注释、获取路径、扫码登录）
- 对话测试：在线测试对话效果
- 移动端响应式布局

## 命令

**会话管理**

| 命令 | 说明 |
|------|------|
| `/switch` | 列出会话，输入编号切换 |
| `/new` | 新建会话 |
| `/clear` | 清空当前会话 |
| `/cost` | Token 消耗 |
| `/turns` | 对话轮数 |

**系统**

| 命令 | 说明 |
|------|------|
| `/setup` | 配置适配器（对话式向导） |
| `/agents` | Agent 列表 |
| `/adapters` | 适配器状态 |
| `/help` | 帮助 |

**CLI 透传**

| 命令 | 说明 |
|------|------|
| `@@密码 命令` | 调用服务器 Claude Code CLI |
| `@@密码` | 接入上次 CLI 会话（断点续传） |
| `@@密码 /new` | 强制开启新的 CLI 会话 |
| `@@密码 /clear` | 清空当前 CLI 会话 |
| `/cli-clear` | 清除 CLI 会话（同 `/clear` 但只清 CLI） |

## 消息守卫

当任务执行中收到新消息时：

```
⏳ 「对话」执行中（已 5s），请等待结束后输入。

回复：
1️⃣ 继续等待
2️⃣ 开启新的会话
```

防止消息堆积和任务冲突。

## 架构

```
手机 IM ←→ IM 服务器 ←→ IM Bridge ←→ Claude API + MCP 工具
                              ↓
                        Web 管理面板 :81
```

```
src/
├── adapters/           # 13 个 IM 适配器（含守护重连、长消息分段）
├── agents/             # AI Agent（含静默超时检测）
├── cron/               # 定时任务
├── web/                # Web 管理界面
├── claude.js           # Claude API + 工具（12 轮上限）
├── cli-passthrough.js  # CLI 透传（无轮数限制、会话续传、断点续传）
├── session.js          # 会话管理
├── message-guard.js    # 消息守卫（并发控制）
├── mcp-client.js       # MCP 客户端
└── index.js            # 主入口
scripts/
└── setup.js            # CLI 配置脚本
```

## 配置方式

**方式 1：Web 管理面板（推荐）**

打开 `http://服务器IP:81` → 配置向导 → 选择平台 → 按提示填写 → 保存自动重启

**方式 2：对话式配置**

在 IM 中发送 `/setup` → 选择平台 → 逐项输入 → 自动保存

**方式 3：CLI 脚本**

```bash
npm run setup          # 交互式配置
npm run setup:status   # 查看配置状态
npm run setup:all      # 批量配置所有平台
```

**方式 4：手动编辑**

```bash
cp .env.example .env
vim .env
pm2 restart im-bridge
```

## 许可证

[MIT](LICENSE)
