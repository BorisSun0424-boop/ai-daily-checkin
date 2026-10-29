import { defineAdapter } from './base.js';

/**
 * Kimi（月之暗面）—— 调研结论：没有签到。默认关闭。
 *
 * 证据（2026-10 实时）：官网 131 个 JS chunk（约 8MB）全量检索，
 * 『签到』『福利』出现 0 次；10 个候选签到路径（/api/checkin、/api/user/check_in、
 * /api/daily_checkin、/api/user/points …）全部 404。
 * 实际基座是 GET /api/user（未登录 → 401 auth.token.empty）。
 *
 * Kimi 有的是"会员月度额度"（按月刷新），不是每日签到积分。
 * 网上"Kimi 签到补额度"的说法是 SEO 软文，别当真。
 */
export default defineAdapter({
  id: 'kimi',
  name: 'Kimi',
  homepage: 'https://www.kimi.com/',
  entryUrls: ['https://www.kimi.com/'],
  keywords: ['签到', '每日签到', '立即领取', '领取'],
  doneKeywords: [],
  enabledByDefault: false,
  notes: '已确认无签到机制（JS 全量检索 + 接口探测双证伪），保持关闭即可。',
});
