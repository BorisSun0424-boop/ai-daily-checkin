#!/usr/bin/env bash
# 卸载定时任务（不动你的登录态和日志）
set -euo pipefail

LABEL="com.local.ai-daily-checkin"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

if [ -f "$PLIST" ]; then
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ 已卸载定时任务 $LABEL 并删除 plist"
else
  echo "· 没有找到已安装的 plist，无需卸载"
fi

# 顺手撤掉 WorkBuddy 的调试端口环境变量和它的 LaunchAgent
ENV_LABEL="com.local.ai-checkin-workbuddy-env"
ENV_PLIST="$HOME/Library/LaunchAgents/$ENV_LABEL.plist"
if [ -f "$ENV_PLIST" ]; then
  launchctl bootout "gui/$UID_NUM/$ENV_LABEL" 2>/dev/null || true
  rm -f "$ENV_PLIST"
fi
launchctl unsetenv WORKBUDDY_REMOTE_DEBUGGING_PORT 2>/dev/null || true
echo "· 已撤销 WorkBuddy 调试端口设置"

# 停掉常驻控制台
WEB_LABEL="com.local.ai-checkin-web"
WEB_PLIST="$HOME/Library/LaunchAgents/$WEB_LABEL.plist"
if [ -f "$WEB_PLIST" ]; then
  launchctl bootout "gui/$UID_NUM/$WEB_LABEL" 2>/dev/null || true
  rm -f "$WEB_PLIST"
  echo "· 已停止可视化控制台"
fi

echo "· 登录态 profile、日志和报告都保留在项目目录里，需要清空可手动删除 profile/ 和 data/"
