#!/bin/bash
# IM Bridge 保活脚本
# 用法: bash start.sh

cd /d/im-bridge
mkdir -p logs

echo "🚀 IM Bridge 启动中..."

# 杀掉旧进程
taskkill //F //IM node.exe 2>/dev/null
taskkill //F //IM cloudflared.exe 2>/dev/null
sleep 2

# 启动 IM Bridge
echo "[$(date +%H:%M:%S)] 启动 IM Bridge..."
node src/index.js > logs/im-bridge.log 2>&1 &
NODE_PID=$!
sleep 8

# 启动 Cloudflare Tunnel
echo "[$(date +%H:%M:%S)] 启动 Cloudflare 隧道..."
/c/Users/Administrator/cloudflared.exe tunnel --url http://localhost:3000 --protocol http2 > logs/tunnel.log 2>&1 &
CF_PID=$!
sleep 10

# 获取隧道 URL
TUNNEL_URL=$(grep -oP 'https://[^ ]+trycloudflare.com' logs/tunnel.log | head -1)
echo ""
echo "=========================================="
echo "  ✅ 服务已启动！"
echo "  隧道 URL: $TUNNEL_URL"
echo "  回调地址: ${TUNNEL_URL}/wecom/callback"
echo "=========================================="
echo ""

# 保存当前 URL
echo "$TUNNEL_URL" > logs/current-url.txt

# 保活循环
while true; do
    sleep 60

    # 检查 node 进程
    if ! tasklist | grep -q "node.exe"; then
        echo "[$(date +%H:%M:%S)] [WARN] Node 进程已断，正在重启..."
        node src/index.js > logs/im-bridge.log 2>&1 &
        NODE_PID=$!
        sleep 5
    fi

    # 检查 cloudflared 进程
    if ! tasklist | grep -q "cloudflared.exe"; then
        echo "[$(date +%H:%M:%S)] [WARN] 隧道已断，正在重连..."
        /c/Users/Administrator/cloudflared.exe tunnel --url http://localhost:3000 --protocol http2 > logs/tunnel.log 2>&1 &
        CF_PID=$!
        sleep 10

        # 获取新 URL
        NEW_URL=$(grep -oP 'https://[^ ]+trycloudflare.com' logs/tunnel.log | head -1)
        if [ "$NEW_URL" != "$TUNNEL_URL" ]; then
            echo "[$(date +%H:%M:%S)] [INFO] ⚠️ 隧道 URL 已变化！"
            echo "[$(date +%H:%M:%S)] [INFO] 旧 URL: $TUNNEL_URL"
            echo "[$(date +%H:%M:%S)] [INFO] 新 URL: $NEW_URL"
            echo "[$(date +%H:%M:%S)] [INFO] 请更新企微回调地址: ${NEW_URL}/wecom/callback"
            TUNNEL_URL="$NEW_URL"
            echo "$TUNNEL_URL" > logs/current-url.txt
        fi
    fi

    # HTTP 健康检查
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ 2>/dev/null)
    if [ "$HTTP_CODE" != "200" ]; then
        echo "[$(date +%H:%M:%S)] [WARN] HTTP 健康检查失败 ($HTTP_CODE)"
    fi
done
