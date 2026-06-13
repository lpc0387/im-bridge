<p align="center">
  <h1 align="center">🌉 IM Bridge</h1>
  <p align="center">Chat with Claude from your phone anytime. 13 IM platforms, one-command deployment.</p>
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

## One-command deployment

```bash
curl -fsSL https://raw.githubusercontent.com/lpc0387/im-bridge/master/install.sh | bash
```

Open `http://SERVER_IP:81` → configuration wizard → start chatting.

## Supported platforms

| Platform | Connection method | Public IP required |
|------|----------|:----------:|
| 💼 WeCom / Enterprise WeChat | Webhook callback | ✅ |
| 📱 Personal WeChat | iLink Bot API (official, safer) | ❌ |
| 🐦 Feishu | WebSocket | ❌ |
| 📌 DingTalk | Stream | ❌ |
| ✈️ Telegram | Long Polling | ❌ |
| 💬 Slack | Socket Mode | ❌ |
| 🎮 Discord | WebSocket | ❌ |
| 🟢 LINE | Webhook | ✅ |
| 📞 WhatsApp | Cloud API | ✅ |
| 🔒 Signal | REST API | ❌ |
| 🔮 Matrix | Sync API | ❌ |
| 🟦 Teams | Bot Framework | ❌ |
| 🔵 Google Chat | Webhook | ✅ |

## Core features

**Conversation capabilities**
- Direct Claude API calls with tools, MCP, Skills, and up to 12 tool-use turns.
- Claude Code CLI passthrough via `@@password command`, with full Git/agent capabilities and no turn limit.
- CLI session resume: send only `@@password` to rejoin the previous session; `/new` starts a new one; `/clear` clears it.
- Built-in 14+ MCP search tools such as Baidu, Bing, GitHub, CSDN, Juejin, and Zhihu.
- Skill extension system with dynamic creation, invocation, import, and multi-format adaptation.
- Generated file delivery: `.docx`, PDF, images, and other safe files created by CLI/Skills are sent back as attachments on supported platforms without exposing server paths.

**Session management**
- Multi-session switching with `/switch`, numbered selection, and `/new`.
- Persistent history and token usage statistics.
- Message guard: when a task is running, repeated inputs are intercepted and users can choose to wait or start a new session.
- Real-time status feedback for tool execution and CLI command tracing.
- CLI checkpoint resume: stalled sessions can retry with previously executed context.

**Adapter watchdog**
- Long-running adapters are monitored and marked offline after consecutive failures.
- Offline adapters are reconnected automatically every 60 seconds.
- The web dashboard shows connection status and provides manual reconnect buttons.

**Web dashboard** (port 81)
- Overview: system status, adapters, agents, and MCP tools.
- Adapters: connection status, error messages, and one-click reconnect.
- MCP: tool list, add, and remove.
- Skills: list, create, edit, delete, and import. Supports automatic adaptation from Claude Code, Codex, Gemini, Cursor, and Windsurf formats.
- Sessions: query by user, inspect conversation details, and delete sessions.
- Configuration wizard: guided setup for 13 platforms with parameter notes, acquisition paths, and QR-code login where applicable.
- Chat test: test conversation behavior online.
- Mobile-responsive layout.

## File transfer

When Claude Code CLI or a Skill creates files through `@@password command`, IM Bridge captures safe workspace files and sends them back without exposing server paths. On supported platforms, files uploaded by users are also saved into the workspace and their relative paths are passed to the Agent/CLI for follow-up processing:

- WeCom, Weixin, and Telegram: generated files are delivered as attachments, and user-uploaded files/images/videos can be received.
- Other adapters: generated files fall back to a filename/size-only notice without exposing server paths; inbound file receiving is not implemented yet.
- Default safe extensions: `.docx`, `.xlsx`, `.pptx`, `.pdf`, `.csv`, `.txt`, `.md`, `.zip`, `.png`, `.jpg`, `.jpeg`, `.gif`.
- Default limit: 20 MB per file and 5 files per message.

Configuration:

```env
IM_WORKSPACE_ROOT=/path/to/im-bridge
IM_DELIVER_EXTENSIONS=.docx,.pdf,.zip,.png,.jpg
IM_DELIVER_MAX_BYTES=20971520
IM_DELIVER_MAX_FILES=5
WEIXIN_CDN_BASE_URL=https://novac2c.cdn.weixin.qq.com/c2c
```

Safety: only files inside the workspace can be delivered; `.env`, secret-like files, dotfiles, and disallowed extensions are rejected. Absolute paths are scrubbed from replies. The Weixin file channel uses the WeChat CDN by default and can be overridden with `WEIXIN_CDN_BASE_URL` when needed.

## Commands

**Session management**

| Command | Description |
|------|------|
| `/switch` | List sessions and switch by number |
| `/new` | Create a new session |
| `/clear` | Clear the current session |
| `/cost` | Show token usage |
| `/turns` | Show conversation turns |

**System**

| Command | Description |
|------|------|
| `/setup` | Configure adapters with an interactive wizard |
| `/agents` | List agents |
| `/adapters` | Show adapter status |
| `/help` | Show help |

**CLI passthrough**

| Command | Description |
|------|------|
| `@@password command` | Invoke Claude Code CLI on the server |
| `@@password` | Rejoin the previous CLI session |
| `@@password /new` | Force a new CLI session |
| `@@password /clear` | Clear the current CLI session |
| `/cli-clear` | Clear CLI session state, similar to `/clear` but only for CLI |

## Message guard

When a new message arrives while a task is running:

```text
⏳ "Conversation" is running (5s elapsed). Please wait until it finishes.

Reply:
1️⃣ Keep waiting
2️⃣ Start a new session
```

This prevents message pileups and task conflicts.

## Architecture

```text
Mobile IM ←→ IM server ←→ IM Bridge ←→ Claude API + MCP tools
                              ↓
                        Web dashboard :81
```

```text
src/
├── adapters/           # 13 IM adapters with watchdog reconnect and long-message splitting
├── agents/             # AI agents with silent-timeout detection
├── cron/               # Scheduled tasks
├── web/                # Web dashboard
├── claude.js           # Claude API + tools, 12-turn limit
├── cli-passthrough.js  # CLI passthrough, unlimited turns, session/checkpoint resume
├── session.js          # Session management
├── message-guard.js    # Concurrent message guard
├── mcp-client.js       # MCP client
└── index.js            # Main entry
scripts/
└── setup.js            # CLI configuration script
```

## Configuration methods

**Method 1: Web dashboard (recommended)**

Open `http://SERVER_IP:81` → configuration wizard → choose a platform → fill in the guided fields → save and auto-restart.

**Method 2: In-chat setup**

Send `/setup` in an IM conversation → choose a platform → enter values step by step → save automatically.

**Method 3: CLI script**

```bash
npm run setup          # Interactive setup
npm run setup:status   # Show setup status
npm run setup:all      # Batch-configure all platforms
```

**Method 4: Manual editing**

```bash
cp .env.example .env
vim .env
pm2 restart im-bridge
```

## License

[MIT](LICENSE)
