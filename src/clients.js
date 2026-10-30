import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import platform from './platform.js';

const { isMacOS, isWindows } = platform;

/**
 * 扫描本机可接管的客户端（Electron / Chromium 壳）。
 *
 * macOS   → /Applications、~/Applications，看 .app 里有没有 Electron/Chromium 框架
 * Windows → Program Files / Program Files (x86) / %LOCALAPPDATA%\Programs，
 *           看有没有 resources\app.asar（Electron）或 chrome_elf.dll / *.pak（Chromium 壳）
 */
function scanDirs() {
  if (isMacOS) return ['/Applications', path.join(os.homedir(), 'Applications')];
  if (isWindows) {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return [
      process.env.ProgramFiles || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      path.join(local, 'Programs'),
    ];
  }
  return ['/usr/share/applications', path.join(os.homedir(), '.local/share/applications')];
}

function listCandidates(dir, depth = 1) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    if (isMacOS) {
      if (name.endsWith('.app')) out.push({ name: name.replace(/\.app$/, ''), path: full, kind: 'bundle' });
    } else {
      let exes = [];
      try {
        exes = fs.readdirSync(full).filter((f) => f.toLowerCase().endsWith('.exe'));
      } catch {
        exes = [];
      }
      if (exes.length) {
        out.push({ name, path: full, exes, kind: 'dir' });
      } else if (depth > 0 && /programs? (files|x86)|localappdata|Programs$/i.test(dir + '') === false) {
        // Windows 有些软件装在 C:\Program Files\Vendor\App 这种两级目录，再下探一层
        out.push(...listCandidates(full, depth - 1));
      }
    }
  }
  return out;
}

function classifyMac(appPath) {
  const fw = path.join(appPath, 'Contents', 'Frameworks');
  let frameworks = [];
  try {
    frameworks = fs.readdirSync(fw);
  } catch {
    /* 忽略 */
  }
  const isElectron = frameworks.some((f) => /electron framework\.framework$/i.test(f));
  const isCef =
    frameworks.some((f) => /(browser|chromium) framework\.framework$/i.test(f)) ||
    fs.existsSync(path.join(appPath, 'Contents', 'Helpers'));
  let execName = '';
  try {
    execName = fs.readdirSync(path.join(appPath, 'Contents', 'MacOS')).find((f) => !f.startsWith('.')) || '';
  } catch {
    /* 忽略 */
  }
  return {
    kind: isElectron ? 'electron' : isCef ? 'chromium-shell' : 'native',
    takeable: isElectron || isCef,
    execPath: execName ? path.join(appPath, 'Contents', 'MacOS', execName) : null,
  };
}

function classifyWindows(appDir, exes) {
  const hasAsar = fs.existsSync(path.join(appDir, 'resources', 'app.asar'));
  let hasChromiumMarker = false;
  try {
    hasChromiumMarker = fs.readdirSync(appDir).some((f) => /\.(pak|dll)$/i.test(f) && /chrome|cef/i.test(f));
    if (!hasChromiumMarker) hasChromiumMarker = fs.readdirSync(appDir).some((f) => f.toLowerCase().endsWith('.pak'));
  } catch {
    /* 忽略 */
  }
  const isElectron = hasAsar;
  const isCef = !hasAsar && hasChromiumMarker;
  const base = path.basename(appDir).toLowerCase();
  const mainExe = exes.find((e) => e.toLowerCase().replace(/\.exe$/, '') === base) || exes[0] || '';
  return {
    kind: isElectron ? 'electron' : isCef ? 'chromium-shell' : 'native',
    takeable: isElectron || isCef,
    execPath: mainExe ? path.join(appDir, mainExe) : null,
  };
}

export function classifyApp(appPath, exes = []) {
  return isMacOS ? classifyMac(appPath) : classifyWindows(appPath, exes);
}

export async function scanApps({ logger } = {}) {
  const out = [];
  const seen = new Set();
  for (const dir of scanDirs()) {
    for (const cand of listCandidates(dir)) {
      if (seen.has(cand.path)) continue;
      seen.add(cand.path);
      const info = classifyApp(cand.path, cand.exes || []);
      if (!info.takeable) continue;
      out.push({ name: cand.name, path: cand.path, id: '', version: '', ...info });
    }
  }
  if (logger) logger.info(`扫到 ${out.length} 个可接管的 Chromium/Electron 客户端`);
  return out;
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

/** 实测某个客户端能不能接管：带调试端口起一个实例，列页面，然后退出 */
export async function probeClient(app, { logger, timeoutMs = 40000 } = {}) {
  const port = await freePort();
  if (await platform.isProcessRunning(app.execPath)) {
    return { ...app, ok: false, port, reason: '客户端正在运行。同一 App 通常只允许单实例，请先退出它再 probe' };
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
    await new Promise((r) => setTimeout(r, 1200));
  }

  if (!version) {
    await platform.gracefulQuit({ execPath: app.execPath, logger }).catch(() => null);
    return { ...app, ok: false, port, reason: `带 --remote-debugging-port 启动后 ${timeoutMs / 1000}s 内没有 CDP 响应` };
  }

  const pages = await cdpPages(port);
  await platform.gracefulQuit({ execPath: app.execPath, logger }).catch(() => null);

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
  for (const a of apps) rows.push({ ...a, running: await platform.isProcessRunning(a.execPath) });

  console.log('\n可接管的客户端（Electron / Chromium 壳，均支持 CDP 调试端口）\n');
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`  ${pad('名称', 20)}${pad('类型', 15)}${pad('运行中', 7)}路径`);
  for (const r of rows) {
    console.log(`  ${pad(r.name, 20)}${pad(r.kind, 15)}${pad(r.running ? '是' : '否', 7)}${String(r.path).slice(0, 58)}`);
  }
  console.log(`\n共 ${rows.length} 个。原生客户端不在此列（无法用 CDP 接管）。`);

  if (probeName) {
    const target = rows.find((r) => r.name.toLowerCase().includes(probeName.toLowerCase()));
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
      for (const p of res.pages.slice(0, 10)) {
        console.log(`     [${p.type}] ${String(p.title).slice(0, 40)} — ${String(p.url).slice(0, 90)}`);
      }
    }
  } else {
    console.log('\n想验证某个客户端是否真能被接管：npm run clients -- --probe=客户端名字的一部分\n');
  }
  return rows;
}
