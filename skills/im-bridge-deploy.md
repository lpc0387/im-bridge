# IM Bridge 部署 Skill

## 概述

将 Claude AI 助手接入企业微信，实现手机端对话。支持文件读取、命令执行、MCP 工具调用。

## 架构

```
手机企微 ←→ 企微服务器 ←→ 隧道(ngrok/serveo/cloudflare) ←→ im-bridge(Node.js) ←→ Claude API
                                                                        ↓
                                                                  MCP 工具服务器
                                                                  (ferris-search等)
```

## 依赖环境

### 运行时
- Node.js >= 18 (推荐 v24+)
- npm >= 9
- Windows 10/11 (当前适配)

### npm 依赖
```json
{
  "@anthropic-ai/sdk": "^0.39.0",
  "telegraf": "^4.16.3",
  "express": "^4.21.0",
  "dotenv": "^16.4.7"
}
```

### MCP 工具（可选）
- ferris-search (Rust 编译的多引擎搜索)
- baidu-search (npm 包)
- open-websearch (npm 包, npx 方式)

## 完整部署步骤

### 第一步：企微后台配置

1. 登录 [企微管理后台](https://work.weixin.qq.com/wework_admin/frame)
2. 创建自建应用：
   - 应用管理 → 自建 → 创建应用
   - 填写名称、logo、可见范围
   - 记录 **AgentId** 和 **Secret**
3. 获取企业ID：
   - 我的企业 → 企业信息最下方 → **CorpID**
4. 配置 IP 白名单：
   - 应用详情 → 企业可信IP → 添加服务器出口 IP
5. 配置回调（等隧道启动后再做）：
   - 应用详情 → 接收消息 → 设置API接收
   - 填入 URL、Token、EncodingAESKey

### 第二步：项目部署

```bash
# 克隆项目
cd D:\im-bridge

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入以下信息：
```

### 第三步：环境变量配置 (.env)

```env
# Claude API（使用代理）
ANTHROPIC_AUTH_TOKEN=your_auth_token
ANTHROPIC_BASE_URL=https://your-proxy/anthropic
ANTHROPIC_MODEL=mimo-v2.5-pro

# 企微 Webhook（群机器人，可选）
WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx

# 企微应用（双向对话）
WECOM_CORPID=ww4a417a7419e691c5
WECOM_CORPSECRET=your_secret
WECOM_AGENTID=1000002
WECOM_TOKEN=your_token
WECOM_ENCODING_AES_KEY=your_aes_key

# Telegram（可选）
TELEGRAM_BOT_TOKEN=

# 端口
PORT=3000
```

### 第四步：MCP 配置 (mcp-config.json)

```json
{
  "servers": {
    "ferris-search": {
      "command": "C:/path/to/ferris-search.exe",
      "args": [],
      "env": {}
    },
    "baidu-search": {
      "command": "node",
      "args": ["C:/path/to/mcp-server-baidu-search/dist/index.js"],
      "env": {}
    }
  }
}
```

### 第五步：启动服务

```bash
# 启动 IM Bridge
node src/index.js

# 启动隧道（任选一种）
# 方案A: serveo（免费，URL会变）
ssh -o StrictHostKeyChecking=no -R 80:localhost:3000 serveo.net

# 方案B: ngrok（免费固定域名，但有浏览器拦截）
ngrok http 3000 --domain=your-domain.ngrok-free.dev

# 方案C: cloudflare tunnel（推荐，需域名）
cloudflared.exe tunnel --url http://localhost:3000 --protocol http2
```

### 第六步：企微后台配置回调

隧道启动后，用获取到的 URL 配置：
- URL: `https://your-tunnel-url/wecom/callback`
- Token: 自定义（如 `83b09c11f5b35f841536fa863fa2cf14`）
- EncodingAESKey: 自动生成（43位英文数字）

## 项目文件结构

```
D:\im-bridge\
├── package.json          # 依赖配置
├── .env                  # 环境变量（不提交）
├── .env.example          # 环境变量模板
├── mcp-config.json       # MCP 服务器配置
├── start.bat             # Windows 保活脚本
├── start.sh              # Bash 保活脚本
├── README.md             # 项目文档
├── logs\                 # 日志目录
│   ├── im-bridge.log
│   ├── tunnel.log
│   └── current-url.txt
└── src\
    ├── index.js          # 主入口
    ├── config.js         # 配置管理
    ├── claude.js         # Claude API + 工具调用
    ├── mcp-client.js     # MCP 客户端（SSE + Stdio）
    ├── telegram.js       # Telegram Bot
    └── wecom.js          # 企微模块
```

## 企微命令

| 命令 | 说明 |
|------|------|
| `/clear` | 清除对话历史 |
| `/turns` | 查看对话轮数 |
| `/mcp list` | 查看 MCP 工具 |
| `/mcp add <名称> <URL>` | 添加 MCP 服务器 |
| `/mcp remove <名称>` | 移除 MCP |
| `/mcp reload` | 重载所有 MCP |

## 内置工具

| 工具 | 说明 |
|------|------|
| `read_file` | 读取电脑文件 |
| `list_dir` | 列出目录 |
| `run_command` | 执行命令 |
| `write_file` | 写入文件 |
| `install_mcp` | 安装 MCP 工具 |
| `list_mcps` | 查看 MCP 列表 |
| `remove_mcp` | 移除 MCP |

## 已知问题

1. **隧道 URL 不稳定**：serveo/cloudflare quick tunnel 的 URL 重启会变
   - 解决：购买域名 + Cloudflare 命名隧道
2. **ngrok 免费版有浏览器拦截**：企微验证请求被拦截
   - 解决：付费版或换其他隧道
3. **mimo 模型工具调用格式非标准**：返回 XML 格式而非 tool_use 块
   - 已解决：代码中有 XML 解析器兼容
4. **open-websearch 的 npx 启动**：Windows 下需要 shell:true
   - 已解决：spawn 参数已加 shell: true

## 迁移注意事项

迁移到新服务器时需要：
1. 安装 Node.js、npm
2. 复制整个 D:\im-bridge 目录
3. 更新 .env 中的 API Key 和企微凭证
4. 更新企微后台的 IP 白名单
5. 更新企微后台的回调 URL（如果隧道 URL 变了）
6. 安装 MCP 工具（ferris-search 需要重新编译）
7. 重新配置 Claude 模型代理地址
