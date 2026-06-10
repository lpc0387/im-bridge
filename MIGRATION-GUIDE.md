# 服务器迁移指南

## 当前环境快照 (2026-06-10)

### 硬件/系统
- OS: Windows 10 Pro 10.0.19045
- 用户: Administrator
- IP: 116.1.201.73 (出口)

### 已安装运行时
- Node.js v24.16.0
- npm 11.16.0
- Python 3.14.5 (C:\Python314)
- Rust 1.96.0 (rustup)
- Git 2.53.0 (MSYS2/MinGW)

### Claude 配置
- 模型代理: https://token-plan-cn.xiaomimimo.com/anthropic
- Auth Token: tp-crzj5knqatih7j3i1fdm46m3ll3zgupz9e1jj5e1aorr7ikg
- 模型: mimo-v2.5-pro
- 设置文件: ~/.claude/settings.json

### MCP 服务器
1. ferris-search (Rust, 自编译)
   - 路径: C:/Users/Administrator/ferris-search/target/release/ferris-search.exe
   - 源码: https://github.com/user/ferris-search (需 clone 编译)
   - 工具: web_search, fetch_web_content, fetch_github_readme, fetch_csdn_article, fetch_juejin_article, fetch_zhihu_article, fetch_linuxdo_article

2. baidu-search (npm)
   - 包名: @alex.ss/mcp-server-baidu-search
   - 安装: npm install -g @alex.ss/mcp-server-baidu-search
   - 工具: baidu_search

3. open-websearch (npx)
   - 包名: open-websearch
   - 运行: npx -y open-websearch@latest
   - 工具: web_search, fetch_web_content 等

### 企微配置
- CorpID: ww4a417a7419e691c5
- AgentId: 1000002
- Secret: v4k0DGj5QwamI_DRao40npGuP5vRnNiKe5w652CU51U
- Token: 83b09c11f5b35f841536fa863fa2cf14
- EncodingAESKey: f7FXyASnRwRbJBTEd88EyMTqAnVaGWxiQPUHRqBZjK1
- Webhook: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=af6ae0eb-cccd-4abd-8be1-65c043fba446
- IP白名单: 116.1.201.73

### ngrok 配置
- Authtoken: 3EvGDLjdHUtq8SG5PJdJPOHV4s2_2QvPuDmwaDgXE4kYzgHRS
- 免费固定域名: rented-faceted-suffix.ngrok-free.dev
- 问题: 免费版有浏览器确认页面，企微验证被拦截

### Cloudflare
- 已注册账号
- 已安装 cloudflared
- 有隧道 Token（但未绑定域名）
- 需要购买域名才能使用命名隧道

## 迁移步骤

### 0. 从 GitHub 克隆配置

```bash
# 安装 gh CLI
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh

# 登录 GitHub
gh auth login

# 克隆 Claude 配置（私有仓库）
gh repo clone lpc0387/claude-config ~/.claude

# 克隆 IM Bridge
gh repo clone lpc0387/im-bridge ~/im-bridge

# 更新 token
sed -i 's/YOUR_TOKEN_HERE/你的真实token/' ~/.claude/settings.json
```

### 1. 新服务器准备

```bash
# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt install -y nodejs

# 或者用 nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install 24

# 安装 Python (可选，MCP 工具需要)
sudo apt install -y python3 python3-pip

# 安装 Rust (编译 ferris-search 需要)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. 复制项目

```bash
# 从当前服务器复制
scp -r Administrator@116.1.201.73:D:/im-bridge /opt/im-bridge

# 或用 git
git clone <repo-url> /opt/im-bridge
```

### 3. 更新配置

```bash
cd /opt/im-bridge

# 安装依赖
npm install

# 编辑 .env 更新以下内容：
# - ANTHROPIC_AUTH_TOKEN (如果换了代理)
# - ANTHROPIC_BASE_URL (如果换了代理)
# - WECOM_CORPSECRET (如果企微应用重建)
# - WECOM_TOKEN / WECOM_ENCODING_AES_KEY (如果回调重建)
# - 更新企微后台 IP 白名单为新服务器 IP
```

### 4. 安装 MCP 工具

```bash
# ferris-search
git clone https://github.com/user/ferris-search.git
cd ferris-search
cargo build --release
# 更新 mcp-config.json 中的路径

# baidu-search
npm install -g @alex.ss/mcp-server-baidu-search

# open-websearch (npx 方式自动安装)
```

### 5. 启动服务

```bash
cd /opt/im-bridge
node src/index.js
```

### 6. 配置隧道

购买域名后：
```bash
# 安装 cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# 登录
cloudflared tunnel login

# 创建命名隧道
cloudflared tunnel create im-bridge

# 配置路由
cloudflared tunnel route dns im-bridge claude.yourdomain.com

# 运行
cloudflared tunnel run im-bridge
```

### 7. 更新企微回调

企微后台 → 应用详情 → 接收消息 → 修改 API 接收：
- URL: https://claude.yourdomain.com/wecom/callback
- Token: 保持不变
- EncodingAESKey: 保持不变

## 架构决策记录

### 为什么选择企微而不是个人微信？
- 个人微信协议逆向有封号风险
- 企微有官方 API，稳定可靠
- 企微 Webhook 最简单，应用消息支持双向

### 为什么用 MCP 而不是直接写工具？
- MCP 是标准协议，工具可复用
- 支持动态添加/移除工具
- 工具集与 Claude Code CLI 保持一致

### 为什么 mimo 模型需要特殊处理？
- mimo-v2.5-pro 不返回标准 tool_use 块
- 工具调用以 XML 格式嵌入 text 块
- 需要 XML 解析器提取工具调用

### 隧道方案对比
| 方案 | 企微验证 | URL固定 | 免费 | 稳定性 |
|------|---------|---------|------|--------|
| serveo | ✅ | ❌ | ✅ | 中 |
| ngrok免费 | ❌ | ✅ | ✅ | 高 |
| ngrok付费 | ✅ | ✅ | ❌ | 高 |
| cloudflare quick | ✅ | ❌ | ✅ | 高 |
| cloudflare 命名 | ✅ | ✅ | 需域名 | 最高 |

**最终推荐**: 购买域名 + Cloudflare 命名隧道
