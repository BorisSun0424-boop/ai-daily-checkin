import { defineAdapter } from './base.js';

/**
 * 豆包（字节跳动）—— 签到存在，但入口在客户端/活动弹窗，网页端吃不到。默认关闭。
 *
 * 调研结论（2026-10）：
 *   - 2026-10 起豆包电脑客户端上线"签到领额度"，是【客户端】侧边栏/启动弹窗活动
 *   - 网页端 chat bundle 里『签到』文案 0 处；只有 explore 页有个
 *     s2-agent-explore-checkin-bubble 组件名，未证实等于每日签到
 *   - 风控很硬：websocket/接口强校验设备指纹 web_id、tea_uuid、fp=verify_<device_id>、
 *     aid=582478，缺项直接 712010702；UA 还要求带 SamanthaDoubao/2.27.12
 *   - GitHub chengwei-fly/doubao-manager 把豆包标为 checkinType='visit'（访问即得、无按钮）
 *
 * 结论：真实浏览器 + 手动登录后，网页端仍大概率找不到签到按钮。先关着，想试再开。
 */
export default defineAdapter({
  id: 'doubao',
  name: '豆包',
  homepage: 'https://www.doubao.com/chat/',
  entryUrls: ['https://www.doubao.com/chat/', 'https://www.doubao.com/work'],
  keywords: ['签到', '每日签到', '立即领取', '领取', '打卡'],
  doneKeywords: ['今日已签到', '已签到', '已领取'],
  enabledByDefault: false,
  notes: '签到在电脑客户端/活动弹窗，网页端无入口且设备指纹校验严格；默认关闭。',
});
