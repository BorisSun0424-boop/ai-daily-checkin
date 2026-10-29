import workbuddy from './workbuddy.js';
import zhipu from './zhipu.js';
import wanxiang from './wanxiang.js';
import kimi from './kimi.js';
import wenxin from './wenxin.js';
import yuanbao from './yuanbao.js';
import doubao from './doubao.js';
import { genericCheckin } from './base.js';

export { genericCheckin };

/**
 * 内置适配器。
 *
 * 排序原则：能真正自动完成的放最前面，已确认"没有签到"的放后面且默认关闭。
 * 这份名单是 2026-10 实测调研后的结果，不是拍脑袋列的：
 *   ✅ WorkBuddy  腾讯客户端，每日 100 Credits，通过客户端 CDP 调内部接口 → 默认开启
 *   ✅ 智谱清言  真的每日登录积分，纯接口签名可算 → 默认开启
 *   ◻️ 通义万相  接口存活但产品已并入千问 → 默认关闭，可手动验证
 *   ❌ Kimi / 文心 / 智谱开放平台  没有签到（JS 全量检索 + 接口探测双证伪）
 *   📱 豆包 / 元宝  签到在客户端/App，网页端吃不到
 */
export const adapters = [workbuddy, zhipu, wanxiang, kimi, wenxin, yuanbao, doubao];

export const adapterById = new Map(adapters.map((a) => [a.id, a]));
