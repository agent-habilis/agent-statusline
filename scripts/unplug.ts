#!/usr/bin/env bun
// unplug.ts — remove the claude-statusline.ts symlink and the statusLine
// config from ~/.claude/settings.json, and the pi extensions symlink.
import * as fs from 'node:fs';

const CLAUDE_DIR = `${process.env.HOME}/.claude`;
const DST = `${CLAUDE_DIR}/claude-statusline.ts`;
const SETTINGS = `${CLAUDE_DIR}/settings.json`;
const PI_DST = `${process.env.HOME}/.pi/agent/extensions/statusline.ts`;

// Remove the symlink (only if it is a symlink). Also clean up the legacy
// statusline.sh symlink from before the Bun rewrite and the statusline.ts one
// from before this script was renamed claude-statusline.ts.
for (const path of [
  DST,
  `${CLAUDE_DIR}/statusline.sh`,
  `${CLAUDE_DIR}/statusline.ts`,
  PI_DST,
]) {
  try {
    const stat = fs.lstatSync(path);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(path);
      console.log(`Removed symlink ${path}`);
    } else {
      console.log(`${path} is not a symlink, skipping removal`);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
}

// Remove the statusLine key from settings.json.
const file = Bun.file(SETTINGS);
if (await file.exists()) {
  const cfg = await file.json();
  delete cfg.statusLine;
  await Bun.write(SETTINGS, `${JSON.stringify(cfg, null, 2)}\n`);
  console.log(`Removed statusLine config from ${SETTINGS}`);
}

console.log('\nDone! Statusline has been removed; run /reload in pi.');
