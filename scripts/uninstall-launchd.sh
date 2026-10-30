#!/usr/bin/env bash
# 移除所有定时任务与常驻服务（不动数据、登录态）
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UID_NUM="$(id -u)"
cd "$PROJECT_DIR" 2>/dev/null || true

echo "→ 移除每日定时任务"
node src/index.js uninstall-service 2>/dev/null || true

if [ "$(uname -s)" = "Darwin" ]; then
  for LABEL in com.local.ai-checkin-workbuddy-env com.local.ai-checkin-web; do
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    if [ -f "$PLIST" ]; then
      launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
      rm -f "$PLIST"
      echo "  ✓ 已移除 $LABEL"
    fi
  done
  launchctl unsetenv WORKBUDDY_REMOTE_DEBUGGING_PORT 2>/dev/null || true
fi

echo ""
echo "· 登录态（profile/）、日志、报告都保留；需要清空可手动删除 profile/ 与 data/"
