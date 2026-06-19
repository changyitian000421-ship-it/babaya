#!/bin/zsh

cd "$(dirname "$0")"

echo "正在启动声动教培系统..."
echo "关闭此窗口即可停止服务。"

(sleep 1; open "http://127.0.0.1:4173") &
exec python3 server.py
