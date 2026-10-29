import { defineAdapter } from './base.js';

/**
 * 文心一言 / 文心（百度）—— 调研结论：网页端没有签到，默认关闭。
 *
 * 证据（2026-10 实时）：yiyan.baidu.com 已 302 → wenxin.baidu.com（2026-07 迁移），
 * 主 bundle（chat-search/static/pc/search-*.js，229KB）里
 * 『签到』『积分』『算力』『额度』『checkin』『sign_in』计数全部为 0。
 * 网上"文心签到领充电值"来自 php.cn 内容农场稿，无可交叉验证，不可信。
 *
 * 另注意：GitHub 上叫 sign 的"文心签到脚本"多数其实是文心一格（yige.baidu.com）绘图，不是这个产品。
 */
export default defineAdapter({
  id: 'wenxin',
  name: '文心',
  homepage: 'https://wenxin.baidu.com/',
  entryUrls: ['https://wenxin.baidu.com/'],
  keywords: ['签到', '每日签到', '领取'],
  doneKeywords: [],
  enabledByDefault: false,
  notes: '已确认网页端无签到（产品已迁移到 wenxin.baidu.com），保持关闭即可。',
});
