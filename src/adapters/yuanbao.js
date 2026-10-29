import { defineAdapter } from './base.js';

/**
 * 腾讯元宝 —— 签到确认存在，但在 App 的"福利中心"，网页端未验证。默认关闭。
 *
 * 调研结论（2026-10）：
 *   - 真实用户佐证（2026-06）：App 福利中心每日签到固定得 5000~10000 积分，
 *     可兑 QQ音乐/腾讯视频/QQ会员等
 *   - 网页端是单路由 SPA（_buildManifest 只有 "/"），任意路径都 200，URL 探测无效
 *   - 网页主 bundle 里没有 checkin/sign_in/签到 字样；能抓到的都是积分体系接口
 *     （/api/vision/midas/proxy/...、/api/vision/drawlots）
 *   - 腾讯 midas 风控：活动接口普遍带签名 + scene 参数
 *
 * 想拿下这一家，需要真机抓包定位 App 里的签到请求，再决定要不要做客户端适配。
 */
export default defineAdapter({
  id: 'yuanbao',
  name: '腾讯元宝',
  homepage: 'https://yuanbao.tencent.com/chat/',
  entryUrls: ['https://yuanbao.tencent.com/chat/'],
  keywords: ['签到', '每日签到', '打卡', '领取', '领算力'],
  doneKeywords: ['今日已签到', '已签到', '已领取'],
  enabledByDefault: false,
  notes: '签到在 App 福利中心，网页端未验证到入口；默认关闭。',
});
