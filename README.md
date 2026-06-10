# IM Bridge v3.0

通过企业微信/飞书/钉钉/Telegram 在手机上与 Claude 对话，支持 MCP 动态管理、多 Agent、定时任务、Web 管理界面。

## 🆕 v3.0 新增功能

### 1. 多平台支持
- **企业微信** - Webhook + 应用回调
- **飞书** - WebSocket 长连接（无需公网 IP）
- **钉钉** - Stream 模式（无需公网 IP）
- **Telegram** - Long Polling（无需公网 IP）

### 2. 多 Agent 支持
- **Claude API** - 直接调用 Claude API
- **Claude Code CLI** - 调用本地 Claude Code
- **Codex** - OpenAI Codex CLI
- **Gemini** - Google Gemini CLI

### 3. 定时任务系统
- Cron 表达式调度
- 自动执行 AI 任务
- 结果通知到 IM
- 任务管理（启用/禁用/删除）

### 4. Web 管理界面
- 系统状态监控
- 适配器管理
- Agent 管理
- 定时任务管理
- MCP 工具管理
- 对话测试

### 5. 保留原有功能
- ✅ MCP 动态管理（SSE + Stdio）
- ✅ Skill 系统
- ✅ CLI 透传模式（@@密码 命令）
- ✅ 会话管理
- ✅ 内置工具（文件读写、命令执行等）

## 🚀 快速开始

### 1. 安装依赖

```bash
cd im-bridge
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入你的配置
```

### 3. 启动服务

```bash
npm start
```

### 4. 访问管理界面

打开浏览器访问: `http://localhost:8081`

## 📱 支持的命令

### 基础命令
| 命令 | 说明 |
|------|------|
| `/clear` | 清除对话历史 |
| `/turns` | 查看对话轮数 |
| `/new` | 创建新会话 |
| `/sessions` | 查看会话列表 |
| `/session <名称>` | 切换会话 |
| `/cost` | 查看 Token 消耗 |

### 新增命令
| 命令 | 说明 |
|------|------|
| `/agents` | 查看所有 Agent |
| `/agent <名称>` | 切换默认 Agent |
| `/adapters` | 查看适配器状态 |
| `/cron` | 查看定时任务 |

### MCP 命令
| 命令 | 说明 |
|------|------|
| `/mcp list` | 查看 MCP 工具 |
| `/mcp add <名称> <URL>` | 添加 MCP |
| `/mcp remove <名称>` | 移除 MCP |
| `/mcp reload` | 重载 MCP |

### CLI 透传
| 命令 | 说明 |
|------|------|
| `@@密码 命令` | 执行 Claude Code CLI |

## 🔧 配置说明

### 飞书配置

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 创建企业自建应用
3. 开启机器人能力
4. 配置事件订阅（使用长连接）
5. 添加权限：`im:message`、`im:message:send_as_bot`
6. 发布应用
7. 将 App ID 和 App Secret 填入 `.env`

### 钉钉配置

1. 访问 [钉钉开放平台](https://open.dingtalk.com/)
2. 创建企业内部应用
3. 添加机器人能力
4. 记录 AppKey、AppSecret、RobotCode
5. 填入 `.env`

### Telegram 配置

1. 在 Telegram 中找 @BotFather
2. 发送 `/newbot` 创建 Bot
3. 获取 Bot Token
4. 填入 `.env`

## 📂 项目结构

```
im-bridge/
├── src/
│   ├── adapters/          # IM 适配器
│   │   ├── base.js        # 基类
│   │   ├── manager.js     # 管理器
│   │   ├── feishu.js      # 飞书
│   │   ├── dingtalk.js    # 钉钉
│   │   ├── telegram.js    # Telegram
│   │   └── wechat.js      # 企业微信
│   ├── agents/            # AI Agent
│   │   ├── base.js        # 基类
│   │   └── manager.js     # 管理器
│   ├── cron/              # 定时任务
│   │   └── manager.js     # 管理器
│   ├── web/               # Web 管理界面
│   │   ├── manager.js     # 管理器
│   │   └── public/        # 前端文件
│   ├── claude.js          # Claude API
│   ├── cli-passthrough.js # CLI 透传
│   ├── config.js          # 配置
│   ├── index.js           # 主入口
│   ├── mcp-client.js      # MCP 客户端
│   ├── session.js         # 会话管理
│   └── wecom.js           # 企业微信（旧版）
├── .env.example           # 环境变量示例
├── mcp-config.json        # MCP 配置
├── package.json
└── README.md
```

## 🆚 与 cc-connect 对比

| 功能 | IM Bridge | cc-connect |
|------|-----------|------------|
| 支持平台 | 4 个 | 12 个 |
| MCP 动态管理 | ✅ | ❌ |
| 多 Agent | ✅ | ✅ |
| 定时任务 | ✅ | ✅ |
| Web 管理 | ✅ | ✅ |
| 技术栈 | Node.js | Go |
| 部署方式 | npm | 二进制 |

### IM Bridge 的优势
1. **MCP 动态管理** - 运行时添加/移除 MCP 工具
2. **源码可控** - 完全掌控代码，便于定制
3. **Node.js 生态** - 更多 npm 包可用
4. **学习价值** - 理解完整架构

### cc-connect 的优势
1. **平台更多** - 支持 12 个 IM 平台
2. **开箱即用** - 单二进制，无需配置环境
3. **社区活跃** - 更多用户和贡献者

## 📄 License

MIT
