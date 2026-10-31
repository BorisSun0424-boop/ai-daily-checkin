import { launchContext } from '../browser.js';
import { defineAdapter } from './base.js';
import { pageText, detectLogin, screenshot, dumpHTML, gotoSettled } from '../dom.js';
import { sleep } from '../util.js';

/**
 * MiniMax Code（agent.minimax.cn）每日签到。
 *
 * 调研结论（2026-10，官方文档 + 前端 bundle 双向确认）：
 *   - 签到在网页版：agent.minimax.cn，需要登录（手机号/扫码）
 *   - 每日 400 积分；连续第 4、7 天单日 1000；一周约 4000
 *   - 入口层级：「每日签到」菜单项 → 弹出签到面板 → 点「签到 / 签到得 N 积分」
 *   - 已签状态文案：「今日已签到」；成功文案：「签到成功 +N 积分」
 *   - 积分自到账 30 天内有效
 *
 * 因为签到入口藏在账户菜单里，流程是：
 *   打开首页 → 判断登录 → 点开头像/账户 → 找「每日签到」→ 点签到按钮 → 用文案判断结果
 */

const HOME = 'https://agent.minimax.cn/';

const ACCOUNT_TRIGGERS = [
  '[class*="avatar"]',
  '[class*="Avatar"]',
  '[class*="user-info"]',
  '[class*="userInfo"]',
  '[class*="account"]',
  '[class*="profile"]',
  'button[class*="user"]',
];

const SIGNIN_ENTRY_TEXTS = ['每日签到', '签到'];
const CLAIM_BUTTON_PATTERN = /^(签到|立即签到|签到得)/;
const DONE_TEXTS = ['今日已签到', '已签到', '明天再来'];
const SUCCESS_TEXTS = ['签到成功', '领取成功'];

async function clickFirstVisibleText(page, texts, { logger, maxLen = 20 } = {}) {
  for (const t of texts) {
    try {
      const loc = page.locator(`text=${t}`).filter({ visible: true }).first();
      const n = await page.locator(`text=${t}`).count();
      if (!n) continue;
      const el = page.locator(`text=${t}`).first();
      if (await el.isVisible({ timeout: 800 })) {
        await el.click({ timeout: 4000 });
        logger?.step(`点击文本「${t}」`);
        return true;
      }
    } catch {
      /* 换下一个 */
    }
  }
  return false;
}

async function clickAccountEntry(page, logger) {
  for (const sel of ACCOUNT_TRIGGERS) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 800 })) {
        await loc.click({ timeout: 4000 });
        logger?.step(`点开账户入口: ${sel}`);
        await sleep(1200);
        return true;
      }
    } catch {
      /* 换下一个 */
    }
  }
  // 兜底：找页面上含用户名的按钮
  try {
    const btn = page.locator('button:has-text("积分")').first();
    if (await btn.isVisible({ timeout: 800 })) {
      await btn.click({ timeout: 4000 });
      logger?.step('点开账户入口（积分按钮兜底）');
      await sleep(1200);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function runMinimax({ logger, cfg, shotDir, shotName, dryRun }) {
  const ctx = await launchContext(cfg, { headless: true, logger });
  const page = await ctx.newPage();
  try {
    logger?.step(`打开 ${HOME}`);
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => null);
    await sleep(3000);

    let text = await pageText(page);
    if (await detectLogin(page, text)) {
      await screenshot(page, shotDir, `${shotName}-login`).catch(() => null);
      return { status: 'needs_login', detail: 'MiniMax Code 未登录，运行 npm run login 扫码登录一次' };
    }

    // 打开账户菜单（签到入口在里面）
    const opened = await clickAccountEntry(page, logger);
    if (!opened) logger?.warn('没找到账户入口，直接在页面里找签到');
    await sleep(1500);
    text = await pageText(page);

    const doneHit = DONE_TEXTS.find((k) => text.includes(k));
    if (doneHit && !text.includes('签到得')) {
      await screenshot(page, shotDir, shotName).catch(() => null);
      return { status: 'already', detail: `页面显示「${doneHit}」，今天已完成` };
    }

    // 找「每日签到」菜单项
    const foundEntry = await clickFirstVisibleText(page, SIGNIN_ENTRY_TEXTS, { logger });
    if (!foundEntry) {
      await dumpHTML(page, shotDir, `${shotName}-nofound`).catch(() => null);
      await screenshot(page, shotDir, `${shotName}-nofound`).catch(() => null);
      return { status: 'not_found', detail: '没找到「每日签到」入口（界面可能改版，用 npm run probe -- --only=minimax 看实际文案）' };
    }
    await sleep(2000);
    text = await pageText(page);

    const doneNow = DONE_TEXTS.find((k) => text.includes(k));
    if (doneNow) {
      await screenshot(page, shotDir, shotName).catch(() => null);
      return { status: 'already', detail: `签到面板显示「${doneNow}」，今天已完成` };
    }

    if (dryRun) {
      await screenshot(page, shotDir, `${shotName}-dryrun`).catch(() => null);
      return { status: 'dry_run', detail: '演练模式：已找到签到入口，未点击' };
    }

    // 点签到按钮：优先匹配「签到得 N 积分」这种可点元素
    let claimed = false;
    try {
      const btn = page.getByRole('button', { name: CLAIM_BUTTON_PATTERN }).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click({ timeout: 5000 });
        claimed = true;
        logger?.step('已点击「签到」按钮');
      }
    } catch {
      /* 退回到文本匹配 */
    }
    if (!claimed) {
      for (const t of ['签到得', '立即签到', '签到']) {
        if (await clickFirstVisibleText(page, [t], { logger })) {
          claimed = true;
          break;
        }
      }
    }

    await sleep(2500);
    text = await pageText(page);
    await screenshot(page, shotDir, shotName).catch(() => null);

    const success = SUCCESS_TEXTS.find((k) => text.includes(k));
    const doneAfter = DONE_TEXTS.find((k) => text.includes(k));
    const points = (() => {
      const m = text.match(/\+(\d{2,5})\s*积分/);
      return m ? Number(m[1]) : null;
    })();

    if (success || doneAfter) {
      return {
        status: success ? 'success' : 'already',
        detail: points ? `签到成功，+${points} 积分` : success ? '签到成功' : `页面显示「${doneAfter}」`,
        meta: points ? { todayPoints: points } : undefined,
      };
    }

    if (!claimed) {
      return { status: 'not_found', detail: '找到了签到入口但没找到可点的签到按钮' };
    }
    return { status: 'uncertain', detail: '点了签到，但页面上没看到明确的成功/已签文案' };
  } finally {
    await page.close().catch(() => null);
    await ctx.close().catch(() => null);
  }
}

export default defineAdapter({
  id: 'minimax',
  name: 'MiniMax Code',
  standalone: true,
  enabledByDefault: false,
  homepage: HOME,
  loginUrl: HOME,
  timeout: 180000,
  keywords: ['每日签到', '签到'],
  doneKeywords: DONE_TEXTS,
  notes: '网页版每日签到（+400 积分，第 4/7 天 1000）；入口在账户菜单的「每日签到」，需要先 npm run login 登录一次',
  custom: runMinimax,
});
