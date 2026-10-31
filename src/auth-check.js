#!/usr/bin/env node
/**
 * 登录态自检：一条命令定位"为什么总是要重新登录"
 *
 * 检查项：
 *   1. 当前目录 / 登录态目录（全局 ~/.zaoba/profile）
 *   2. 各网页平台 cookie 的到期时间
 *   3. 系统定时任务指向的是哪个目录（是否和你现在用的目录一致）
 *   4. 本机是否存在多份安装（多份 = 登录态各自独立，最容易反复登录）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import platform, { defaultProfileDir } from './platform.js';

const exec = promisify(execFile);
const CWD = process.cwd();
const PROFILE = defaultProfileDir();

const DOMAINS = [
  ['MiniMax Code', 'https://agent.minimax.cn', /^_token$/],
  ['智谱清言', 'https://chatglm.cn', /^chatglm_token$/],
];

const days = (ts) => (ts && ts > 0 ? ((ts * 1000 - Date.now()) / 86400000).toFixed(1) : null);

async function checkCookies() {
  if (!fs.existsSync(PROFILE)) {
    console.log('  ⚠️ 还没有登录态目录（尚未登录任何网页平台）');
    return;
  }
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(PROFILE, { headless: true });
    for (const [name, url, re] of DOMAINS) {
      const ck = await ctx.cookies(url).catch(() => []);
      const hit = ck.find((c) => re.test(c.name));
      if (!hit) {
        console.log(`  ${name.padEnd(14)} ❌ 无登录 cookie（需要登录）`);
      } else {
        const d = days(hit.expires);
        console.log(`  ${name.padEnd(14)} ✅ 已登录  到期: ${d === null ? '会话级' : d + ' 天后'}${d !== null && d < 3 ? '  ⚠️ 快过期' : ''}`);
      }
    }
  } catch (e) {
    console.log(`  ⚠️ 读取登录态失败（可能有另一个进程正在使用它）: ${String(e.message).split('\n')[0]}`);
  } finally {
    await ctx?.close().catch(() => null);
  }
}

async function checkScheduler() {
  try {
    if (platform.isMacOS) {
      const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.includes('ai-daily-checkin') && f.endsWith('.plist')) : [];
      if (!files.length) {
        console.log('  未安装定时任务');
        return;
      }
      for (const f of files) {
        const { stdout } = await exec('plutil', ['-convert', 'json', '-o', '-', path.join(dir, f)]);
        const plist = JSON.parse(stdout);
        const args = plist.ProgramArguments || [];
        const script = args.find((a) => a.endsWith('run-daily.js')) || '';
        const project = script.replace(/\/src\/run-daily\.js$/, '');
        const same = project === CWD;
        console.log(`  任务 ${f}`);
        console.log(`    指向目录: ${project || '(未知)'}`);
        console.log(`    ${same ? '✅ 和你当前目录一致' : '⚠️ 和当前目录不同 —— 这是"反复登录"最常见的原因'}`);
      }
    } else if (platform.isWindows) {
      const { stdout } = await exec('schtasks', ['/Query', '/TN', 'ZaobaDailyCheckin', '/XML'], { timeout: 15000 }).catch(() => ({ stdout: '' }));
      if (!stdout) {
        console.log('  未安装定时任务');
        return;
      }
      const m = stdout.match(/<Arguments>([^<]*run-daily\.js[^<]*)<\/Arguments>/i);
      console.log(`    指向脚本: ${m ? m[1] : '(未解析到)'}`);
    }
  } catch (e) {
    console.log(`  ⚠️ 读取定时任务失败: ${String(e.message).split('\n')[0]}`);
  }
}

function findOtherInstalls() {
  const roots = [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Downloads'), os.homedir()];
  const found = new Set();
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      const pkg = path.join(dir, 'package.json');
      if (!fs.existsSync(pkg)) continue;
      try {
        const json = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (json.name === 'zaoba' || String(json.name || '').includes('zaoba')) found.add(dir);
      } catch {
        /* ignore */
      }
    }
  }
  found.add(CWD);
  return [...found];
}

async function main() {
  console.log('\n早八 · 登录态自检\n');
  console.log(`  系统: ${platform.summary().os}`);
  console.log(`  当前目录: ${CWD}`);
  console.log(`  登录态目录: ${PROFILE}${fs.existsSync(PROFILE) ? '' : '（还不存在）'}\n`);

  console.log('【登录态】');
  await checkCookies();
  console.log('\n【定时任务】');
  await checkScheduler();

  console.log('\n【安装份数】');
  const installs = findOtherInstalls();
  installs.forEach((d) => console.log(`  ${d === CWD ? '•' : '•'} ${d}${d === CWD ? '  ← 当前' : ''}`));
  if (installs.length > 1) {
    console.log('  ⚠️ 发现多份安装：它们的登录态是同一份（全局目录），但代码版本可能不同；');
    console.log('     如果定时任务指向的不是你平时登录的那份，就会出现"刚登录又要求登录"。');
  }

  console.log('\n结论怎么看：');
  console.log('  · 登录态显示"无 cookie" → 需要点控制台「去登录」扫码');
  console.log('  · cookie 还在但仍要求登录 → 定时任务指向了另一个目录，或登录态被清理工具删了');
  console.log('  · 到期时间 < 3 天 → 快过期，重新登录一次即可\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
