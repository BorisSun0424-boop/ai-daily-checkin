# 早八（zaoba）

> 每天 8:30，替你领额度。

每天定时自动完成 AI 工具的"每日签到 / 领积分"，跑完给你发 macOS 通知 + 一份日报。
Playwright 持久化登录态 + launchd 定时，**装好后不用再管**。

> 目前真正能**每天自动签到**的：**WorkBuddy**、**豆包工作**、**智谱清言**（需登录一次）。
> 另外 **Trae CN / Qoder CN** 已预置适配器，装上客户端即可启用。
> 其余平台：Kimi / 文心 / 千问 / 智谱开放平台**没有签到机制**；腾讯元宝的签到在手机 App，Mac 端做不了。
> 所有结论都有实测证据，见 [RESEARCH.md](./RESEARCH.md)。

| 平台 | 签到内容 | 怎么自动 | 默认 |
| --- | --- | --- | --- |
| **WorkBuddy**（桌面客户端） | 每日 100 Credits | CDP 接管客户端，调内部通道 | **启用** |
| **豆包工作**（桌面客户端） | 每日签到 +200 额度 | CDP 接管 → 打开「免费用豆包」面板 → 点「立即签到」 | **启用** |
| 智谱清言（网页） | 每日登录积分 | 纯接口，签名本地计算 | **启用**（需 `npm run login` 一次） |
| Trae CN（桌面客户端） | 每日 150 积分 | CDP 接管客户端 | 关闭·待装 |
| Qoder CN（桌面客户端） | 每日 100 Credits | CDP 接管客户端 | 关闭·待装 |
| 通义万相（网页） | 接口存活，产品疑并入千问 | 待验证登录态 | 关闭 |
| 腾讯元宝 | 签到在手机 App 福利中心 | Mac 端无客户端可接管 | 关闭 |
| Kimi / 文心 / 千问 / 智谱开放平台 | ❌ 没有签到机制 | — | 关闭 |

## 安装

三种方式，任选一种：

| 方式 | 适合谁 | 怎么做 |
| --- | --- | --- |
| **交给 AI Agent** | 不想碰终端 | 复制 [docs/AGENT-PROMPT.md](./docs/AGENT-PROMPT.md) 里的指令给你的 Agent，它负责装 Node ≥18、依赖、浏览器内核、定时任务 |
| **一键脚本** | 有终端经验 | `bash scripts/bootstrap.sh`（先 `--check` 自检，加 `--with-service` 装定时任务） |
| **手动命令** | 想完全掌控 | 见 [docs/INSTALL.md](./docs/INSTALL.md) |

前置条件：macOS 12+、**Node.js ≥ 18**、约 1.5GB 磁盘（依赖 + 570MB 浏览器内核）、macOS 已登录状态。

## 一分钟上手

```bash
git clone https://github.com/BorisSun0424-boop/zaoba.git
cd zaoba

bash scripts/bootstrap.sh --check    # ① 自检：看缺 Node / 依赖 / 浏览器内核哪一项
bash scripts/bootstrap.sh            # ② 安装（幂等，重复执行没问题）
npm run login                        # ③ 登录智谱清言（WorkBuddy 用客户端扫码即可）
npm run dry-run                      # ④ 演练：只检查不签到
npm run checkin                      # ⑤ 真跑一次
bash scripts/install-launchd.sh      # ⑥ 装定时任务（每天 08:30 + 12:30 补跑）+ 常驻控制台
npm run web                          # ⑦ 打开控制台 → http://127.0.0.1:7788
```

详细的权限、电源（睡眠/锁屏）、客户端要求、常见问题见 **[docs/INSTALL.md](./docs/INSTALL.md)**。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run login` | 打开真实浏览器窗口，登录一次，登录态存进 `profile/` |
| `npm run dry-run` | 演练：只检查不执行。网页类查登录态+找按钮，客户端类只读签到状态，都不会真正签到 |
| `npm run checkin` | 正式签到（自动跳过今天已完成的平台） |
| `npm run checkin -- --only=zhipu --headed` | 只跑一个平台并显示浏览器窗口（排障用） |
| `npm run probe` | 解剖页面：列出所有可见按钮文案，用于校准关键词 |
| `npm run list` | 平台列表、启用状态、定时设置 |
| `npm run web` | 打开本地可视化控制台（默认 http://127.0.0.1:7788） |
| `npm run clients` | 扫描本机所有可接管的客户端（Electron/Chromium 壳） |
| `npm run clients -- --probe=豆包` | 实测某个客户端能不能被 CDP 接管 |
| `npm run enable -- trae-cn` | 一键启用/停用某个平台（`disable` 反向） |
| `npm run report` | 今天的日报（`-- --date=2026-10-22` 看历史） |

---

## 可视化控制台

命令行能跑，但状态不直观。所以带了一个本地 Web 控制台：

```bash
npm run web        # → http://127.0.0.1:7788
```

![控制台首页](docs/screenshot-dashboard.png)

**能干什么**

| 区域 | 说明 |
| --- | --- |
| 概览卡 | 今日完成 x/y、连续签到天数、累计 Credits、下次自动运行时间 |
| 平台卡片 | 状态胶囊、最近一次结果、连续天数/credits/耗时、近 14 天色块、启用开关、单平台「签到 / 演练」 |
| 运行日志 | 点按钮后**实时**看到脚本输出（SSE 流式推送，不是轮询） |
| 可接管客户端 | 扫本机所有 Electron/Chromium 客户端，标出「已配置」「运行中」 |
| 日报 | 右上角「日报」按钮，把 Markdown 报告渲染成表格弹窗 |

![日报](docs/screenshot-report.png)

**实现方式（刻意保持轻量）**

- 后端 `src/server.js`：**零依赖**，只用 Node 内置 `http`，JSON API + SSE
- 前端 `web/`：原生 HTML/CSS/JS，**没有构建步骤**（不用 npm build、不用等打包）
- 只监听 `127.0.0.1`，不对外网暴露；写操作只有「触发签到」和「切换启用」

**接口一览**（想二次开发可以直接用）

```
GET  /api/state          平台状态 + 近 14 天矩阵 + 汇总
POST /api/run            {only?: string[], dryRun?: boolean}  触发签到
POST /api/toggle         {id, enabled}                        启用/停用平台
GET  /api/events         SSE 实时日志
GET  /api/report?date=   某天日报 markdown
GET  /api/clients        扫描可接管客户端（60s 缓存）
```

## 本地客户端能帮我签到吗？

**能，但有两个前提，缺一不可：**

| 前提 | 说明 |
| --- | --- |
| ① 客户端是 Chromium 系 | Electron 或 CEF/Chromium 壳 → 能开 CDP 调试端口被脚本接管 |
| ② 客户端里真有签到入口 | 有的客户端压根没这功能（比如豆包，签到是活动弹窗、不是固定入口） |

不满足就没法做：**原生 AppKit 客户端**（只能 AppleScript 点 UI，需要辅助功能权限，极脆）和**手机 App**（Mac 上没有进程可接）。

先扫一遍你机器上有什么：

```bash
npm run clients                     # 列出所有可接管的客户端（含版本、bundle id、是否在跑）
npm run clients -- --probe=豆包      # 实测某个能不能接管，会打印它加载了哪些页面
```

本机实测（2026-10-27）：

| 客户端 | 可接管 | 有签到 | 结论 |
| --- | --- | --- | --- |
| WorkBuddy 5.9.2 | ✅ | ✅ 每日 100 Credits | 已接入 |
| 豆包 2.24.10 / 豆包工作 2.33.7 | ✅ CDP 通 | ❌ 未发现稳定入口 | 能接管但没得签 |
| Trae CN / Qoder CN | 待装 | ✅ 150 / 100 每日 | 装完一条命令启用 |

### 接入一个已装好的客户端（以 Trae 为例）

```bash
# 1. 装好客户端并登录，然后确认能被接管（会短暂起一个实例再退出）
npm run clients -- --probe=Trae

# 2. 启用（config.json 里已预置 trae-cn / qoder-cn）
npm run enable -- trae-cn

# 3. 演练一次，看它能不能找到签到按钮
npm run dry-run -- --only=trae-cn --headed

# 4. 真跑
npm run checkin -- --only=trae-cn
```

如果 `not_found`，说明签到入口的选择器/文案变了，改 `config.json` 里对应平台的
`clickSelectors`（CSS 选择器，适合纯图标按钮）或 `keywords`（文案匹配）即可，不用改代码。

## WorkBuddy 是怎么自动签到的

签到不在网页，在腾讯这个 Electron 客户端内部。脚本做的事是：**接管客户端自己的会话**，而不是去解它的 token（token 落盘是加密的，解不了也没必要解）。

```
node src/index.js run --only=workbuddy
  ├─ 客户端没跑？用 WORKBUDDY_REMOTE_DEBUGGING_PORT 拉起它
  ├─ connectOverCDP 连上 renderer 主窗口
  ├─ invoke('auth:getCheckinStatus')   已签就直接返回 already，不重复请求
  ├─ invoke('auth:claimDailyCheckin')  调它自己的签到通道
  ├─ 回读状态确认，报告 连续天数 / 今日奖励 / 累计 credits
  └─ 只断开 CDP；若是脚本拉起的客户端，签完自动退出（不会留个窗口给你）
```

实测三种情况都能正确处理：

| 情况 | 行为 |
| --- | --- |
| 客户端开着、调试端口开着 | 直接接管，不动你的窗口 |
| 客户端没开 | 自动拉起 → 签到 → 退出 |
| 客户端开着但没开调试端口 | 返回 `needs_manual` 并给出命令，**不会强杀你正在用的窗口** |

**为什么需要常驻调试端口**：如果你早上 8:30 时 WorkBuddy 本来就开着，而它是普通方式启动的（没带调试端口），
脚本就接管不了，只能返回 `needs_manual`。所以 `install-launchd.sh` 会做两件事：

1. `launchctl setenv WORKBUDDY_REMOTE_DEBUGGING_PORT=9333` —— 让**任何方式启动**的 WorkBuddy 都带调试端口（仅监听 127.0.0.1）
2. 装一个 LaunchAgent（`com.local.ai-checkin-workbuddy-env`），每次登录重新设置这个变量

这样你平时正常用客户端，到点脚本直接接管，不会打扰你，也不会关你的窗口。

可调参数（`config.json`）：

```jsonc
"workbuddy": {
  "enabled": true,
  "cdpPort": 9333,          // 调试端口，被占用就换一个
  "quitAfterLaunch": true   // 脚本拉起的客户端，签完是否自动退出
}
```

> ⚠️ 两个踩过的坑，写在这里免得你再踩：
> 1. 启动客户端只能用环境变量 `WORKBUDDY_REMOTE_DEBUGGING_PORT`，命令行传 `--remote-debugging-port` 会被拒绝（报 `bad option`）。
> 2. 如果你的终端里有 `ELECTRON_RUN_AS_NODE=1`（在 Electron 系 IDE/终端里很常见），客户端会以纯 Node 模式启动、**1 秒后静默退出**，看起来像闪退。脚本已经自动剥掉这个变量，但你自己手动调试时要注意。

## 它是怎么工作的

```
launchd（每天 08:30）
  └─ scripts/run-daily.sh          固定 PATH、单实例锁、0~25 分钟随机延迟
       └─ node src/index.js run --skip-if-done
            ├─ 读 config.json，取启用的平台
            ├─ 启动持久化 profile 的 Chromium（复用登录态）
            ├─ 逐平台串行（间隔 3~9 秒随机）
            │    ├─ 打开入口页 → 关掉挡路的弹窗 → 判断是否被踢回登录
            │    ├─ 判断"今日已完成"（幂等）
            │    ├─ 有 API 适配器的直接调接口；否则找关键词按钮真实点击
            │    └─ 截图 + 失败时存 HTML 快照
            ├─ 写 data/results.jsonl 和 data/reports/YYYY-MM-DD.md
            └─ 弹 macOS 通知（可选 webhook 推飞书/钉钉）
```

三个关键设计，都是被真实情况逼出来的：

1. **串行 + 随机间隔**：同一 IP 同时打多个站是最容易吃风控的行为。
2. **持久化 profile**：签到失败 90% 是登录态过期而不是点击逻辑。profile 复用 + 显式识别登录墙，
   把"静默失败"变成"一眼看出要重新登录"。
3. **幂等**：`daily_login_score` 接口重复调只返回"已领取"；`data/results.jsonl` 里当天已成功的平台
   下次直接跳过（`--skip-if-done`），不重复打站点。

---

## 加新平台（不用改代码）

在 `config.json` 里加一条即可，走通用流程：打开页面 → 找关键词按钮 → 点击 → 判断结果。

```jsonc
"platforms": {
  "trae": {
    "enabled": true,
    "name": "Trae",
    "url": "https://www.trae.com.cn/",
    "keywords": ["签到", "每日签到", "领取", "领积分"],
    "doneKeywords": ["今日已签到", "已领取", "明天再来"]
  },
  "qoder": {
    "enabled": true,
    "name": "QoderWork",
    "url": "https://qoder.com/",
    "keywords": ["签到", "领取积分"]
  }
}
```

> 顺带说：调研里发现**每日真发额度的战场是 QoderWork（100 Credits/日）和 Trae 国内版（150 积分/日）**，
> 不在这六家里。真想白嫖额度，加这两个比抠 Kimi/文心 有效得多。

加完先验证：

```bash
npm run probe -- --only=trae --headed     # 看它到底能点到什么
npm run dry-run -- --only=trae --headed   # 演练，不点击
npm run checkin -- --only=trae --headed   # 只跑这一个，确认结果
```

`data/probe/<日期>/probe.json` 里列出了页面上所有可见按钮文案，照着把真实文案填进 `keywords` 就行。

---

## 配置说明（config.json）

首次运行自动生成。重点字段：

```jsonc
{
  "headless": true,           // 定时跑用 true；排障时 false 或加 --headed
  "channel": null,            // 改 "chrome" 用本机真实 Chrome，指纹更干净（需已安装）
  "userDataDir": "./profile", // 登录态目录，等价于账号凭据，别提交/分享
  "platformTimeout": 120000,  // 单平台超时（毫秒）
  "schedule": {
    "time": "08:30",
    "randomDelayMinutes": 25  // 0 表示不随机延迟
  },
  "notify": { "macos": true, "webhookUrl": "" },
  "platforms": { "zhipu": { "enabled": true, "keywords": [], "doneKeywords": [] } }
}
```

改 `schedule.time` 之后要重跑一次 `bash scripts/install-launchd.sh` 让 launchd 重新读取。

---

## 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `needs_login` | 登录态过期（智谱 token 24h，但页面会自动续期；通常几十天一次） | `npm run login` 重登 |
| `needs_manual` | WorkBuddy 开着但没开调试端口 | 正常已由持久化 env 解决；若仍出现，检查 `launchctl getenv WORKBUDDY_REMOTE_DEBUGGING_PORT` 是否有值，没有就重跑 `bash scripts/install-launchd.sh` |
| `not_installed` | 客户端没装 / 路径不对 | 装好并登录，或改 `config.json` 里的 `app` 路径 |
| `offline` 📴 | 断网，脚本主动跳过（不再逐个超时） | 联网后手动补：`npm run checkin` |
| `timeout` ⏱️ | 客户端冷启动慢（早上刚唤醒的机器常见） | 已放宽到 240s；仍不行就调大 `config.json` 的 `platformTimeout` |
| `not_found` | 找不到按钮（自定义平台常见） | 看截图 + `npm run probe` 校准 `keywords` |
| `timeout` | 站点慢 | 调大 `platformTimeout` |
| `uncertain` | 点了但页面无明确提示 | 看截图确认，成功的话把提示文案加进 `doneKeywords` |
| 定时任务没跑 | 电脑在设定时间休眠 | macOS 唤醒后会补跑；先手动 `CHECKIN_NO_DELAY=1 bash scripts/run-daily.sh` 验证 |
| `Profile 被占用` | 有残留进程或两实例争抢 | 脚本用 `data/.run.lock` 防并发；残留时 `pkill -f "zaoba/profile"` |

### 运行记录（本机真实跑出来的）

| 日期 | 结果 | 说明 |
| --- | --- | --- |
| 10-24 | 🔧 needs_manual | 客户端开着但没调试端口 → 已用持久化 env 修复 |
| 10-25 | ✅ success | 自动签到成功 +100 credits |
| 10-26 | ❌ | 机器断网 → 已加离线预检，不会再白等超时 |
| 10-27 | ⏱️ timeout | 冷启动超时 → 已放宽到 240s |

这几条都是真实数据，不是设计推演 —— 每天的报告在 `data/reports/` 里可查。

日志与产物：

```
data/log/launchd.log           定时任务流水
data/log/YYYY-MM-DD.log        主程序日志
data/results.jsonl             结构化结果
data/reports/YYYY-MM-DD.md     日报
data/shots/<日期>/<平台>.png    截图现场（失败时会同时存 .html）
```

通知不弹：去「系统设置 → 通知」允许 `osascript`。

---

## 卸载

```bash
bash scripts/uninstall-launchd.sh   # 只移除定时任务，保留登录态和日志
```

---

## 已知限制（务必知道）

1. **这不是破解，是"替你点按钮/发请求"**。验证码、滑块、扫码登录仍需你本人完成。
2. **客户端类要靠"接管"**：WorkBuddy 已通过 CDP 接管解决；但豆包/元宝的签到在手机 App 里，Mac 上无对应客户端可接管，脚本无能为力——这是产品形态决定的。
3. **平台改版会让关键词失效**。所以做了 `probe` 和可配置关键词，把修复成本压到 1 分钟。
4. **账号风险自负**。多数平台用户协议禁止自动化，理论上有风控/封号可能。请每天一次、只在自己设备上跑、别批量多账号。
5. **`profile/` 里是你的登录凭据**，`.gitignore` 已排除，别手动分享。
6. **智谱 token 24h 过期**依赖前端自动续期（页面加载时触发）。如果某天续期失败，报告会显示 `needs_login`，
   重登一次即可，refresh_token 有效期约 50 天。
