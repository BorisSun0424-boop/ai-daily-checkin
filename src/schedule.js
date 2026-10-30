import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export const LABEL = 'com.local.ai-daily-checkin';
export const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const PROJECT_DIR = process.cwd();

/** 校验并规范化 HH:MM（允许 8:5 这种写法，统一补零） */
export function normalizeTime(input) {
  const m = String(input || '').trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseTime(t) {
  const [h, m] = t.split(':').map(Number);
  return { h, m };
}

/** 读取原始 config.json（不合并默认值，避免把大量默认项写回去） */
export function readRawConfig() {
  const file = path.join(PROJECT_DIR, 'config.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function getSchedule() {
  const raw = readRawConfig();
  const s = raw.schedule || {};
  return {
    time: normalizeTime(s.time) || '08:00',
    retryTime: normalizeTime(s.retryTime) || '12:30',
    randomDelayMinutes: Number.isFinite(Number(s.randomDelayMinutes)) ? Number(s.randomDelayMinutes) : 5,
  };
}

/**
 * 保存时间设置到 config.json。
 * patch 里只处理 time / retryTime / randomDelayMinutes，其它字段原样保留。
 */
export function saveSchedule(patch) {
  const raw = readRawConfig();
  const next = { ...(raw.schedule || {}) };

  if (patch.time !== undefined) {
    const t = normalizeTime(patch.time);
    if (!t) throw new Error(`主跑时间格式不对：${patch.time}（应为 HH:MM，例如 08:30）`);
    next.time = t;
  }
  if (patch.retryTime !== undefined) {
    if (patch.retryTime === null || patch.retryTime === '') {
      next.retryTime = '';
    } else {
      const t = normalizeTime(patch.retryTime);
      if (!t) throw new Error(`补跑时间格式不对：${patch.retryTime}（应为 HH:MM）`);
      next.retryTime = t;
    }
  }
  if (patch.randomDelayMinutes !== undefined) {
    const d = Number(patch.randomDelayMinutes);
    if (!Number.isFinite(d) || d < 0 || d > 120) throw new Error('随机延迟需在 0~120 分钟之间');
    next.randomDelayMinutes = Math.round(d);
  }

  raw.schedule = next;
  fs.writeFileSync(path.join(PROJECT_DIR, 'config.json'), JSON.stringify(raw, null, 2) + '\n', 'utf8');
  return getSchedule();
}

function intervalsXml({ time, retryTime }) {
  const blocks = [];
  const push = (t) => {
    const { h, m } = parseTime(t);
    blocks.push(`    <dict>\n      <key>Hour</key>\n      <integer>${h}</integer>\n      <key>Minute</key>\n      <integer>${m}</integer>\n    </dict>`);
  };
  push(time);
  if (retryTime) push(retryTime);
  return blocks.join('\n');
}

/** 按当前 config 生成每日定时的 plist（与 scripts/install-launchd.sh 保持同一模板） */
export function writeDailyPlist() {
  const sched = getSchedule();
  const home = os.homedir();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROJECT_DIR}/scripts/run-daily.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>StartCalendarInterval</key>
  <array>
${intervalsXml(sched)}
  </array>
  <key>RunAtLoad</key>
  <false/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key>
    <string>${home}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${PROJECT_DIR}/data/log/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${PROJECT_DIR}/data/log/launchd.err.log</string>
</dict>
</plist>
`;
  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, xml, 'utf8');
  return { plist: PLIST_PATH, ...sched };
}

/** 让 launchd 重新加载（先卸载再装载，失败重试一次） */
export async function reloadDailyAgent() {
  const uid = process.getuid();
  await exec('launchctl', ['bootout', `gui/${uid}/${LABEL}`]).catch(() => null);
  await new Promise((r) => setTimeout(r, 800));
  try {
    await exec('launchctl', ['bootstrap', `gui/${uid}`, PLIST_PATH]);
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    await exec('launchctl', ['bootstrap', `gui/${uid}`, PLIST_PATH]).catch(async () => {
      await exec('launchctl', ['kickstart', '-k', `gui/${uid}/${LABEL}`]).catch(() => null);
    });
  }
  return true;
}

/** 一站式：保存配置 + 重写 plist + 重新加载 */
export async function applySchedule(patch) {
  const sched = patch ? saveSchedule(patch) : getSchedule();
  writeDailyPlist();
  await reloadDailyAgent();
  return sched;
}

/** 读取 launchd 里实际生效的时间（用于校验，不是读配置文件） */
export async function readEffectiveSchedule() {
  try {
    const { stdout } = await exec('plutil', ['-convert', 'json', '-o', '-', PLIST_PATH]);
    const plist = JSON.parse(stdout);
    const intervals = plist.StartCalendarInterval || [];
    const rows = (Array.isArray(intervals) ? intervals : [intervals]).map((i) => `${String(i.Hour).padStart(2, '0')}:${String(i.Minute).padStart(2, '0')}`);
    return rows;
  } catch {
    return [];
  }
}
