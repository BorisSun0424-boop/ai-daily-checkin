import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, nowISO, today } from './util.js';

/**
 * 同时写控制台和 data/log/YYYY-MM-DD.log。
 * launchd 后台跑的时候没有人看 stdout，日志文件才是唯一现场。
 */
export function createLogger(name = 'app', { silent = false, dir = './data/log' } = {}) {
  const logDir = ensureDir(path.resolve(dir));
  const file = path.join(logDir, `${today()}.log`);
  const tag = `[${name}]`;

  const write = (level, msg) => {
    const line = `${nowISO()} ${level.padEnd(5)} ${tag} ${msg}`;
    if (!silent) console.log(line);
    try {
      fs.appendFileSync(file, line + '\n', 'utf8');
    } catch {
      /* 日志写失败不能拖垮签到 */
    }
  };

  return {
    file,
    info: (m) => write('INFO', m),
    warn: (m) => write('WARN', m),
    error: (m) => write('ERROR', m),
    ok: (m) => write('OK', m),
    step: (m) => write('STEP', m),
  };
}
