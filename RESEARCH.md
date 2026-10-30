# 调研结论（2026-10）

这份文档记录"每个平台到底有没有每日签到"的实测依据。所有结论都基于实时探测（HTTP 状态码）和源码级检索（JS bundle 全量 grep），没有一项是猜的；查不到的部分标注为 unknown。

结论直接决定了 `config.json` 里哪些平台默认开启。

## 一句话总结

| 平台 | 有签到？ | 在哪 | 能自动吗 | 默认状态 |
| --- | --- | --- | --- | --- |
| 智谱清言 chatglm.cn | ✅ 有 | 网页（自动调用，无按钮） | ✅ **纯接口，签名可本地算** | **启用** |
| 通义万相 | ✅ 接口存活 | 网页 | ⚠️ 需验证登录态 | 关闭 |
| 千问（原通义千问） | ❌ 无（仅学生/教师活动） | — | ❌ 要支付宝实名 + 校园网 IP | 关闭 |
| Kimi | ❌ 无 | — | — | 关闭 |
| 智谱开放平台 bigmodel.cn | ❌ 无（积分靠充值/消耗获得） | — | — | 关闭 |
| 阿里云百炼 | ❌ 无（只有新人额度） | — | — | 关闭 |
| 豆包 | ✅ 有 | **电脑客户端**签到领额度 | ⚠️ 网页端无入口，指纹校验严格 | 关闭 |
| 腾讯元宝 | ✅ 有 | **App 福利中心** | ⚠️ 网页端未验证到入口 | 关闭 |
| 文心 | ❌ 无 | — | — | 关闭 |

**所以这个工具当前真正每天在干活的是：智谱清言的每日登录积分。**

---

## 1. 智谱清言 chatglm.cn —— 唯一可直接上生产

- 签到不是按钮，是**页面加载时前端自动调用**的接口，所以不需要 DOM 操作，也不怕改版
- `POST https://chatglm.cn/chatglm/member-api/member/daily_login_score`，body `{}`
  - `status=10001` → 今日已领（**幂等，可以盲调**）
- 签名可本地计算，不需要抓包：
  ```
  X-Sign = md5(`${timestamp}-${nonce}-8a1317a7468aa3ad86e997d08f3f31cb`)
  ```
  另需 `App-Name: chatglm`、`X-App-Platform: pc`、`X-App-Version: 2.0.7`、
  `X-Device-Id`（必须与 token 内 device_id 一致）、`X-Timestamp`、`X-Nonce`
- 设备 ID 位置：`localStorage['chatglm-deid']`
- 登录态：cookie `chatglm_token`（约 24h）+ `chatglm_refresh_token`（约 50 天）；
  **页面加载时前端会自动调 `/chatglm/user-api/user/refresh` 续期** → 每次先开首页就自动续期，不用自己实现
- 相关接口：余额 `GET /chatglm/member-api/member/member_info`（`left_score` 是 1/100 精度）、
  任务中心 `GET /chatglm/agent-api/task/center`、活动 `/member-api/member/score_activity_draw`
- 风险：无滑块验证码，但**高频请求会 403**
- 实测未登录响应：`400 {"status":40003,"message":"bad request(40003)"}`
- 参考实现：https://github.com/L0NE-6/ChatGLM-Daily 、https://github.com/apmengzi/zhipu-switch

## 2. 通义万相 —— 接口活着，产品状态存疑

- `POST https://wanxiang.aliyun.com/wanx/api/common/inspiration/dailySignReward`
  - headers: `content-type: application/json`、`x-platform: web`、`x-xsrf-token: <token>`
- 实测（未登录）：`200 {"errorCode":"4002","errorMsg":"登录凭证过期","success":false}` → **接口确实存在**
- 但万相已并入千问 App，老脚本（kscript/sign）停在 2025-01，故默认关闭

## 3. 千问（原通义千问）—— 面向全体用户的签到不存在

- 现品牌是 `www.qianwen.com`，`tongyi.aliyun.com` 已变成"通义实验室"官网
- 唯一"签到"是**学生/教师认证免费领 1 个月会员**活动（2026-10-09 ~ 11-30）：
  - `POST https://coral3.qianwen.com/qwen/pcspecial/query`（免登录可查，实测 200）
  - `POST .../qwen/pcspecial/signIn`（缺 `sign` 返回 `INVALID_PARAM`；sign 是阿里 umid 设备签名）
  - 需支付宝学生/教师实名认证 + 校园网/VPN IP（`CHANNEL_NOT_MATCH` / `IP_NOT_MATCH`）
- 积分查询：`POST https://member.qianwen.com/api/web/credit/{info,total,detail}`
- **真需求可能指错产品**：如果你要的是"白嫖 AI 额度"，真正每日发积分的是
  **QoderWork（每日 100 Credits）** 和 **Trae 国内版（每日 150 积分）**，不是千问/Kimi。

## 4. Kimi —— 没有签到

- 官网 131 个 JS chunk（约 8MB）全量检索：`签到` 0 次、`福利` 0 次
  （`checkin` 的命中全是 `rechecking` 误匹配）
- 10 个候选路径全部 404：`/api/checkin`、`/api/user/check_in`、`/api/daily_checkin`、
  `/api/user/points`、`/api/credit` …
- 真实基座：`GET /api/user`（未登录 → `401 auth.token.empty`）
- 登录态：`localStorage.access_token` + `Authorization: Bearer <token>`
- Kimi 有的是**会员月度额度**（按月刷新），不是每日签到
- 网上"Kimi 签到补额度"是 SEO 软文

## 5. 智谱开放平台 bigmodel.cn —— 没有可领的签到积分

- 官方《用户权益》：积分只来自"消耗现金余额 / 购买资源包 / 1:1 兑换"，T+1 06:00 更新，
  用于 V0–V3 并发等级
- 实测 `/api/v1/checkin`、`/api/user/signin`、`/api/v1/user/points` 全部 `404 NOT_FOUND`

## 6. 豆包 —— 有，但在电脑客户端

- 2026-10 起**豆包电脑客户端**上线"签到领额度"（侧边栏/启动弹窗活动）
- 网页端 chat bundle 里`签到`文案 0 处；只有一个 `s2-agent-explore-checkin-bubble` 组件名，
  未证实等于每日签到
- 风控：强校验设备指纹 `web_id`、`tea_uuid`、`fp=verify_<device_id>`、`aid=582478`，
  缺项直接 `712010702`；UA 需带 `SamanthaDoubao/2.27.12`；桌面端 cookie 还有一层
  DPAPI/AES-GCM 客户端加密，无法离线解密
- 参考：https://github.com/smart-open/TraeWorkAssistant 、
  https://github.com/chengwei-fly/doubao-manager（把豆包标为 `checkinType='visit'`）
- 结论：真实浏览器 + 手动登录后，网页端仍大概率找不到签到按钮

## 7. 腾讯元宝 —— 有，但在 App

- 真实用户佐证（2026-06）：App「福利中心」每日签到固定得 5000~10000 积分，可兑
  QQ音乐/酷狗/腾讯视频/QQ会员/王者皮肤
- 网页端是单路由 SPA（`_buildManifest` 只有 `/`），任意路径都 200，URL 探测无效
- 网页 bundle 无 `checkin`/`sign_in`/`签到` 字样；能抓到的是积分体系接口：
  `/api/vision/midas/proxy/exchange_points_detail`、`/api/vision/midas/list_activity_config`、
  `/api/vision/drawlots`、`/api/vision/midas/proxy/task_box_standard_model/QueryUserModelInfo`
- 腾讯 midas 风控：活动接口普遍带签名 + scene 参数
- 要拿下需要真机抓包定位 App 内的签到请求

## 8. 文心（百度）—— 网页端没有

- `yiyan.baidu.com` 已 302 → `wenxin.baidu.com`（2026-07-26 迁移）
- 主 bundle（`chat-search/static/pc/search-*.js`，229KB）里
  `签到`/`积分`/`算力`/`额度`/`checkin`/`sign_in` 计数全部为 0
- 网上"文心签到领充电值"只出现在 php.cn 内容农场稿，无可交叉验证，判定不可信
- 注意：GitHub 上叫 sign 的"文心签到脚本"多数其实是**文心一格**（yige.baidu.com）绘图

---

## 复现方式

想自己复核任意一条：

```bash
npm run probe -- --only=zhipu        # 打开页面、关弹窗、列出所有可见按钮文案
cat data/probe/$(date +%F)/probe.json
npm run dry-run -- --only=zhipu --headed   # 亲眼看着它打开页面
```

接口类结论可以直接 `curl` 验证，例如：

```bash
curl -s -X POST https://chatglm.cn/chatglm/member-api/member/daily_login_score \
  -H 'Content-Type: application/json' -H 'App-Name: chatglm' \
  -H 'X-App-Platform: pc' -H 'X-App-Version: 2.0.7' -d '{}'
# 未登录时返回 {"status":40003,...} —— 说明端点存在，只是缺登录态
```

## 如果你要覆盖更多平台

调研里最有价值的一条：**每日送额度的真正战场是 QoderWork（100 Credits/日）和 Trae 国内版（150 积分/日）**，
它们不在最初列的六家里。加它们不需要改代码，在 `config.json` 里按 README"加新平台"一节加一个条目即可。

---

## 9. 腾讯 WorkBuddy（桌面客户端）—— 有签到，且能全自动（2026-10 实测打通）

你提的 WorkBuddy 是腾讯的 Electron 客户端（`/Applications/WorkBuddy.app`，5.8.3，Electron 37.10.3）。
签到**不在网页里**，在客户端内部。

### 定位过程

| 步骤 | 发现 |
| --- | --- |
| 1. 搜 `app.asar` 中文 | `签到`/`积分` 0 处，`打卡`/`额度` 全是飞书 SDK 文档噪声 |
| 2. 补搜 `app.asar.unpacked` | `签到` 13 文件，但绝大多数是 smartcanvas 文档模板 |
| 3. 定位 `resources/extensions/edge-sync/server/index.cjs` | 注释里直接写了"获取每日签到状态 / 执行每日签到" |
| 4. 读出接口 | `POST /billing/meter/checkin-status`、`POST /billing/meter/daily-checkin` |
| 5. 读运行日志 `~/.workbuddy/logs/main.log` | IPC 通道 `auth:getCheckinStatus`、`auth:claimDailyCheckin`；后端域名 `www.workbuddy.cn` / `tencent.sso.codebuddy.cn` |

### 状态接口真实返回（本人账号）

```json
{"active":true,"today_checked_in":false,"streak_days":16,"is_streak_day":false,
 "today_credit":100,"total_credits":1700,"week_checkin_days":3,
 "theme_name":"Buddy加油站","season":10,"end_time":"2026-11-30 23:59:59"}
```

每日签到奖励 **100 Credits**，每周还有连续签到加成。

### Claim 接口返回（幂等）

```json
{"code":10001,"msg":"今天已签到，请明天再来","requestId":"94f3a841..."}
```

即 `code=0` 成功、`code=10001` 今日已签，可以盲调，不会重复发。

### 为什么不能"解 token 直接调 HTTP"

- 鉴权在 Electron 主进程里完成，token 落盘是加密的（`auth.accessToken.$wbEncrypted` + envelope）
- 所以正确做法是**让客户端自己发请求**：用 CDP 接管渲染进程，调它自己的 `window.wb.invoke(channel)`

### 两个必须知道的坑（都实际踩过）

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| 命令行传 `--remote-debugging-port=9222` | 报 `bad option`，客户端不启动 | 客户端只认环境变量 `WORKBUDDY_REMOTE_DEBUGGING_PORT=<port>` |
| 环境里有 `ELECTRON_RUN_AS_NODE=1` | 客户端 1 秒后 `exit(0)`（launchd 日志 `terminated (0,0,0)`），看起来像"闪退" | 启动前必须 `unset ELECTRON_RUN_AS_NODE NODE_OPTIONS` |

第二条是最隐蔽的：在 Electron 系终端/IDE 里跑脚本时很容易中招，会误以为是客户端坏了。

### 自动化路径（已实现）

```
node src/index.js run --only=workbuddy
  ├─ CDP 端口没开？用 env WORKBUDDY_REMOTE_DEBUGGING_PORT 拉起客户端（剥掉 ELECTRON_RUN_AS_NODE）
  ├─ connectOverCDP → 找到 renderer/index.html 主窗口
  ├─ waitForFunction(window.wb.invoke)
  ├─ invoke('auth:getCheckinStatus')  → 已签则直接返回 already（幂等保护）
  ├─ invoke('auth:claimDailyCheckin') → 判 code
  ├─ 回读状态确认（不轻信返回值）
  └─ 只断开 CDP；如果是我们拉起的客户端，签完自动退出
```

实测三条路径都通：① 客户端已在跑（调试端口开着）→ 直接接管；② 客户端没跑 → 自动拉起 → 签完退出；③ 客户端在跑但没开调试端口 → 返回 `needs_manual` 并给出具体命令，不强行杀用户正在用的窗口。

---

## 10. 桌面客户端通用性：哪些"本地软件"能帮签到

用户问：网页端签不了的，本地客户端能签吗？
**答案取决于两个条件，缺一不可**：

| 条件 | 说明 | 怎么判断 |
| --- | --- | --- |
| ① 客户端是 Chromium 系 | Electron 或 CEF/Chromium 壳 → 能开 CDP 调试端口被脚本接管 | `npm run clients` 扫描 + `--probe=名字` 实测 |
| ② 客户端里真有签到入口 | 有的客户端压根没这功能，或只做纯聊天 | 抓包/翻 bundle/看 UI |

两类都不满足就没法做：原生 AppKit 客户端（只能 AppleScript 点 UI，要辅助功能权限，极脆）、手机 App（Mac 上没有进程）。

### 本机实测结果（2026-10-27）

| 客户端 | 技术栈 | 可接管 | 有签到 | 结论 |
| --- | --- | --- | --- | --- |
| WorkBuddy 5.9.2 | Electron | ✅ | ✅ 每日 100 Credits | **已接入，每天自动签** |
| 豆包 2.24.10 | Chromium 壳（`com.bot.neotix.doubao`） | ✅ CDP 通 | ❌ 未发现 | 可接管但没得签 |
| 豆包工作 2.33.7 | Chromium 壳（`com.work.pc.doubao`） | ✅ CDP 通 | ❌ 未发现 | 同上 |
| Trae CN | Electron + VS Code fork | 待装 | ✅ 150/日 | 需装客户端 |
| Qoder CN | Electron | 待装 | ✅ 100/日 | 需装客户端 |
| 元宝 / Kimi / 智谱 | 无 Mac 客户端或未装 | — | — | 无法 |

#### 豆包为什么没签成

- CDP 完全可用：`--remote-debugging-port=9445` 直接起，能拿到 `doubao://doubao-chat/chat` 页面
- 但客户端本地资源里没有签到逻辑：
  - `app.asar.unpacked`（豆包是 CEF，没有 asar，实际是 `local_webcontents`）里 `签到` 只命中 office 的 `doc_app_mvp_button_editor_meeting_option_checkin:"会议签到"` —— 文档功能，不是每日签到
  - `checkin` 命中全是表情关键词（`hotel.keywords: ["…","checkin"]`）和版本检查（`Checking`）
- 抓包看到的是活动投放体系：`POST /biz/activity/get_pop_window`、`/get_push_banner`、`s2-pc-activity-pop-window` —— 弹窗由服务端按活动投放，不是每天必现的固定签到入口
- 结论：**签到是运营活动，不是稳定功能**。脚本可以接管客户端，但没有稳定目标可点，故默认关闭

#### 关键坑：`open` 会把调用者的环境变量带进 GUI 应用

`Electron` 客户端在 `ELECTRON_RUN_AS_NODE=1` 的环境下会以纯 Node 模式启动、`exit(0)` 秒退。
而 macOS 的 `open -a` 会把**调用它的 shell 的环境变量**传给被启动的应用 —— 所以在 Electron 系终端里
`open -a WorkBuddy` 会"闪退"，看起来像应用坏了。脚本里统一用 `env -u ELECTRON_RUN_AS_NODE` 规避。

---

## 11. Trae CN / Qoder CN（调研结论，客户端未安装，未实测）

两者的签到**都只在桌面客户端**，网页控制台只有用量，没有签到页。所以路线必须走客户端接管。

### Trae CN（字节，优先）

- 仅国内版 `trae.cn` 有签到；国际版 `trae.ai` 明确没有（插件代码里 `trae-global` 的 checkin 直接返回 "no daily check-in"）
- 每天 150 Credits（官方论坛 2026-10；会员 200），手动领，31 天有效
- 入口：客户端左下角头像 →「签到」
- 客户端：Electron + VS Code fork，**支持 `--remote-debugging-port`**，DOM 类名前缀 `accountCheckinButton`
- 直接打 API 的坑（所以推荐 CDP 点真客户端）：
  - `POST https://api.trae.cn/trae/api/v2/ug/checkin_credits/status` / `.../claim`
  - Header 要 `Authorization: Cloud-IDE-JWT <jwt>` + `x-device-id`（必须是该客户端注册过的设备号）
  - Body 必须 `{"req_source":1}`，空 `{}` 会被拒
  - 错误码：`9074` = 设备号不被接受（**用网页 Cookie 换的 JWT 去 claim 必现**）；`9095` = 该设备今天已给别的账号签过
  - claim 成功只返回 `{"code":0}`，必须回查 status 确认

### Qoder CN（阿里）

- 每天 100 Credits，手动领，窗口 10:00 → 次日 10:00（错过不补），30 天有效
- 入口：左下角「用量面板 → 礼物图标」（图标无文字，所以配置里用 CSS 选择器而不是文案匹配）
- 旧接口 `/sash/api/v1/me/daily-check-in/*` 已于 2026-09-29 置为 `DISABLED`
- 现走活动平台：`GET /sash/api/v1/me/campaigns` → `POST .../campaigns/{campaignKey}/claim`（幂等，已领返回 `{status:"CLAIMED",replayed:true}`）
- Header 需要 `bearer dt-...` + UA（`QoderWork` 国内）+ `cosy-clienttype/version/machineid...` 六件套；
  **缺机器头会返回 200 但活动列表静默为空**，这是"领不到"的头号原因
- 国际版必须带官方 umid 生成的机器头；国内版旧签到不受设备风控

> 两者都已在 `config.json` 里预置为 `trae-cn` / `qoder-cn`（默认关闭）。
> 装好客户端并登录后：`npm run clients -- --probe=Trae` → `npm run enable -- trae-cn`。

---

## 12. 豆包工作（DoubaoWork）—— 每日签到 +200 额度（2026-10-30 打通）

之前误判为"网页端没有入口"，实际入口在客户端的一个**内置侧边浏览器面板**里，不在主界面。

### 定位过程

| 步骤 | 发现 |
| --- | --- |
| 1 | 客户端是 Chromium 壳，`--remote-debugging-port=9444` 可用，主页面 `doubaowork://doubaowork-chat/chat` |
| 2 | 主界面和设置菜单里都没有"积分/签到"字样 |
| 3 | 左下角账号菜单里有个「**免费用豆包**」入口 |
| 4 | 点开后是应用内嵌的侧边浏览器面板，URL：`https://www.doubao.com/pc/agent-explore` |
| 5 | 面板第一项就是「**每日签到 +200 额度**」+「立即签到」按钮 |

### 页面内容（实测）

```
每日签到            +200 额度     [立即签到]
选择工作领域领取奖励   +100 额度     [去完成] （至少选一个领域，完成后手动领取）
零散资料整理成一份文档 +100 额度     [去完成]
按需求快速生成实用表格 +100 额度     [去完成]
豆包帮你整理电脑资料   +100 额度     [去完成]
调用技能完成一项办公任务 +100 额度   [去完成]
```

注意：只有「每日签到 +200」是**一键领取**的，其余是任务制（"去完成"要真的做任务，脚本不碰）。

### 相关接口（状态查询用）

- `POST https://www.doubao.com/biz/get_campaign/v3/status/`
- `POST https://www.doubao.com/alice/ug/campaign/v3/detail/`
- （更早发现的通用领取接口：`/alice/ug/campaign/list/`、`/alice/ug/campaign/item/reward/claim/`，参数含 `campaign_group_code` / `campaign_item_code` / `task_id`）

### 实现方式

用通用客户端适配器（`clientApp`）+ 配置：

```jsonc
"doubaowork-client": {
  "enabled": true,
  "type": "client",
  "app": "/Applications/DoubaoWork.app",
  "port": 9444,
  "openUrl": "https://www.doubao.com/pc/agent-explore",   // 直接在自己的会话里打开任务面板
  "keywords": ["立即签到"],
  "doneKeywords": ["已领取", "今日已签到", "明天再来"],
  "autoRestart": true                                     // 客户端开着但没调试端口时自动重启一次
}
```

### 两个坑（都已处理）

1. **全局单实例锁**：客户端在跑时，带 `--remote-debugging-port` 再启动会直接退出。所以必须先让它退出。
2. **它不会立刻退出**：`osascript quit` 可能触发"确认退出"对话框，20 秒内退不掉。适配器改成三级升级：
   `osascript quit` → `SIGTERM` → `SIGKILL`，然后才用调试端口重启。
   如果客户端原本就在运行，签完**保持运行**，不打断你使用。

### 实测结果

- 已手动确认：点击「立即签到」后按钮消失、页面出现「已领取」，+200 额度到账
- 适配器三种场景全部验证通过：客户端在跑（有端口）直接接管 / 没跑自动启动后退出 / 在跑但无端口自动重启接管并保留运行
