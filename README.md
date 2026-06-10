# IM Bridge

> 通过企业微信在手机上与 Claude 对话。支持 MCP 工具、Skill 扩展、会话管理、CLI 透传。

## 功能

- 🤖 **Claude 对话** — 通过企微应用直接与 Claude 多轮对话
- 🔧 **MCP 工具** — 内置 ferris-search、baidu-search、open-websearch，共 14+ 工具
- 📚 **Skill 系统** — 通过 `/skill-name` 调用能力扩展，支持创建和管理
- 💬 **会话管理** — 多会话切换、Token 消耗统计
- 🖥️ **CLI 透传** — `@@密码 命令` 调用服务器 Claude Code CLI，获得完整能力
- 📊 **状态反馈** — 工具执行时实时推送进度，回复精简适合手机阅读

## 架构

```
手机企微 ←→ 企微服务器 ←→ im-bridge(Node.js) ←→ Claude API
                                            ↓
                                      MCP 工具服务器
                                      (ferris-search / baidu-search / open-websearch)
```

## 快速开始

### 1. 安装

```bash
git clone https://github.com/lpc0387/im-bridge.git ~/im-bridge
cd ~/im-bridge
npm install
```

### 2. 配置

```bash
cp .env.example .env
# 编辑 .env 填入你的配置
```

### 3. 启动

```bash
# 直接启动
node src/index.js

# 后台运行（推荐）
npm install -g pm2
pm2 start src/index.js --name im-bridge
pm2 save
pm2 startup
```

## 企微命令

| 命令 | 说明 |
|------|------|
| `/sessions` | 查看所有会话 |
| `/session <名称>` | 切换会话 |
| `/new` | 新建会话 |
| `/clear` | 清空当前会话 |
| `/cost` | 查看 Token 消耗 |
| `/turns` | 查看对话轮数 |
| `/mcp list` | 查看 MCP 工具 |
| `/mcp add <名称> <URL>` | 添加 MCP |
| `/mcp remove <名称>` | 移除 MCP |
| `@@密码 命令` | 调用服务器 CLI |

## Skill 系统

Skill 是存放在 `~/.claude/skills/` 下的 Markdown 能力扩展文件。

- 发送 `/skill-name` 调用已有 Skill
- 让 Claude 创建新 Skill："帮我创建一个 xxx 的 Skill"
- Skill 创建后自动记录到 Memory 并同步到 GitHub

## MCP 工具

| 服务器 | 工具数 | 说明 |
|--------|--------|------|
| ferris-search | 7 | 多引擎搜索、网页抓取 |
| baidu-search | 1 | 百度搜索 |
| open-websearch | 6 | Bing 搜索、文章抓取 |

## 文件结构

```
src/
├── index.js            # 主入口
├── config.js           # 配置管理
├── claude.js           # Claude API + 工具 + Skill
├── session.js          # 会话管理
├── cli-passthrough.js  # CLI 透传
├── mcp-client.js       # MCP 客户端（SSE + Stdio）
└── wecom.js            # 企微模块
```

## 环境变量

| 变量 | 说明 | 必填 |
|------|------|------|
| `ANTHROPIC_AUTH_TOKEN` | Claude API Token | ✅ |
| `ANTHROPIC_BASE_URL` | API 代理地址 | ❌ |
| `ANTHROPIC_MODEL` | 模型名称 | ❌ |
| `WECOM_CORPID` | 企微 CorpID | ✅ |
| `WECOM_CORPSECRET` | 企微 Secret | ✅ |
| `WECOM_AGENTID` | 企微 AgentId | ✅ |
| `WECOM_TOKEN` | 回调 Token | ✅ |
| `WECOM_ENCODING_AES_KEY` | 回调 AES Key | ✅ |
| `CLI_ACCESS_PASSWORD` | CLI 透传密码 | ✅ |
| `PORT` | 服务端口 | ❌ |

## License

MIT
