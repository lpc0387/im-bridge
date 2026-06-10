# IM Bridge 完整部署指南（OpenCloudOS 9.4）

## 一、安装基础环境

```bash
# 1. 更新系统
sudo dnf update -y

# 2. 安装基础工具
sudo dnf install -y git curl wget tar

# 3. 安装 Node.js 24
curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
sudo dnf install -y nodejs

# 4. 验证
node --version
npm --version

# 5. 安装 Claude Code CLI
npm install -g @anthropic-ai/claude-code

# 6. 安装 GitHub CLI
sudo dnf install -y 'dnf-command(config-manager)'
sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
sudo dnf install -y gh
```

## 二、配置 Claude

```bash
# 设置环境变量（写入 bashrc 持久化）
cat >> ~/.bashrc << 'EOF'
export ANTHROPIC_AUTH_TOKEN=tp-crzj5knqatih7j3i1fdm46m3ll3zgupz9e1jj5e1aorr7ikg
export ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
export ANTHROPIC_MODEL=mimo-v2.5-pro
EOF
source ~/.bashrc

# 验证 Claude
claude --version
```

## 三、克隆配置和项目

```bash
# 登录 GitHub
gh auth login
# 选择：GitHub.com → HTTPS → Login with a web browser

# 克隆 Claude 配置（skills、memory、settings）
gh repo clone lpc0387/claude-config ~/.claude

# 克隆 IM Bridge 项目
gh repo clone lpc0387/im-bridge ~/im-bridge

# 更新 settings.json 中的 token
sed -i 's/YOUR_TOKEN_HERE/tp-crzj5knqatih7j3i1fdm46m3ll3zgupz9e1jj5e1aorr7ikg/' ~/.claude/settings.json
```

## 四、配置 IM Bridge

```bash
cd ~/im-bridge

# 安装依赖
npm install

# 创建配置文件
cat > .env << 'EOF'
ANTHROPIC_AUTH_TOKEN=tp-crzj5knqatih7j3i1fdm46m3ll3zgupz9e1jj5e1aorr7ikg
ANTHROPIC_BASE_URL=https://token-plan-cn.xiaomimimo.com/anthropic
ANTHROPIC_MODEL=mimo-v2.5-pro
WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=af6ae0eb-cccd-4abd-8be1-65c043fba446
WECOM_CORPID=ww4a417a7419e691c5
WECOM_CORPSECRET=v4k0DGj5QwamI_DRao40npGuP5vRnNiKe5w652CU51U
WECOM_AGENTID=1000002
WECOM_TOKEN=83b09c11f5b35f841536fa863fa2cf14
WECOM_ENCODING_AES_KEY=f7FXyASnRwRbJBTEd88EyMTqAnVaGWxiQPUHRqBZjK1
PORT=3000
EOF
```

## 五、安装 MCP 工具

```bash
# 安装 baidu-search
npm install -g @alex.ss/mcp-server-baidu-search

# 安装 Rust（编译 ferris-search 需要）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source ~/.cargo/env

# 克隆并编译 ferris-search
git clone https://github.com/nicepkg/ferris-search.git ~/ferris-search
cd ~/ferris-search
cargo build --release

# 更新 MCP 配置路径
cat > ~/im-bridge/mcp-config.json << 'EOF'
{
  "servers": {
    "ferris-search": {
      "command": "/root/ferris-search/target/release/ferris-search",
      "args": [],
      "env": {}
    },
    "baidu-search": {
      "command": "node",
      "args": ["/usr/lib/node_modules/@alex.ss/mcp-server-baidu-search/dist/index.js"],
      "env": {}
    }
  }
}
EOF
```

## 六、安装 Cloudflare Tunnel

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared --version
```

## 七、启动服务

```bash
cd ~/im-bridge

# 测试启动
node src/index.js
```

## 八、配置隧道（新终端）

```bash
# 方案A: serveo（免费，URL重启会变）
ssh -o StrictHostKeyChecking=no -R 80:localhost:3000 serveo.net

# 方案B: cloudflare quick tunnel（免费，URL重启会变）
cloudflared tunnel --url http://localhost:3000 --protocol http2
```

## 九、更新企微回调

拿到隧道 URL 后（如 `https://xxx.trycloudflare.com`），去企微后台：

1. 打开 https://work.weixin.qq.com/wework_admin/frame
2. 应用管理 → 你的应用 → 接收消息 → 设置API接收
3. 填入：
   - URL: `https://你的隧道URL/wecom/callback`
   - Token: `83b09c11f5b35f841536fa863fa2cf14`
   - EncodingAESKey: `f7FXyASnRwRbJBTEd88EyMTqAnVaGWxiQPUHRqBZjK1`
4. 保存
5. 更新 IP 白名单：添加新服务器的出口 IP

## 十、后台运行（可选）

```bash
# 安装 pm2
npm install -g pm2

# 启动 IM Bridge
cd ~/im-bridge
pm2 start src/index.js --name im-bridge

# 开机自启
pm2 save
pm2 startup
```

## 关键信息汇总

| 项目 | 值 |
|------|-----|
| 企微 CorpID | ww4a417a7419e691c5 |
| 企微 AgentId | 1000002 |
| 企微 Secret | v4k0DGj5QwamI_DRao40npGuP5vRnNiKe5w652CU51U |
| 企微 Token | 83b09c11f5b35f841536fa863fa2cf14 |
| 企微 EncodingAESKey | f7FXyASnRwRbJBTEd88EyMTqAnVaGWxiQPUHRqBZjK1 |
| 企微 Webhook | https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=af6ae0eb-cccd-4abd-8be1-65c043fba446 |
| Claude Auth Token | tp-crzj5knqatih7j3i1fdm46m3ll3zgupz9e1jj5e1aorr7ikg |
| Claude 代理 | https://token-plan-cn.xiaomimimo.com/anthropic |
| GitHub 仓库1 | https://github.com/lpc0387/claude-config |
| GitHub 仓库2 | https://github.com/lpc0387/im-bridge |
