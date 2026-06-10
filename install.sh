#!/bin/bash
# ============================================================
# IM Bridge 一键安装脚本
# 用法: curl -fsSL https://raw.githubusercontent.com/lpc0387/im-bridge/master/install.sh | bash
# 或者: bash install.sh
# ============================================================

set -e

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

INSTALL_DIR="$HOME/im-bridge"
PORT=80
WEB_PORT=81

# ========== 工具函数 ==========

log() { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err() { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${BLUE}━━━ $1 ━━━${NC}"; }

command_exists() { command -v "$1" &>/dev/null; }

get_ip() {
  curl -s --max-time 5 ifconfig.me 2>/dev/null || \
  curl -s --max-time 5 ip.sb 2>/dev/null || \
  echo "你的服务器IP"
}

# ========== 欢迎信息 ==========

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════════╗"
echo "  ║     🌉 IM Bridge 一键安装脚本       ║"
echo "  ║  13 平台 IM 接入 Claude AI 助手     ║"
echo "  ╚══════════════════════════════════════╝"
echo -e "${NC}"

# ========== 步骤 1: 检测环境 ==========

step "1/6 检测服务器环境"

# 检测 OS
if [ -f /etc/os-release ]; then
  . /etc/os-release
  log "操作系统: $PRETTY_NAME"
else
  warn "无法检测操作系统，继续安装..."
fi

# 检测架构
ARCH=$(uname -m)
log "架构: $ARCH"

# 获取 IP
SERVER_IP=$(get_ip)
log "服务器 IP: $SERVER_IP"

# ========== 步骤 2: 安装 Node.js ==========

step "2/6 安装 Node.js"

if command_exists node; then
  NODE_VER=$(node --version)
  log "Node.js 已安装: $NODE_VER"
else
  log "正在安装 Node.js..."
  if command_exists dnf; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null
    dnf install -y nodejs 2>/dev/null
  elif command_exists apt; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
    apt install -y nodejs 2>/dev/null
  elif command_exists yum; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null
    yum install -y nodejs 2>/dev/null
  else
    err "无法自动安装 Node.js，请手动安装: https://nodejs.org/"
  fi
  log "Node.js 已安装: $(node --version)"
fi

# ========== 步骤 3: 安装 Claude Code CLI ==========

step "3/6 安装 Claude Code CLI"

if command_exists claude; then
  log "Claude Code CLI 已安装: $(claude --version 2>/dev/null || echo '未知版本')"
else
  log "正在安装 Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code 2>/dev/null || warn "Claude Code CLI 安装失败（不影响 IM Bridge 核心功能）"
fi

# ========== 步骤 4: 克隆项目 ==========

step "4/6 下载 IM Bridge"

if [ -d "$INSTALL_DIR/.git" ]; then
  log "项目已存在，更新中..."
  cd "$INSTALL_DIR"
  git pull origin master 2>/dev/null || warn "更新失败，使用现有版本"
else
  log "正在克隆项目..."
  rm -rf "$INSTALL_DIR"
  git clone https://github.com/lpc0387/im-bridge.git "$INSTALL_DIR" 2>/dev/null || \
  curl -fsSL https://github.com/lpc0387/im-bridge/archive/refs/heads/master.tar.gz | tar xz -C "$HOME" && \
  mv "$HOME/im-bridge-master" "$INSTALL_DIR" 2>/dev/null
fi

cd "$INSTALL_DIR"
log "项目路径: $INSTALL_DIR"

# ========== 步骤 5: 安装依赖 ==========

step "5/6 安装依赖"

log "正在安装 npm 依赖..."
npm install --production 2>/dev/null || npm install
log "依赖安装完成"

# 安装 pm2
if ! command_exists pm2; then
  log "正在安装 pm2（进程管理）..."
  npm install -g pm2 2>/dev/null
fi

# ========== 步骤 6: 启动服务 ==========

step "6/6 启动服务"

# 创建 .env（如果不存在）
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" << 'ENVEOF'
# Claude API 配置（必填）
ANTHROPIC_AUTH_TOKEN=
ANTHROPIC_BASE_URL=
ANTHROPIC_MODEL=mimo-v2.5-pro

# CLI 透传密码
CLI_ACCESS_PASSWORD=

# 服务端口
PORT=80
ENVEOF
  log "已创建 .env 配置文件"
fi

# 启动
pm2 delete im-bridge 2>/dev/null || true
pm2 start src/index.js --name im-bridge --cwd "$INSTALL_DIR" 2>/dev/null
pm2 save 2>/dev/null

# 等待启动
sleep 3

# 健康检查
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/ 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
  log "服务启动成功！"
else
  warn "服务可能还在启动中（HTTP $HTTP_CODE），请稍等片刻"
fi

# ========== 完成 ==========

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           🎉 IM Bridge 安装完成！                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}管理面板:${NC}  http://${SERVER_IP}:${WEB_PORT}"
echo -e "  ${CYAN}API 地址:${NC}  http://${SERVER_IP}:${PORT}"
echo ""
echo -e "  ${YELLOW}下一步:${NC}"
echo -e "  1. 打开管理面板 → 配置向导 → 填入 Claude API Token"
echo -e "  2. 配置企微/飞书/钉钉 等 IM 平台"
echo -e "  3. 重启服务生效"
echo ""
echo -e "  ${CYAN}常用命令:${NC}"
echo -e "  pm2 logs im-bridge     查看日志"
echo -e "  pm2 restart im-bridge  重启服务"
echo -e "  pm2 status             查看状态"
echo ""
echo -e "  ${CYAN}CLI 配置:${NC}"
echo -e "  cd ~/im-bridge && npm run setup:status  查看配置状态"
echo -e "  cd ~/im-bridge && npm run setup         交互式配置"
echo ""
