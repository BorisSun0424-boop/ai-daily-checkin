import { defineAdapter } from './base.js';
import { gotoSettled, pageText } from '../dom.js';

/**
 * 通义万相（阿里绘图）—— 调研结论：接口存活但置信度中等，默认不启用。
 *
 * POST https://wanxiang.aliyun.com/wanx/api/common/inspiration/dailySignReward
 *   headers: content-type: application/json, x-platform: web, x-xsrf-token: <token>
 *   实测（未登录）：200 {"errorCode":"4002","errorMsg":"登录凭证过期","success":false}
 *
 * 注意：万相已并入千问 App，老脚本（kscript/sign）停在 2025-01，所以默认关闭。
 * 你在浏览器里登录 tongyi.aliyun.com/wanxiang/ 后，跑
 *   npm run checkin -- --only=wanxiang --headed
 * 能看到实际结果；确认可用再把 config.json 里的 enabled 改成 true。
 */
export default defineAdapter({
  id: 'wanxiang',
  name: '通义万相',
  homepage: 'https://wanxiang.aliyun.com/',
  entryUrls: ['https://wanxiang.aliyun.com/'],
  keywords: ['签到', '立即签到', '领取'],
  doneKeywords: ['今日已签到', '已签到', '已领取'],
  enabledByDefault: false,
  notes: '接口存活但产品已并入千问，签到入口可能已失效；默认关闭，确认可用后再开。',

  custom: async ({ page, logger }) => {
    await gotoSettled(page, 'https://wanxiang.aliyun.com/', logger, { settle: 1500 });
    await pageText(page, 2000);

    // x-xsrf-token 不在文档里写死，从 cookie/localStorage 里尽力找
    const xsrf = await page
      .evaluate(() => {
        const m = document.cookie.match(/(?:^|;\s*)(?:XSRF-TOKEN|xsrf-token|csrfToken|_tb_token_)=([^;]+)/i);
        if (m) return decodeURIComponent(m[1]);
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (/xsrf|csrf/i.test(k)) return String(localStorage.getItem(k)).replace(/"/g, '').slice(0, 200);
        }
        return '';
      })
      .catch(() => '');

    const res = await page.evaluate(
      async ({ xsrf }) => {
        const headers = { 'Content-Type': 'application/json', 'x-platform': 'web' };
        if (xsrf) headers['x-xsrf-token'] = xsrf;
        try {
          const r = await fetch('/wanx/api/common/inspiration/dailySignReward', {
            method: 'POST',
            headers,
            body: '{}',
            credentials: 'include',
          });
          const text = await r.text();
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* ignore */
          }
          return { http: r.status, json, text: text.slice(0, 300) };
        } catch (e) {
          return { http: 0, error: String(e && e.message ? e.message : e) };
        }
      },
      { xsrf },
    );

    const body = res.json || {};
    const msg = String(body.errorMsg || body.message || '');
    logger.step(`万相签到接口 HTTP ${res.http} errorCode=${body.errorCode ?? '-'} msg=${msg}`);

    if (/登录|凭证|未授权|401/.test(msg) || res.http === 401 || String(body.errorCode) === '4002') {
      return { status: 'needs_login', detail: `接口返回「${msg || res.http}」，说明该站登录态无效` };
    }
    if (body.success === true || String(body.errorCode) === '0') {
      return { status: 'success', detail: `签到成功${msg ? `（${msg}）` : ''}` };
    }
    if (/已签|已领|重复/.test(msg)) {
      return { status: 'already', detail: `今日已完成：${msg}` };
    }
    return { status: 'failed', detail: `HTTP ${res.http} ${msg || res.text || ''}`.trim() };
  },
});
