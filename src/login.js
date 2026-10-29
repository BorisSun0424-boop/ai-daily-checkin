import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { launchContext } from './browser.js';
import { resolveAdapters } from './config.js';
import { sleep } from './util.js';

/**
 * 交互式登录：开一个真实浏览器窗口，把所有平台的登录页开成标签页。
 * 你手动点完登录（可能要扫码/短信验证码），回车保存，登录态就写进 profile 目录了。
 *
 * 之后定时任务复用同一个 profile，不再需要登录 —— 直到某个平台把登录态踢掉，
 * 那时报告里会出现 needs_login，再跑一次 npm run login 就行。
 */
export async function loginCommand(cfg, logger) {
  const list = resolveAdapters(cfg, {});
  if (!list.length) {
    logger.warn('没有启用的平台，先检查 config.json');
    return;
  }

  const ctx = await launchContext(cfg, { headless: false, logger });
  const keepOpenMinutes = 15;

  for (const a of list) {
    try {
      const page = await ctx.newPage();
      const url = a.loginUrl || a.homepage;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
      logger.info(`已打开标签页: ${a.name} → ${url}`);
    } catch (e) {
      logger.warn(`${a.name} 打开失败: ${e.message}`);
    }
    await sleep(600);
  }

  const rl = readline.createInterface({ input, output });
  console.log('\n' + '='.repeat(64));
  console.log('请在打开的浏览器窗口里逐个完成登录（扫码 / 短信验证码都行）。');
  console.log('提示：');
  console.log('  · 每个平台登录成功后，最好在该站内随便点一下，让 Cookie 落地');
  console.log('  · 建议勾选"30 天内免登录"之类的选项，能显著降低以后失效概率');
  console.log(`  · 最多等 ${keepOpenMinutes} 分钟，或直接回车立即保存`);
  console.log('='.repeat(64) + '\n');

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // 回车 / stdin 被关闭 / Ctrl-C / 超时，四种情况都要能退出，
    // 否则在非交互环境（管道、定时任务）里会一直吊到超时
    rl.question('全部登录完成后按回车保存... ', finish).catch(finish);
    rl.once('close', finish);
    rl.once('SIGINT', finish);
    process.once('SIGINT', finish);
    setTimeout(finish, keepOpenMinutes * 60_000).unref?.();
  });
  rl.close();

  // 关闭浏览器时 Playwright 会把 cookie/localStorage 刷盘到 profile
  await ctx.close();
  logger.ok('登录态已写入 profile 目录，定时任务会直接复用');
  console.log(`\nprofile 位置: ${path.resolve(cfg.userDataDir)}\n`);
  console.log('下一步验证：npm run dry-run （只检查登录态和按钮，不点击）\n');
}
