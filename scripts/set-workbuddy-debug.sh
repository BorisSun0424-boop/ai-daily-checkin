#!/usr/bin/env bash
# 让 WorkBuddy 每次启动都带 CDP 调试端口（仅监听 127.0.0.1）。
# 原因：WorkBuddy 只认环境变量 WORKBUDDY_REMOTE_DEBUGGING_PORT，
# 而 GUI 应用的环境变量来自 launchd 用户域，所以用 launchctl setenv 持久化。
set -uo pipefail
PORT="${WORKBUDDY_CDP_PORT:-9333}"
launchctl setenv WORKBUDDY_REMOTE_DEBUGGING_PORT "$PORT"
echo "✓ 已设置 WORKBUDDY_REMOTE_DEBUGGING_PORT=${PORT}（本次登录会话生效，重启后由 LaunchAgent 重新设置）"
