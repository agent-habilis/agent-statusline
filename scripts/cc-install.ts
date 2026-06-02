#!/usr/bin/env bun
// cc-install.ts — symlink statusline.sh into ~/.claude/ and register the
// statusLine config in ~/.claude/settings.json.
import * as fs from 'node:fs';

const REPO = decodeURIComponent(new URL('../', import.meta.url).pathname);
const SRC = `${REPO}statusline.sh`;
const CLAUDE_DIR = `${process.env.HOME}/.claude`;
const DST = `${CLAUDE_DIR}/statusline.sh`;
const SETTINGS = `${CLAUDE_DIR}/settings.json`;

const STATUSLINE = { type: 'command', command: '~/.claude/statusline.sh', padding: 0 };

function timestamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Create ~/.claude/ if it doesn't exist.
fs.mkdirSync(CLAUDE_DIR, { recursive: true });

// Back up an existing real file (not a symlink) before we replace it.
try {
  const stat = fs.lstatSync(DST);
  if (!stat.isSymbolicLink()) {
    const backup = `${DST}.bak.${timestamp()}`;
    fs.copyFileSync(DST, backup);
    console.log(`Backed up existing statusline.sh to ${backup}`);
  }
} catch (err: any) {
  if (err.code !== 'ENOENT') throw err;
}

// Ensure the source script is executable.
fs.chmodSync(SRC, 0o755);

// Create (or replace) the symlink.
try {
  fs.unlinkSync(DST);
} catch (err: any) {
  if (err.code !== 'ENOENT') throw err;
}
fs.symlinkSync(SRC, DST);
console.log(`Symlinked ${DST} -> ${SRC}`);

// Add statusLine config to settings.json.
const file = Bun.file(SETTINGS);
const cfg = (await file.exists()) ? await file.json() : {};
cfg.statusLine = STATUSLINE;
await Bun.write(SETTINGS, `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`Updated ${SETTINGS} with statusLine config`);

console.log('\nDone! Statusline will appear on your next Claude Code interaction.');
