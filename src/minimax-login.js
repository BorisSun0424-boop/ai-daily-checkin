#!/usr/bin/env node
/**
 * MiniMax Code 专用登录：弹出浏览器窗口，你扫码/手机号登录，
 * 程序自己检测到登录成功就保存并退出（不需要在终端按回车）。
 *
 * 用法：node src/minimax-login.js
 */
import { launchContext } from './browser.js';
import { loadConfig } from './config.js';
import { pageText } from './dom.js';
import { createLogger } from './logger.js';

const logger = createLogger('minimax-login');
import { sleep } from './util.js';

const HOME = 'https://agent.minimax.cn/';
const MAX_MINUTES = 10;

async function checkLoggedIn(page) {
  try {
    const info = await page.evaluate(async () => {
      try {
        const r = await fetch('/v1/api/user/info', { credentials: 'include' });
        if (!r.ok) return { ok: false, status: r.status };
        const data = await r.json().catch(() => null);
        const id = data?.user_id || data?.data?.user_id || data?.user?.user_id || data?.data?.user?.user_id;
        return { ok: Boolean(id), status: r.status, id: id || null };
      } catch {
        return { ok: false, status: 0 };
      }
    });
    return info;
  } catch {
    return { ok: false, status: -1 };
  }
}

async function main() {
  const cfg = loadConfig();
  const ctx = await launchContext(cfg, { headless: false, logger });
  const page = await ctx.newPage();
  logger.info(`已打开 ${HOME} —— 请在窗口里完成登录（扫码 / 手机号都行）`);
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);

  const deadline = Date.now() + MAX_MINUTES * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    await sleep(3000);
    const info = await checkLoggedIn(page);
    const text = await pageText(page).catch(() => '');
    const state = `login=${info.ok} status=${info.status}`;
    if (state !== last) {
      logger.info(`检测中: ${state}`);
      last = state;
    }
    if (info.ok) {
      // 再等 2 秒让 cookie 落盘
      await sleep(2000);
      logger.info(`✅ 登录成功（user_id=${info.id}），登录态已保存`);
      await ctx.close();
      process.exit(0);
    }
    // 说明：页面上的「新建任务」在未登录时也显示，不能用它判断，只认接口
  }

  logger.warn(`超过 ${MAX_MINUTES} 分钟仍未检测到登录，已退出`);
  await ctx.close().catch(() => null);
  process.exit(2);
}

main().catch(async (e) => {
  console.error(e.message);
  process.exit(1);
});
