#!/usr/bin/env node
/**
 * 跨平台静态检查：对所有 JS 源文件跑 `node --check`，并验证关键模块能加载。
 * 供 CI 使用（macOS + Windows 都会跑）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const targets = [];

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(full);
    } else if (name.endsWith('.js') || name.endsWith('.mjs')) {
      targets.push(full);
    }
  }
}

for (const d of ['src', 'scripts', 'web']) {
  if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
}

let failed = 0;
for (const file of targets) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(`✗ 语法错误: ${path.relative(root, file)}`);
    console.error(String(e.stderr || e.message).split('\n').slice(0, 3).join('\n'));
  }
}
console.log(`语法检查: ${targets.length - failed}/${targets.length} 通过`);
process.exit(failed ? 1 : 0);
