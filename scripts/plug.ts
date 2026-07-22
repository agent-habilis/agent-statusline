#!/usr/bin/env bun
// plug.ts — symlink claude-statusline.ts into ~/.claude/ and register the
// statusLine config in ~/.claude/settings.json; symlink pi-statusline.ts
// into the pi extensions directory.
import * as fs from 'node:fs';

const REPO = decodeURIComponent(new URL('../', import.meta.url).pathname);
const SRC = `${REPO}src/claude-statusline.ts`;
const CLAUDE_DIR = `${process.env.HOME}/.claude`;
const DST = `${CLAUDE_DIR}/claude-statusline.ts`;
const SETTINGS = `${CLAUDE_DIR}/settings.json`;
const PI_SRC = `${REPO}src/pi-statusline.ts`;
const PI_EXTENSIONS_DIR = `${process.env.HOME}/.pi/agent/extensions`;
const PI_DST = `${PI_EXTENSIONS_DIR}/statusline.ts`;

const STATUSLINE = { type: 'command', command: '~/.claude/claude-statusline.ts', padding: 0 };

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
    console.log(`Backed up existing claude-statusline.ts to ${backup}`);
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

// Clean up legacy symlinks: statusline.sh from before the Bun rewrite, and
// statusline.ts from before this script was renamed claude-statusline.ts.
for (const legacy of [`${CLAUDE_DIR}/statusline.sh`, `${CLAUDE_DIR}/statusline.ts`]) {
  try {
    if (fs.lstatSync(legacy).isSymbolicLink()) {
      fs.unlinkSync(legacy);
      console.log(`Removed legacy symlink ${legacy}`);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Add statusLine config to settings.json.
const file = Bun.file(SETTINGS);
const cfg = (await file.exists()) ? await file.json() : {};
cfg.statusLine = STATUSLINE;
await Bun.write(SETTINGS, `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`Updated ${SETTINGS} with statusLine config`);

// ── pi ───────────────────────────────────────────────────────────────
fs.mkdirSync(PI_EXTENSIONS_DIR, { recursive: true });

// Back up an existing real file (not a symlink) before we replace it.
try {
  const stat = fs.lstatSync(PI_DST);
  if (!stat.isSymbolicLink()) {
    const backup = `${PI_DST}.bak.${timestamp()}`;
    fs.copyFileSync(PI_DST, backup);
    console.log(`Backed up existing statusline.ts to ${backup}`);
  }
} catch (err: any) {
  if (err.code !== 'ENOENT') throw err;
}

// Create (or replace) the symlink.
try {
  fs.unlinkSync(PI_DST);
} catch (err: any) {
  if (err.code !== 'ENOENT') throw err;
}
fs.symlinkSync(PI_SRC, PI_DST);
console.log(`Symlinked ${PI_DST} -> ${PI_SRC}`);

console.log(
  '\nDone! Statusline will appear on your next Claude Code interaction; run /reload in pi.',
);
