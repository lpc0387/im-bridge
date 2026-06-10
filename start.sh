#!/bin/bash
# IM Bridge 保活脚本（Linux 版）
# 用法: bash start.sh

cd ~/im-bridge
mkdir -p logs

echo "🚀 IM Bridge 启动中..."

# 杀掉旧进程
pkill -f "node src/index.js" 2>/dev/null
sleep 2

# 启动 IM Bridge
echo "[$(date +%H:%M:%S)] 启动 IM Bridge..."
node src/index.js > logs/im-bridge.log 2>&1 &
NODE_PID=$!
sleep 5

# 健康检查
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/ 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
    echo ""
    echo "=========================================="
    echo "  ✅ 服务已启动！"
    echo "  PID: $NODE_PID"
    echo "  HTTP: http://localhost/"
    echo "  健康检查: $HTTP_CODE"
    echo "=========================================="
    echo ""
else
    echo "[$(date +%H:%M:%S)] [WARN] HTTP 健康检查失败 ($HTTP_CODE)"
    echo "查看日志: tail -f logs/im-bridge.log"
fi

# 保活循环
while true; do
    sleep 60

    # 检查 node 进程
    if ! pgrep -f "node src/index.js" > /dev/null; then
        echo "[$(date +%H:%M:%S)] [WARN] Node 进程已断，正在重启..."
        node src/index.js > logs/im-bridge.log 2>&1 &
        NODE_PID=$!
        sleep 5
    fi

    # HTTP 健康检查
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/ 2>/dev/null)
    if [ "$HTTP_CODE" != "200" ]; then
        echo "[$(date +%H:%M:%S)] [WARN] HTTP 健康检查失败 ($HTTP_CODE)"
    fi
done
