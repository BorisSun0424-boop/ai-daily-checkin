import path from 'node:path';
import { genericCheckin } from './adapters/index.js';
import { gotoSettled, pageText, detectLogin, dismissOverlays, findClickables, screenshot, dumpHTML, classifyOutcome } from './dom.js';
import { jitter, pruneOldDirs, today, nowISO } from './util.js';
import { resolveAdapters } from './config.js';
import {
  writeReport,
  readResultsJSONL,
  appendResultJSONL,
  systemNotify,
  webhookNotify,
  oneLineSummary,
  detailLines,
  statusIcon,
} from './notify.js';

const SHOT_ROOT = path.resolve('data/shots');
const RESULT_FILE = path.resolve('data/results.jsonl');
const REPORT_DIR = path.resolve('data/reports');

/**
 * 今天是否已经全部签完。
 *
 * 为什么需要：launchd 在电脑休眠错过后会补跑，或者用户手动点了一次，
 * 没有这个判断就会对同一批平台重复点击。虽然大部分站点本身幂等，
 * 但重复请求只会增加风控暴露面，没必要。
 */
export function alreadyDoneToday(cfg, { only = [] } = {}) {
  const list = resolveAdapters(cfg, { only });
  const date = today();
  const done = new Map();
  for (const r of readResultsJSONL(RESULT_FILE)) {
    if (r.date !== date || r.dryRun) continue;
    if (r.status === 'success' || r.status === 'already') done.set(r.id, r);
  }
  const pending = list.filter((a) => !done.has(a.id));
  return { allDone: list.length > 0 && pending.length === 0, pending, doneCount: done.size, total: list.length };
}

class TimeoutError extends Error {}

/**
 * 离线预检：断网时不必逐个平台超时。
 * 早上机器刚唤醒时网络往往还没就绪，所以：多源探测 + 重试，避免误判离线。
 */
async function isOnline({ attempts = 3, gapMs = 8000 } = {}) {
  const probes = ['https://www.baidu.com', 'https://www.aliyun.com', 'https://www.qq.com'];
  for (let i = 0; i < attempts; i++) {
    for (const url of probes) {
      try {
        const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
        if (r.status < 500) return true;
      } catch {
        /* 换下一个源 */
      }
    }
    if (i < attempts - 1) await sleep(gapMs);
  }
  return false;
}

function withTimeout(promise, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label}超时（${Math.round(ms / 1000)}s）`)), ms);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

/** 演练：只检查登录态 + 能看到哪些候选按钮，不点击 */
async function dryRunOne(adapter, page, logger, cfg) {
  const url = (adapter.entryUrls && adapter.entryUrls[0]) || adapter.homepage;
  await gotoSettled(page, url, logger, { settle: cfg.settle || 1800 });
  await dismissOverlays(page, logger);
  const text = await pageText(page);
  const login = await detectLogin(page, text);
  const cands = await findClickables(page, adapter.keywords);
  const allButtons = await page
    .evaluate(() => {
      const out = [];
      const norm = (s) => (s || '').replace(/[\s\u3000]+/g, '').trim();
      for (const el of document.querySelectorAll('button,[role="button"],a')) {
        const t = norm(el.textContent);
        if (t && t.length <= 20 && out.length < 40) out.push(t);
      }
      return [...new Set(out)];
    })
    .catch(() => []);

  if (login.needLogin) return { status: 'needs_login', detail: login.reason, url: page.url(), candidates: [] };
  if (cands.length) return { status: 'dry_run', detail: `可点击候选 ${cands.length} 个：${cands.map((c) => c.text).slice(0, 5).join(' / ')}`, url: page.url(), candidates: cands, buttons: allButtons };
  return { status: 'not_found', detail: `未发现关键词命中按钮；页面按钮：${allButtons.slice(0, 12).join(' / ') || '（无）'}`, url: page.url(), candidates: [], buttons: allButtons };
}

async function runOne(ctx, adapter, logger, cfg, opts) {
  const started = Date.now();
  const shotDir = path.join(SHOT_ROOT, today());
  const date = today();
  let page;
  let result;

  try {
    if (adapter.unsupported) {
      // 直接标记跳过，但仍然走统一的记录/日志流程
      result = { status: 'unsupported', detail: '该平台暂无可自动化的签到入口' };
    } else if (adapter.standalone && typeof adapter.custom === 'function') {
      // standalone：不依赖网页，直接在适配器内部自己搞定（比如接管本机客户端）
      const timeout = adapter.timeout || cfg.platformTimeout || 180000;
      result = await withTimeout(
        adapter.custom({ page: null, ctx: null, logger, cfg, shotDir, shotName: adapter.id, dryRun: !!opts.dryRun }),
        timeout,
        adapter.name,
      );
    } else {
      page = await ctx.newPage();
      // 自定义网页适配器（复用 runner 的浏览器上下文，避免抢同一个 profile）
      const work =
        typeof adapter.custom === 'function'
          ? adapter.custom({ page, ctx, logger, cfg, shotDir, shotName: adapter.id, dryRun: !!opts.dryRun })
          : opts.dryRun
            ? dryRunOne(adapter, page, logger, cfg)
            : genericCheckin(adapter, page, ctx, logger, cfg);
      const timeout = adapter.timeout || cfg.platformTimeout || 120000;
      result = await withTimeout(work, timeout, adapter.name);
    }
  } catch (e) {
    const msg = String(e.message || e).split('\n')[0];
    result = { status: e instanceof TimeoutError ? 'timeout' : 'error', detail: msg };
    logger.error(`${adapter.name} 异常: ${msg}`);
  }

  // 无论成败都留一张截图：这是排障的唯一一手现场
  let shot = null;
  if (page && !page.isClosed()) {
    shot = await screenshot(page, shotDir, adapter.id);
    if (['not_found', 'error', 'timeout', 'uncertain'].includes(result.status)) {
      await dumpHTML(page, shotDir, adapter.id).catch(() => null);
    }
    await page.close().catch(() => null);
  }

  const record = {
    ts: nowISO(),
    date,
    id: adapter.id,
    name: adapter.name,
    status: result.status,
    detail: result.detail || '',
    url: result.url || '',
    meta: result.meta || undefined,
    candidates: result.candidates ? result.candidates.length : undefined,
    buttons: result.buttons,
    shot: shot ? path.relative(process.cwd(), shot) : null,
    durationMs: Date.now() - started,
    dryRun: !!opts.dryRun,
  };
  appendResultJSONL(RESULT_FILE, record);
  return record;
}

/**
 * 依次跑所有启用的平台。
 * 关键设计：平台之间串行 + 随机间隔，不要并发 —— 同一 IP 同时打多个站最容易吃风控。
 */
export async function runAll(ctx, cfg, opts = {}) {
  const { logger, only = [], dryRun = false } = opts;
  const list = resolveAdapters(cfg, { only });
  if (!list.length) {
    logger.warn('没有启用的平台，检查 config.json 里的 platforms.*.enabled');
    return [];
  }

  // 断网时所有平台都会失败（还会白等超时），先探一下
  if (!dryRun && !(await isOnline())) {
    logger.warn('网络不可用（连不上 baidu.com），本次跳过全部平台');
    const skipped = list.map((a) => ({
      ts: nowISO(),
      date: today(),
      id: a.id,
      name: a.name,
      status: 'offline',
      detail: '网络不可用，已跳过',
      durationMs: 0,
      dryRun: false,
    }));
    for (const r of skipped) appendResultJSONL(RESULT_FILE, r);
    writeReport(REPORT_DIR, today(), skipped, { time: nowISO() });
    if (cfg.notify?.macos) await systemNotify('AI 签到跳过：网络不可用', '今天没跑，联网后可手动补：npm run checkin', { sound: false });
    return skipped;
  }

  logger.info(`共 ${list.length} 个平台待处理：${list.map((a) => a.name).join('、')}${dryRun ? '（演练模式）' : ''}`);
  const results = [];
  for (const [i, adapter] of list.entries()) {
    logger.info(`--- [${i + 1}/${list.length}] ${adapter.name} ---`);
    results.push(await runOne(ctx, adapter, logger, cfg, { dryRun }));
    const r = results[results.length - 1];
    logger.info(`${statusIcon(r.status)} ${adapter.name}: ${r.status} ${r.detail ? '· ' + r.detail : ''}`);
    if (i < list.length - 1) {
      // 平台之间留 3~9 秒随机间隔
      await jitter(3000, 9000);
    }
  }

  pruneOldDirs(SHOT_ROOT, cfg.screenshotKeepDays || 7);

  const date = today();
  const reportFile = writeReport(REPORT_DIR, date, results, { time: nowISO(), dryRun });
  logger.info(`日报: ${reportFile}`);

  if (!dryRun && cfg.notify?.macos) {
    const ok = results.filter((r) => r.status === 'success' || r.status === 'already').length;
    const title = `AI 签到 ${ok}/${results.length} 成功`;
    const body = [oneLineSummary(results), detailLines(results)].filter(Boolean).join('\n');
    await systemNotify(title, body || '全部完成', { sound: cfg.notify.sound !== false });
  }

  if (cfg.notify?.webhookUrl) {
    await webhookNotify(cfg.notify.webhookUrl, {
      text: `【AI 每日签到】${nowISO()}\n${oneLineSummary(results)}\n\n${detailLines(results)}`,
      results,
    });
  }

  return results;
}

export { SHOT_ROOT, RESULT_FILE, REPORT_DIR };
