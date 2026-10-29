import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { sleep } from '../util.js';
import { findClickables, clickByKeywords, pageText, classifyOutcome, detectLogin, screenshot } from '../dom.js';

const exec = promisify(execFile);

/**
 * 通用"接管桌面客户端"适配器。
 *
 * 适用对象：Electron 或 Chromium 壳（CEF）的客户端。这类客户端的界面本质是网页，
 * 只要能用调试端口连进去，就能：
 *   1. 在页面里执行 JS（直接调它自己的前端接口，带登录态）
 *   2. 或者像网页一样找按钮点（DOM 策略）
 *   3. 还能用客户端自己的登录态新开标签页访问它的网页版
 *
 * 不适用：原生 AppKit 客户端（只能 AppleScript 点 UI，需要辅助功能权限，脆弱）、手机 App。
 *
 * config.json 里的写法（platforms 下任意 key，带 app 字段就会走这里）：
 *
 *   "doubao": {
 *     "enabled": false,
 *     "type": "client",
 *     "name": "豆包",
 *     "app": "/Applications/Doubao.app",
 *     "port": 9445,
 *     "cdpMode": "arg",                    // "arg" = --remote-debugging-port；"env" = 专用环境变量
 *     "pageUrlMatch": "doubao-chat",       // 选哪个页面去操作
 *     "keywords": ["签到", "领取"],
 *     "doneKeywords": ["已签到", "明天再来"],
 *     "jsEval": "",                        // 可选：在页面里执行的 JS 表达式，优先于 DOM 策略
 *     "openUrl": "",                       // 可选：用客户端登录态新开这个网址再操作
 *     "quitAfterLaunch": true
 *   }
 */

async function cdpVersion(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function asynIsRunning(execPath) {
  try {
    const { stdout } = await exec('pgrep', ['-f', execPath]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export function resolveExecutable(pc) {
  const appOrBin = pc.app || pc.bin;
  if (!appOrBin) throw new Error('客户端平台缺少 app/bin 配置');
  if (appOrBin.endsWith('.app')) {
    const macos = path.join(appOrBin, 'Contents', 'MacOS');
    const exe = fs.readdirSync(macos).find((f) => !f.startsWith('.'));
    if (!exe) throw new Error(`${appOrBin} 里找不到可执行文件`);
    return path.join(macos, exe);
  }
  return appOrBin;
}

async function quitApp(pid, execPath, logger) {
  try {
    if (pid) process.kill(pid, 'SIGTERM');
    await sleep(1500);
    if (execPath && (await asynIsRunning(execPath))) {
      const name = path.basename(execPath).replace(/\s+/g, ' ');
      await exec('osascript', ['-e', `quit app "${name}"`]).catch(() => null);
    }
    logger?.step('已关闭客户端');
  } catch (e) {
    logger?.warn(`关闭客户端失败（忽略）: ${String(e.message).split('\n')[0]}`);
  }
}

export async function runClientApp(pc, { logger, cfg, shotDir, shotName, dryRun = false } = {}) {
  const port = Number(pc.port || 9445);
  const appOrBin = pc.app || pc.bin;
  if (appOrBin && !fs.existsSync(appOrBin)) {
    return {
      status: 'not_installed',
      detail: `没有找到客户端 ${appOrBin}。装上并登录后，把 config.json 里的 app/app路径 改对再启用`,
    };
  }
  const execPath = resolveExecutable(pc);
  const quitAfter = pc.quitAfterLaunch !== false;
  const timeoutMs = Number(pc.launchTimeoutMs || 60000);

  // 1) 端口已在监听 → 直接接管；否则按配置拉起客户端
  let version = await cdpVersion(port);
  let launchedPid = null;

  if (!version) {
    if (await asynIsRunning(execPath)) {
      return {
        status: 'needs_manual',
        detail: `客户端正在运行但没有开启调试端口 ${port}。请先退出它，再重跑（脚本不会强杀你正在用的窗口）`,
      };
    }

    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE; // Electron 客户端会因此以 Node 模式启动并秒退
    delete env.NODE_OPTIONS;

    const args = [];
    if ((pc.cdpMode || 'arg') === 'env') {
      env[pc.cdpEnv || 'WORKBUDDY_REMOTE_DEBUGGING_PORT'] = String(port);
    } else {
      args.push(`--remote-debugging-port=${port}`);
    }

    logger?.info(`启动 ${pc.name || '客户端'}（端口 ${port}）`);
    const child = spawn(execPath, args, { detached: true, stdio: 'ignore', env });
    child.unref();
    launchedPid = child.pid;

    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      version = await cdpVersion(port);
      if (version) break;
      await sleep(1200);
    }
    if (!version) {
      await quitApp(launchedPid, execPath, logger);
      return { status: 'error', detail: `客户端已启动但调试端口 ${port} 没响应（${timeoutMs / 1000}s 超时）` };
    }
    logger?.info(`CDP 就绪: ${version.Browser}`);
  } else {
    logger?.step(`检测到调试端口 ${port} 已就绪，直接接管`);
  }

  // 2) 连进去
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 20000 });
  } catch (e) {
    if (launchedPid) await quitApp(launchedPid, execPath, logger);
    return { status: 'error', detail: `连接 CDP 失败: ${String(e.message).split('\n')[0]}` };
  }

  let page;

  try {
    // 3) 选页面（必要时用客户端登录态新开一个网页）
    const pages = browser.contexts().flatMap((c) => c.pages());
    logger?.step(`发现 ${pages.length} 个页面`);

    if (pc.openUrl) {
      page = await browser.contexts()[0].newPage();
      await page.goto(pc.openUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(1500);
    } else {
      page = (pc.pageUrlMatch && pages.find((p) => p.url().includes(pc.pageUrlMatch))) || pages[0];
      if (!page) return { status: 'error', detail: '没找到可操作的页面' };
    }

    // 4) 幂等：先看是不是今天已经签过
    let text = await pageText(page);
    const doneHit = (pc.doneKeywords || []).find((k) => text.includes(k));
    if (doneHit) return { status: 'already', detail: `页面显示「${doneHit}」，今天已完成` };

    // 4.5) 演练模式：只报告"能不能点到"，不执行任何调用
    if (dryRun) {
      const cands = await findClickables(page, pc.keywords || ['签到', '领取']);
      let selHit = null;
      for (const sel of pc.clickSelectors || []) {
        try {
          if (await page.locator(sel).first().isVisible({ timeout: 800 })) {
            selHit = sel;
            break;
          }
        } catch {
          /* next */
        }
      }
      const hit = cands.length ? cands.map((c) => c.text).slice(0, 4).join(' / ') : selHit;
      return hit
        ? { status: 'dry_run', detail: `演练：登录正常，命中入口「${hit}」（未点击）` }
        : { status: 'not_found', detail: '演练：登录正常，但页面里没找到签到入口' };
    }

    // 5) 策略一：JS 直接调用（最稳，优先）
    if (pc.jsEval) {
      logger?.step('执行 jsEval');
      const r = await page.evaluate(async (code) => {
        try {
          // eslint-disable-next-line no-eval
          const v = await (0, eval)(code);
          return { ok: true, value: v === undefined ? null : JSON.parse(JSON.stringify(v)) };
        } catch (e) {
          return { ok: false, error: String(e && e.message ? e.message : e) };
        }
      }, pc.jsEval);

      if (!r.ok) return { status: 'failed', detail: `jsEval 执行出错: ${r.error}` };
      const v = r.value || {};
      if (v.status) return { status: v.status, detail: v.detail || '' };
      return { status: 'success', detail: `jsEval 已执行，返回: ${JSON.stringify(v).slice(0, 200)}` };
    }

    // 5.5) 策略一·五：等特定元素出现（客户端刚启动时界面是逐步渲染的）
    if (pc.waitForSelector) {
      logger?.step(`等待元素 ${pc.waitForSelector}`);
      await page.waitForSelector(pc.waitForSelector, { timeout: Number(pc.waitTimeoutMs || 30000) }).catch(() => {
        logger?.warn(`等待 ${pc.waitForSelector} 超时，继续尝试后续策略`);
      });
    }

    // 5.6) 策略一·八：按 CSS 选择器点击（签到入口是图标而没有文字的客户端用这个）
    if (Array.isArray(pc.clickSelectors) && pc.clickSelectors.length) {
      for (const sel of pc.clickSelectors) {
        try {
          const loc = page.locator(sel).first();
          if (await loc.isVisible({ timeout: 1200 })) {
            logger?.step(`命中选择器 ${sel}，点击`);
            await loc.click({ timeout: 5000 });
            await sleep(1500);
            const t3 = await pageText(page, 4000);
            const o3 = classifyOutcome(t3);
            if (o3.already) return { status: 'already', detail: `点击 ${sel} 后提示已完成` };
            if (o3.success) return { status: 'success', detail: `点击 ${sel} 后出现成功提示` };
            if (o3.fail) return { status: 'failed', detail: `点击 ${sel} 后出现失败提示` };
            return { status: 'uncertain', detail: `已点击 ${sel}，但没读到明确结果（看截图）` };
          }
        } catch {
          /* 换下一个选择器 */
        }
      }
      logger?.step('选择器都没命中，回退到文案匹配');
    }

    // 6) 策略二：DOM 点击（和网页端同一套逻辑）
    const login = await detectLogin(page, text);
    if (login.needLogin) return { status: 'needs_login', detail: login.reason };

    const res = await clickByKeywords(page, pc.keywords || ['签到', '领取'], logger, { label: pc.name || 'client' });
    const out = res.outcome || {};
    if (out.already) return { status: 'already', detail: `点击后提示已完成（${res.text}）` };
    if (out.success) return { status: 'success', detail: `点击「${res.text}」后出现成功提示` };
    if (out.fail) return { status: 'failed', detail: `点击「${res.text}」后出现失败提示` };
    if (res.clicked) {
      await sleep(1200);
      const t2 = await pageText(page, 4000);
      const o2 = classifyOutcome(t2);
      if (o2.success || o2.already) return { status: 'success', detail: `点击后页面提示 ${o2.success ? '成功' : '已完成'}` };
      return { status: 'uncertain', detail: `已点击「${res.text}」，但没读到明确结果（截图见 data/shots）` };
    }
    return { status: 'not_found', detail: `页面里没找到关键词按钮：${(pc.keywords || []).join('/')}` };
  } catch (e) {
    return { status: 'error', detail: String(e.message || e).split('\n')[0] };
  } finally {
    if (page && shotDir) await screenshot(page, shotDir, shotName || 'client').catch(() => null);
    try {
      browser.close?.();
    } catch {
      /* ignore */
    }
    if (launchedPid && quitAfter) await quitApp(launchedPid, execPath, logger);
  }
}
