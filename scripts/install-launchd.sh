#!/usr/bin/env bash
# 把每日签到注册成 macOS 用户级定时任务（LaunchAgent）。
# 不用 sudo，装在自己账号下，登录后生效。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.local.ai-daily-checkin"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_NUM="$(id -u)"

if ! command -v node >/dev/null 2>&1; then
  echo "✗ 找不到 node。先安装 Node.js 18+（brew install node 或用官方 pkg）。"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/config.json" ]; then
  echo "→ 首次安装，生成默认配置..."
  ( cd "$PROJECT_DIR" && node src/index.js list >/dev/null )
fi

# 从 config.json 读时间，格式 HH:MM
read -r HOUR MINUTE <<< "$(cd "$PROJECT_DIR" && node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
  const t = String(cfg?.schedule?.time || "08:00");
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) { console.error("config.json 里 schedule.time 格式应为 HH:MM"); process.exit(1); }
  console.log(Number(m[1]), Number(m[2]));
')"

RETRY_HOUR=$(cd "$PROJECT_DIR" && node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
  const t = String(cfg?.schedule?.retryTime || "12:30");
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  console.log(m ? Number(m[1]) : 12);
')
RETRY_MINUTE=$(cd "$PROJECT_DIR" && node -e '
  const fs = require("fs");
  const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
  const t = String(cfg?.schedule?.retryTime || "12:30");
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  console.log(m ? Number(m[2]) : 30);
')
echo "→ 计划时间：每天 ${HOUR}:$(printf '%02d' "$MINUTE")（另加 0~随机延迟分钟）"
echo "→ 中午补跑：每天 ${RETRY_HOUR}:$(printf '%02d' "$RETRY_MINUTE")（已签会跳过，不会重复）"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$PROJECT_DIR/data/log"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROJECT_DIR}/scripts/run-daily.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>StartCalendarInterval</key>
  <array>
    <dict>
      <key>Hour</key>
      <integer>${HOUR}</integer>
      <key>Minute</key>
      <integer>${MINUTE}</integer>
    </dict>
    <dict>
      <key>Hour</key>
      <integer>${RETRY_HOUR}</integer>
      <key>Minute</key>
      <integer>${RETRY_MINUTE}</integer>
    </dict>
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${PROJECT_DIR}/data/log/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${PROJECT_DIR}/data/log/launchd.err.log</string>
</dict>
</plist>
PLISTEOF

plutil -lint "$PLIST" >/dev/null
echo "✓ plist 语法校验通过: $PLIST"

chmod +x "$PROJECT_DIR/scripts/run-daily.sh"
chmod +x "$PROJECT_DIR/scripts/set-workbuddy-debug.sh"

# 让 WorkBuddy 始终带调试端口启动（登录后由下面的 LaunchAgent 重新设置）
bash "$PROJECT_DIR/scripts/set-workbuddy-debug.sh"
ENV_LABEL="com.local.ai-checkin-workbuddy-env"
ENV_PLIST="$HOME/Library/LaunchAgents/$ENV_LABEL.plist"
cat > "$ENV_PLIST" <<ENVEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${ENV_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROJECT_DIR}/scripts/set-workbuddy-debug.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${PROJECT_DIR}/data/log/launchd.out.log</string>
  <key>StandardErrorPath</key><string>${PROJECT_DIR}/data/log/launchd.err.log</string>
</dict>
</plist>
ENVEOF
plutil -lint "$ENV_PLIST" >/dev/null
launchctl bootout "gui/$UID_NUM/$ENV_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$ENV_PLIST"
echo "✓ 已安装 WorkBuddy 调试端口持久化（${ENV_LABEL}）"

# 先卸载旧任务再装载，避免重复注册
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl enable "gui/$UID_NUM/$LABEL"


# 顺带把可视化控制台装成常驻服务（KeepAlive：崩了自动拉起，登录后自动启动）
NODE_BIN="$(command -v node)"
WEB_LABEL="com.local.ai-checkin-web"
WEB_PLIST="$HOME/Library/LaunchAgents/$WEB_LABEL.plist"
cat > "$WEB_PLIST" <<WEBEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${WEB_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${PROJECT_DIR}/src/index.js</string>
    <string>web</string>
    <string>--port=7788</string>
  </array>
  <key>WorkingDirectory</key><string>${PROJECT_DIR}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${PROJECT_DIR}/data/log/web.out.log</string>
  <key>StandardErrorPath</key><string>${PROJECT_DIR}/data/log/web.err.log</string>
</dict>
</plist>
WEBEOF
plutil -lint "$WEB_PLIST" >/dev/null
launchctl bootout "gui/$UID_NUM/$WEB_LABEL" 2>/dev/null || true
sleep 1
if ! launchctl bootstrap "gui/$UID_NUM" "$WEB_PLIST" 2>/dev/null; then
  sleep 2
  launchctl bootstrap "gui/$UID_NUM" "$WEB_PLIST" 2>/dev/null || launchctl kickstart -k "gui/$UID_NUM/$WEB_LABEL" 2>/dev/null || true
fi
echo "✓ 可视化控制台已设为常驻: http://127.0.0.1:7788 （${WEB_LABEL}）"

echo ""
echo "✓ 已安装定时任务: $LABEL"
echo "  查看状态: launchctl print gui/$UID_NUM/$LABEL | head -20"
echo "  立即测试: bash $PROJECT_DIR/scripts/run-daily.sh"
echo "  卸载:     bash $PROJECT_DIR/scripts/uninstall-launchd.sh"
echo ""
echo "注意：先在项目目录里跑一次 npm run login 完成登录，否则定时任务会提示需要登录。"
