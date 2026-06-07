#!/usr/bin/env bun
// cc-uninstall.ts — remove the statusline.sh symlink and the statusLine config
// from ~/.claude/settings.json.
import * as fs from 'node:fs';

const CLAUDE_DIR = `${process.env.HOME}/.claude`;
const DST = `${CLAUDE_DIR}/statusline.sh`;
const SETTINGS = `${CLAUDE_DIR}/settings.json`;

// Remove the symlink (only if it is a symlink).
try {
  const stat = fs.lstatSync(DST);
  if (stat.isSymbolicLink()) {
    fs.unlinkSync(DST);
    console.log(`Removed symlink ${DST}`);
  } else {
    console.log(`${DST} is not a symlink, skipping removal`);
  }
} catch (err: any) {
  if (err.code !== 'ENOENT') throw err;
}

// Remove the statusLine key from settings.json.
const file = Bun.file(SETTINGS);
if (await file.exists()) {
  const cfg = await file.json();
  delete cfg.statusLine;
  await Bun.write(SETTINGS, `${JSON.stringify(cfg, null, 2)}\n`);
  console.log(`Removed statusLine config from ${SETTINGS}`);
}

console.log('\nDone! Statusline has been removed.');
