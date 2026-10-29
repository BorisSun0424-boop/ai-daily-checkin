import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { sleep } from './util.js';

const exec = promisify(execFile);

const SCAN_DIRS = ['/Applications', path.join(process.env.HOME || '', 'Applications')];

/**
 * 扫描本机客户端，判断哪些"能接管"。
 *
 * 背景：很多 AI 工具的签到只在桌面客户端里（网页端没有）。而客户端能不能被脚本接管，
 * 取决于它的技术栈：
 *   · Electron       → Chromium 内核，支持 CDP 调试端口（本工具已验证：WorkBuddy）
 *   · CEF/Chromium壳 → 同样支持 --remote-debugging-port（本工具已验证：豆包、豆包工作）
 *   · 原生 AppKit    → 只能靠 AppleScript UI 脚本（脆弱，需要辅助功能权限）
 *   · 移动端 App     → Mac 上没有进程可接管，脚本无能为力
 */
export function classifyApp(appPath) {
  const contents = path.join(appPath, 'Contents');
  const fw = path.join(contents, 'Frameworks');
  const helpers = path.join(contents, 'Helpers');

  let frameworks = [];
  try {
    frameworks = fs.readdirSync(fw);
  } catch {
    /* 无 Frameworks */
  }

  const isElectron = frameworks.some((f) => /electron framework\.framework$/i.test(f));
  const isCef = frameworks.some((f) => /(browser|chromium) framework\.framework$/i.test(f)) || (fs.existsSync(helpers) && fs.readdirSync(helpers).some((h) => /browser\.app$/i.test(h)));

  let execName = '';
  try {
    execName = fs.readdirSync(path.join(contents, 'MacOS')).find((f) => !f.startsWith('.')) || '';
  } catch {
    /* ignore */
  }

  return {
    kind: isElectron ? 'electron' : isCef ? 'chromium-shell' : 'native',
    takeable: isElectron || isCef,
    execPath: execName ? path.join(contents, 'MacOS', execName) : null,
  };
}

async function plistValue(appPath, key) {
  try {
    const { stdout } = await exec('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(appPath, 'Contents', 'Info.plist')], { timeout: 4000 });
    return stdout.trim();
  } catch {
    return '';
  }
}

export async function scanApps({ logger } = {}) {
  const out = [];
  for (const dir of SCAN_DIRS) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.app'));
    } catch {
      continue;
    }
    for (const name of names) {
      const appPath = path.join(dir, name);
      const info = classifyApp(appPath);
      if (!info.takeable) continue; // 只列"可接管"的，原生 App 列出来没意义
      out.push({
        name: name.replace(/\.app$/, ''),
        path: appPath,
        id: await plistValue(appPath, 'CFBundleIdentifier'),
        version: await plistValue(appPath, 'CFBundleShortVersionString'),
        ...info,
      });
    }
  }
  if (logger) logger.info(`扫到 ${out.length} 个可接管的 Chromium/Electron 客户端`);
  return out;
}

async function asynIsRunning(execPath) {
  try {
    const { stdout } = await exec('pgrep', ['-f', execPath]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export function freePort(start = 9500) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', () => resolve(freePort(start + 1)));
    srv.listen(start, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function cdpVersion(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function cdpPages(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.json() : [];
  } catch {
    return [];
  }
}

/**
 * 实测某个客户端能不能接管：用调试端口临时起一个实例，列页面，然后退出。
 * 注意：如果客户端本来就在运行，先退出它再用 probe（同一 App 通常只允许单实例）。
 */
export async function probeClient(app, { logger, timeoutMs = 40000 } = {}) {
  const port = await freePort();
  const running = await asynIsRunning(app.execPath);
  if (running) {
    return {
      ...app,
      ok: false,
      port,
      reason: '客户端正在运行。同一 App 通常只允许单实例，请先退出它再 probe',
    };
  }

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // 对 Electron 客户端是致命的
  delete env.NODE_OPTIONS;

  logger?.info(`启动 ${app.name}（调试端口 ${port}）`);
  const child = spawn(app.execPath, [`--remote-debugging-port=${port}`], { detached: true, stdio: 'ignore', env });
  child.unref();

  let version = null;
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    version = await cdpVersion(port);
    if (version) break;
    await sleep(1200);
  }

  if (!version) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
    return { ...app, ok: false, port, reason: `以 --remote-debugging-port 启动后 ${timeoutMs / 1000}s 内没有 CDP 响应（可能不支持该参数，或需要专用环境变量）` };
  }

  const pages = await cdpPages(port);
  try {
    process.kill(child.pid, 'SIGTERM');
  } catch {
    /* ignore */
  }
  await sleep(800);

  return {
    ...app,
    ok: true,
    port,
    browser: version.Browser,
    pages: pages.map((p) => ({ type: p.type, title: p.title, url: p.url })),
  };
}

/** CLI 入口 */
export async function clientsCommand(_cfg, logger, { probeName } = {}) {
  const apps = await scanApps({ logger });

  const rows = [];
  for (const a of apps) {
    const running = await asynIsRunning(a.execPath);
    rows.push({ ...a, running });
  }

  console.log('\n可接管的客户端（Electron / Chromium 壳，均支持 CDP 调试端口）\n');
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`  ${pad('名称', 20)}${pad('版本', 10)}${pad('类型', 16)}${pad('运行中', 8)}bundle id`);
  for (const r of rows) {
    console.log(`  ${pad(r.name, 20)}${pad(r.version, 10)}${pad(r.kind, 16)}${pad(r.running ? '是' : '否', 8)}${r.id}`);
  }
  console.log(`\n共 ${rows.length} 个。原生 AppKit 客户端不在此列（它们无法用 CDP 接管）。`);

  if (probeName) {
    const target = rows.find((r) => r.name.toLowerCase().includes(probeName.toLowerCase()) || r.id.includes(probeName));
    if (!target) {
      console.log(`\n找不到匹配 "${probeName}" 的客户端。`);
      return rows;
    }
    console.log(`\n=== 实测接管 ${target.name} ===`);
    const res = await probeClient(target, { logger });
    if (!res.ok) {
      console.log(`  ✗ 接管失败：${res.reason}`);
    } else {
      console.log(`  ✓ 接管成功  ${res.browser}`);
      console.log(`  ✓ 拿到 ${res.pages.length} 个页面：`);
      for (const p of res.pages.slice(0, 10)) console.log(`     [${p.type}] ${String(p.title).slice(0, 40)} — ${String(p.url).slice(0, 90)}`);
      console.log('\n下一步：如果这个客户端的签到在页面里，可以把它加成一个客户端平台（见 README「接管桌面客户端」）。');
    }
  } else {
    console.log('\n想验证某个客户端是否真能被接管：npm run clients -- --probe=客户端名字的一部分\n');
  }
  return rows;
}
