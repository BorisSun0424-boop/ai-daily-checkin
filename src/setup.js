#!/usr/bin/env node
/**
 * 平台选择向导（体验层统一入口）。
 *
 * 用法：
 *   npm run setup                      # 交互式：列出所有平台，输入编号勾选
 *   npm run setup -- --check           # 只看清单，不修改
 *   npm run setup -- --enable=workbuddy,minimax
 *   npm run setup -- --disable=trae-cn
 *   npm run setup -- --web-only        # 只启用网页类平台（不装任何客户端）
 *   npm run setup -- --all             # 全部启用（含需要客户端的）
 *
 * 它不替代底层差异：网页类要登录一次，客户端类要装客户端+登录。
 * 它做的事是：让你在一个地方勾选，并明确告诉你每个平台还差什么。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig } from './config.js';
import platform from './platform.js';

const PROJECT_DIR = process.cwd();
const CONFIG_FILE = path.join(PROJECT_DIR, 'config.json');

/** 平台元信息：显示名、收益、需要什么、是否推荐（方式按 config 里的 type/app 自动判断） */
const INFO = {
  workbuddy: { label: 'WorkBuddy', gain: '100 Credits/天', need: 'WorkBuddy 客户端 + 登录', recommended: true },
  doubaowork: { label: '豆包工作', gain: '+200 额度/天', need: '豆包工作客户端 + 登录', recommended: false },
  'doubaowork-client': { label: '豆包工作', gain: '+200 额度/天', need: '豆包工作客户端 + 登录', recommended: true },
  trae: { label: 'Trae CN', gain: '+100 积分/天', need: 'Trae CN 客户端 + 登录', recommended: false },
  'trae-cn': { label: 'Trae CN', gain: '+100 积分/天', need: 'Trae CN 客户端 + 登录', recommended: true },
  minimax: { label: 'MiniMax Code', gain: '+400 积分/天', need: '网页登录一次（扫码）', recommended: true },
  zhipu: { label: '智谱清言', gain: '登录积分', need: '网页登录一次（扫码）', recommended: true },
  qoder: { label: 'Qoder CN', gain: '+100 积分/天', need: 'Qoder CN 客户端 + 登录', recommended: false },
  'qoder-cn': { label: 'Qoder CN', gain: '+100 积分/天', need: 'Qoder CN 客户端 + 登录', recommended: false },
  wanxiang: { label: '通义万相', gain: '—', need: '入口可能已失效', recommended: false },
  doubao: { label: '豆包（网页）', gain: '—', need: '未找到稳定签到入口', recommended: false },
  'doubao-client': { label: '豆包（客户端）', gain: '—', need: '未找到稳定签到入口', recommended: false },
  kimi: { label: 'Kimi', gain: '—', need: '无签到机制', recommended: false },
  wenxin: { label: '文心', gain: '—', need: '无签到机制', recommended: false },
  yuanbao: { label: '腾讯元宝', gain: '—', need: '签到仅在 App 内', recommended: false },
};

const MODE_LABEL = { web: '网页', client: '客户端' };

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeRaw(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/** 客户端是否已安装（按平台候选路径判断） */
function clientInstalled(id) {
  const map = {
    workbuddy: platform.knownAppPaths.workbuddy,
    doubaowork: platform.knownAppPaths.doubaowork,
    'doubaowork-client': platform.knownAppPaths.doubaowork,
    trae: platform.knownAppPaths.trae,
    'trae-cn': platform.knownAppPaths.trae,
    qoder: platform.knownAppPaths.qoder,
    'qoder-cn': platform.knownAppPaths.qoder,
    doubao: platform.knownAppPaths.doubao,
    'doubao-client': platform.knownAppPaths.doubao,
  };
  const cands = map[id] || [];
  return cs_exists(cands);
}

function cs_exists(cands) {
  return (cands || []).some((p) => p && fs.existsSync(p));
}

function rows() {
  const cfg = loadConfig();
  const out = [];
  for (const [id, pc] of Object.entries(cfg.platforms || {})) {
    const info = INFO[id] || { label: pc.name || id, gain: '—', need: '', recommended: false };
    // WorkBuddy 是内置 standalone 适配器（客户端），config 里没有 type/app 字段
    const mode = pc.type === 'client' || pc.app || id === 'workbuddy' ? 'client' : 'web';
    out.push({
      id,
      name: info.label || pc.name || id,
      enabled: Boolean(pc.enabled),
      mode,
      gain: info.gain,
      need: info.need,
      recommended: info.recommended,
      installed: mode === 'client' ? clientInstalled(id) : true,
    });
  }
  // 推荐且可用的排前面
  out.sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.id.localeCompare(b.id));
  return out;
}

function printTable(list) {
  console.log('');
  console.log('  编号  平台              方式    每日收益        当前      就绪度');
  console.log('  ' + '-'.repeat(72));
  for (const [i, r] of list.entries()) {
    const idx = String(i + 1).padStart(2);
    const name = (r.name || r.id).padEnd(16);
    const mode = MODE_LABEL[r.mode].padEnd(6);
    const gain = String(r.gain).padEnd(14);
    const state = (r.enabled ? '✅启用' : '  停用').padEnd(8);
    let ready;
    if (r.mode === 'client') ready = r.installed ? '客户端已装（还需登录）' : '❌ 缺客户端';
    else ready = '需网页登录一次';
    console.log(`  ${idx}   ${name}${mode}${gain}${state}${ready}`);
  }
  console.log('');
  const enabled = list.filter((r) => r.enabled);
  const missingClients = enabled.filter((r) => r.mode === 'client' && !r.installed);
  console.log(`  已启用 ${enabled.length} 个平台`);
  if (missingClients.length) {
    console.log(`  ⚠️ 其中 ${missingClients.length} 个缺客户端：${missingClients.map((r) => r.name).join('、')}`);
  }
  console.log('');
}

async function interactive(list) {
  const rl = readline.createInterface({ input, output });
  const defaults = list.map((r, i) => (r.enabled ? i + 1 : null)).filter(Boolean);
  console.log('输入要启用的平台编号，用逗号分隔（回车 = 保持当前设置）');
  console.log(`  当前启用：${defaults.length ? defaults.join(',') : '无'}`);
  const answer = (await rl.question('  编号 > ')).trim();
  rl.close();
  if (!answer) {
    console.log('保持原设置不变。');
    return null;
  }
  const picked = answer
    .split(/[,，\s]+/)
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= list.length);
  if (!picked.length) {
    console.log('没有识别到有效编号，未修改。');
    return null;
  }
  const set = new Set(picked.map((n) => list[n - 1].id));
  return list.map((r) => ({ id: r.id, enabled: set.has(r.id) }));
}

function applySelection(selection) {
  const raw = readRaw();
  if (!raw) {
    console.error('✗ 找不到 config.json，先跑一次 npm run list 生成默认配置');
    process.exit(1);
  }
  for (const { id, enabled } of selection) {
    if (!raw.platforms[id]) raw.platforms[id] = { enabled, type: 'custom' };
    raw.platforms[id].enabled = enabled;
  }
  writeRaw(raw);
}

function nextSteps(list) {
  const on = list.filter((r) => r.enabled);
  const web = on.filter((r) => r.mode === 'web');
  const clients = on.filter((r) => r.mode === 'client');
  const missing = clients.filter((r) => !r.installed);

  console.log('下一步：');
  if (missing.length) {
    console.log('  1) 装这些客户端（然后各自扫码登录）：');
    for (const r of missing) console.log(`     · ${r.name}  —— ${r.need}`);
  }
  if (web.length) {
    console.log(`  ${missing.length ? 2 : 1}) 网页类平台登录一次：`);
    console.log('     npm run login              # 一次开完所有网页平台');
    console.log('     npm run login:minimax      # 或者只登 MiniMax');
  }
  console.log(`  ${missing.length || web.length ? (missing.length && web.length ? 3 : 2) : 1}) 验证：npm run dry-run`);
  console.log('  最后装定时任务：');
  console.log('     macOS:   bash scripts/install-launchd.sh');
  console.log('     Windows: powershell -ExecutionPolicy Bypass -File scripts\\install-service.ps1');
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };

  const cfg = loadConfig();
  if (!fs.existsSync(CONFIG_FILE)) {
    // 首次：先生成默认配置
    const raw = JSON.parse(JSON.stringify(cfg));
    writeRaw(raw);
    console.log('✓ 已生成 config.json');
  }

  let list = rows();
  console.log('\n早八 · 平台选择');
  printTable(list);

  if (args.includes('--check')) {
    nextSteps(list);
    return;
  }

  let selection = null;
  if (args.includes('--web-only')) {
    selection = list.map((r) => ({ id: r.id, enabled: r.mode === 'web' && r.recommended }));
  } else if (args.includes('--all')) {
    selection = list.map((r) => ({ id: r.id, enabled: r.recommended || r.mode === 'web' }));
  } else if (flag('enable') || flag('disable')) {
    const on = new Set((flag('enable') || '').split(/[,，\s]+/).filter(Boolean));
    const off = new Set((flag('disable') || '').split(/[,，\s]+/).filter(Boolean));
    selection = list
      .map((r) => ({ id: r.id, enabled: on.has(r.id) ? true : off.has(r.id) ? false : r.enabled }))
      .filter((x, i) => x.enabled !== list[i].enabled);
  } else {
    selection = await interactive(list);
  }

  if (selection && selection.length) {
    // 同步新增/删除的平台项：启用但配置里没有的，补上
    const raw = readRaw();
    for (const { id, enabled } of selection) {
      if (!raw.platforms[id]) {
        const base = cfg.defaults?.platforms?.[id] || (cfg.platforms || {})[id] || {};
        raw.platforms[id] = { enabled, ...base };
      }
    }
    writeRaw(raw);
    applySelection(selection);
    list = rows();
    console.log('\n✓ 已更新启用列表');
    printTable(list);
  }

  nextSteps(list);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
