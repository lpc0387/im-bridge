@echo off
chcp 65001 >nul
title IM Bridge - Claude WeCom Assistant

echo ========================================
echo   IM Bridge - Claude WeCom Assistant
echo ========================================
echo.

:: 杀掉旧进程
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM cloudflared.exe >nul 2>&1
timeout /t 2 >nul

:: 启动 IM Bridge
echo [%time%] 启动 IM Bridge 服务...
cd /d D:\im-bridge
start /b node src/index.js > logs\im-bridge.log 2>&1
timeout /t 8 >nul

:: 启动 Cloudflare Tunnel
echo [%time%] 启动 Cloudflare 隧道...
start /b cloudflared.exe tunnel --url http://localhost:3000 --protocol http2 > logs\tunnel.log 2>&1
timeout /t 10 >nul

:: 获取隧道 URL
for /f "tokens=*" %%a in ('findstr /r "https://.*trycloudflare.com" logs\tunnel.log') do set TUNNEL_URL=%%a
echo.
echo ========================================
echo   服务已启动！
echo   回调地址: 查看 logs\tunnel.log
echo ========================================
echo.

:: 保活循环
:loop
timeout /t 60 >nul

:: 检查 node 进程
tasklist /FI "IMAGENAME eq node.exe" | findstr "node.exe" >nul
if errorlevel 1 (
    echo [%time%] [WARN] Node 进程已断，正在重启...
    cd /d D:\im-bridge
    start /b node src/index.js > logs\im-bridge.log 2>&1
    timeout /t 5 >nul
)

:: 检查 cloudflared 进程
tasklist /FI "IMAGENAME eq cloudflared.exe" | findstr "cloudflared.exe" >nul
if errorlevel 1 (
    echo [%time%] [WARN] 隧道已断，正在重连...
    cd /d D:\im-bridge
    start /b cloudflared.exe tunnel --url http://localhost:3000 --protocol http2 > logs\tunnel.log 2>&1
    timeout /t 10 >nul
    echo [%time%] [INFO] 隧道已重连，URL 可能已变化，请检查 logs\tunnel.log
)

:: 检查 HTTP 健康
curl -s -o nul -w "%%{http_code}" http://localhost:3000/ 2>nul | findstr "200" >nul
if errorlevel 1 (
    echo [%time%] [WARN] HTTP 健康检查失败
)

goto loop
