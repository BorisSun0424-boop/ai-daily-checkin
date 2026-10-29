#!/usr/bin/env bash
# launchd 每天调用的入口脚本。
# 职责：固定 PATH、单实例锁、随机抖动、调用 node 主程序、把结果写进 data/log。
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR" || exit 1

# launchd 启动的环境几乎没有 PATH，必须写死（Homebrew 和系统 node 位置都覆盖）
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="zh_CN.UTF-8"
export NODE_ENV="production"
# 若从 Electron 系终端/IDE 里被调起，这两个变量会让 WorkBuddy 客户端以 Node 模式启动并立刻退出
unset ELECTRON_RUN_AS_NODE NODE_OPTIONS

LOG_DIR="$PROJECT_DIR/data/log"
mkdir -p "$LOG_DIR"
STAMP="$(date '+%Y-%m-%d %H:%M:%S')"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "$STAMP [run-daily] 找不到 node，请安装 Node.js 后重试" >> "$LOG_DIR/launchd.log"
  exit 1
fi

# 单实例锁：防止定时和手动同时跑，两个浏览器抢同一个 profile 会直接报错
LOCK_DIR="$PROJECT_DIR/data/.run.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "$STAMP [run-daily] 已有实例在运行，本次跳过" >> "$LOG_DIR/launchd.log"
  exit 0
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# 随机延迟 0~randomDelayMinutes 分钟：每天固定时刻精确打卡是最容易被画像的特征
DELAY_MIN=$("$NODE_BIN" -e '
  try { const c = require(process.argv[1]); console.log(Number(c?.schedule?.randomDelayMinutes ?? 0)); }
  catch { console.log(0); }
' "$PROJECT_DIR/config.json" 2>/dev/null || echo 0)

# 测试时可跳过随机等待：CHECKIN_NO_DELAY=1 bash scripts/run-daily.sh
if [ "${CHECKIN_NO_DELAY:-0}" = "1" ]; then
  DELAY_MIN=0
fi

if [ "${DELAY_MIN:-0}" -gt 0 ] 2>/dev/null; then
  MAX=$(( DELAY_MIN * 60 ))
  WAIT=$(( RANDOM % (MAX + 1) ))
  echo "$STAMP [run-daily] 随机等待 ${WAIT}s 后开始（上限 ${MAX}s）" >> "$LOG_DIR/launchd.log"
  sleep "$WAIT"
fi

echo "$STAMP [run-daily] 开始执行签到 -> $NODE_BIN src/index.js run --skip-if-done" >> "$LOG_DIR/launchd.log"
"$NODE_BIN" src/index.js run --skip-if-done --quiet >> "$LOG_DIR/launchd.log" 2>&1
CODE=$?
echo "$(date '+%Y-%m-%d %H:%M:%S') [run-daily] 结束，退出码 $CODE" >> "$LOG_DIR/launchd.log"
exit $CODE
