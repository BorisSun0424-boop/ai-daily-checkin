#!/usr/bin/env node
/**
 * 打开早八控制台。
 *
 * 做的事：
 *   1) 检查 http://127.0.0.1:7788 是否在跑
 *   2) 没在跑 → 自动把服务拉起来（macOS 用 launchd kickstart；其它系统直接 spawn）
 *   3) 等服务就绪 → 用默认浏览器打开
 *
 * 用法：
 *   npm run open              # 打开控制台
 *   node src/open-console.js --no-browser   # 只确保服务在跑，不开浏览器
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import platform from './platform.js';

const exec = promisify(execFile);
const PORT = Number(process.env.ZAOBA_PORT || 7788);
const URL = `http://127.0.0.1:${PORT}`;
const NO_BROWSER = process.argv.includes('--no-browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isUp() {
  try {
    const r = await fetch(`${URL}/api/state`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function startService() {
  // macOS：优先走 launchd（我们装过常驻服务）
  if (platform.isMacOS) {
    const label = 'com.local.ai-checkin-web';
    const uid = process.getuid();
    try {
      const { stdout } = await exec('launchctl', ['print', `gui/${uid}/${label}`], { timeout: 4000 });
      if (stdout.includes(label)) {
        await exec('launchctl', ['kickstart', '-k', `gui/${uid}/${label}`], { timeout: 8000 }).catch(() => null);
        return 'launchd';
      }
    } catch {
      /* 没装服务，走 spawn */
    }
  }

  // 兜底：直接起一个后台服务
  const child = spawn(process.execPath, [path.join(process.cwd(), 'src', 'index.js'), 'web', `--port=${PORT}`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: process.cwd(),
  });
  child.unref();
  return 'spawn';
}

function openBrowser(url) {
  if (platform.isMacOS) return exec('open', [url]).catch(() => null);
  if (platform.isWindows) return exec('cmd', ['/c', 'start', '', url]).catch(() => null);
  return exec('xdg-open', [url]).catch(() => null);
}

async function main() {
  if (await isUp()) {
    console.log(`控制台已在运行: ${URL}`);
  } else {
    console.log('控制台没在跑，正在启动…');
    const how = await startService();
    console.log(`启动方式: ${how}`);
    let up = false;
    for (let i = 0; i < 20; i++) {
      await sleep(700);
      if (await isUp()) {
        up = true;
        break;
      }
    }
    if (!up) {
      console.error('✗ 启动失败。手动试一下: npm run web');
      process.exit(1);
    }
    console.log('✓ 控制台已就绪');
  }

  if (!NO_BROWSER) {
    await openBrowser(URL);
    console.log(`已在浏览器打开: ${URL}`);
  } else {
    console.log(`地址: ${URL}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
