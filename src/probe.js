import fs from 'node:fs';
import path from 'node:path';
import { launchContext } from './browser.js';
import { resolveAdapters } from './config.js';
import { gotoSettled, pageText, detectLogin, dismissOverlays, findClickables, screenshot, dumpHTML, classifyOutcome } from './dom.js';
import { ensureDir, today } from './util.js';

/**
 * 探针：把每个平台的页面"解剖"一遍，输出可直接照着改配置的信息。
 *
 * 用途：某个平台报 not_found（找不到签到按钮）时，跑 `npm run probe -- --only=doubao`，
 * 它会告诉你页面上实际有哪些按钮文案、哪些关键词命中了、页面有没有跳登录，
 * 然后把命中的文案填进 config.json 的 platform.keywords 就行 —— 不用改代码。
 */
export async function probeCommand(cfg, logger, { only = [] } = {}) {
  const list = resolveAdapters(cfg, { only });
  const outDir = ensureDir(path.resolve('data/probe', today()));
  const ctx = await launchContext(cfg, { headless: cfg.headless, logger });
  const report = {};

  for (const adapter of list) {
    logger.info(`--- 探测 ${adapter.name} ---`);
    const entry = { id: adapter.id, name: adapter.name, urls: [] };
    for (const url of adapter.entryUrls.length ? adapter.entryUrls : [adapter.homepage]) {
      const page = await ctx.newPage();
      const item = { url, finalUrl: '', needLogin: false, reason: '', candidates: [], buttons: [], frames: 0, textSample: '', shot: null, html: null };
      try {
        await gotoSettled(page, url, logger, { settle: cfg.settle || 1800 });
        item.overlaysClosed = await dismissOverlays(page, logger);
        item.finalUrl = page.url();
        const text = await pageText(page);
        item.textSample = text.slice(0, 1200);
        item.frames = page.frames().length;
        const login = await detectLogin(page, text);
        item.needLogin = login.needLogin;
        item.reason = login.reason;
        item.outcome = classifyOutcome(text);

        const cands = await findClickables(page, adapter.keywords);
        item.candidates = cands;
        item.buttons = await page
          .evaluate(() => {
            const norm = (s) => (s || '').replace(/[\s\u3000]+/g, '').trim();
            const out = [];
            for (const el of document.querySelectorAll('button,[role="button"],a,li,span,div')) {
              const t = norm(el.textContent);
              if (!t || t.length > 16) continue;
              const st = getComputedStyle(el);
              if (st.display === 'none' || st.visibility === 'hidden') continue;
              const r = el.getBoundingClientRect();
              if (r.width < 8 || r.height < 8) continue;
              out.push(`<${el.tagName.toLowerCase()}> ${t}`);
              if (out.length >= 60) break;
            }
            return [...new Set(out)];
          })
          .catch(() => []);

        item.shot = path.relative(process.cwd(), (await screenshot(page, outDir, `${adapter.id}-${new URL(url).hostname}`)) || '');
        item.html = path.relative(process.cwd(), (await dumpHTML(page, outDir, `${adapter.id}-${new URL(url).hostname}`)) || '');
      } catch (e) {
        item.error = String(e.message || e).split('\n')[0];
      }
      await page.close().catch(() => null);
      entry.urls.push(item);
      logger.info(`${url} → ${item.error || (item.needLogin ? '需要登录' : item.candidates.length ? `命中 ${item.candidates.length} 个候选按钮` : '未命中任何候选')}`);
    }
    report[adapter.id] = entry;
  }

  await ctx.close();
  const file = path.join(outDir, 'probe.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  console.log(`\n探测结果已写入: ${file}\n`);
  return report;
}
