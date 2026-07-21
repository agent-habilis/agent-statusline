#!/usr/bin/env bun
// A powerline-style statusline for Cursor Agent CLI, run as a single Bun
// process. Registered via the `statusLine` key in ~/.cursor/cli-config.json;
// cursor-agent pipes a Claude-Code-compatible session JSON to stdin and
// renders this script's stdout (ANSI colors included) in the composer bar.

import * as fs from 'node:fs';

const HOME_DIRECTORY = process.env.HOME ?? '';

// ── Powerline glyphs ─────────────────────────────────────────────────
const pillLeft = '\u{e0b6}';
const pillRight = '\u{e0b4}';

// ── Colors ───────────────────────────────────────────────────────────
const darkForeground = '\x1b[38;2;26;27;38m';
const reset = '\x1b[0m';

const yellowBackground = '\x1b[48;2;224;175;104m';
const yellowForeground = '\x1b[38;2;224;175;104m';
const darkYellowBackground = '\x1b[48;2;178;140;83m';
const darkYellowForeground = '\x1b[38;2;178;140;83m';
const blueBackground = '\x1b[48;2;118;159;240m';
const blueForeground = '\x1b[38;2;118;159;240m';
const purpleBackground = '\x1b[48;2;187;154;247m';
const purpleForeground = '\x1b[38;2;187;154;247m';
const darkPurpleBackground = '\x1b[48;2;157;124;216m';
const darkPurpleForeground = '\x1b[38;2;157;124;216m';
const greenBackground = '\x1b[48;2;158;206;106m';
const greenForeground = '\x1b[38;2;158;206;106m';
const tealBackground = '\x1b[48;2;115;218;202m';
const tealForeground = '\x1b[38;2;115;218;202m';
const darkTealBackground = '\x1b[48;2;82;170;156m';
const darkTealForeground = '\x1b[38;2;82;170;156m';

// ── Nerd Font icons ──────────────────────────────────────────────────
const brainIcon = '\u{f01a7}';
const memoryIcon = '\u{f035b}';
const directoryIcon = '\u{f0256}';
const branchIcon = '\u{f062c}';
const chatIcon = '\u{f0ede}';
const robotIcon = '\u{f167a}';

// ── Helpers ──────────────────────────────────────────────────────────
// Fish-style contraction: every parent directory shrinks to its first
// character (two for dotfiles, so `.config` stays distinguishable), while the
// leaf keeps its full name.
function contractDirectory(directory: string): string {
  if (directory === '...' || directory === '/') return directory;
  if (directory === HOME_DIRECTORY) return '~';
  const withHomeTilde =
    HOME_DIRECTORY && directory.startsWith(`${HOME_DIRECTORY}/`)
      ? `~/${directory.slice(HOME_DIRECTORY.length + 1)}`
      : directory;
  const pathParts = withHomeTilde.split('/');
  const lastIndex = pathParts.length - 1;
  let contracted = '';
  pathParts.forEach((pathPart, index) => {
    let segment: string;
    if (index === lastIndex || pathPart === '') segment = pathPart;
    else if (/^\..+/.test(pathPart)) segment = pathPart.slice(0, 2);
    else segment = pathPart.slice(0, 1);
    contracted = index === 0 ? segment : `${contracted}/${segment}`;
  });
  return contracted;
}

function readJsonFile(path: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// The agent-gossip runtime base is a fixed function of the uid alone (matches
// runtime_base() in agent-gossip's crates/agent-habilis-mesh/src/util/mod.rs),
// so this render process computes the same path as the daemon regardless of
// environment.
const gossipRuntimeBase = `/tmp/agent-gossip-${process.getuid?.() ?? ''}`;

// Locate this session's gossip state, mirroring statusline.ts but without
// trusting process.ppid: cursor-agent may spawn this script through a shell,
// so the cursor-agent process is some ancestor, not necessarily the direct
// parent. One `ps` pass gives both our ancestor chain and the daemon list.
//
// Two launch styles exist: a daemon started with `--state-file
// .../sessions/<pid>.json` (what the skills do, keyed by the harness pid)
// writes that per-session path — try it for every ancestor. One started
// without it writes a default `<gossip_prefix>/<nick>.state.json`; find it
// via the daemon process, which is a descendant of the harness process and
// holds its socket + tracing log open beside the state file
// (`<nick>.ipc.sock` / `<nick>.tracing.log`). Best-effort: returns null if
// anything is missing or the session is not in a gossip.
function findGossipState(): any | null {
  try {
    const psOutput = Bun.spawnSync(['ps', '-axo', 'pid=,ppid=,command='], { stderr: 'ignore' })
      .stdout.toString();
    const parentOf = new Map<string, string>();
    const daemonPids: string[] = [];
    for (const line of psOutput.split('\n')) {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) continue;
      const [, pid, ppid, command] = match;
      parentOf.set(pid, ppid);
      if (/(^|\/)agent-gossip\s/.test(command)) daemonPids.push(pid);
    }

    const ancestorPids = new Set<string>();
    let ancestor = String(process.pid);
    for (let depth = 0; depth < 8 && ancestor && Number(ancestor) > 1; depth++) {
      ancestorPids.add(ancestor);
      ancestor = parentOf.get(ancestor) ?? '';
    }

    for (const pid of ancestorPids) {
      const state = readJsonFile(`${gossipRuntimeBase}/sessions/${pid}.json`);
      if (state) return state;
    }

    // An `agent-gossip` daemon is ours if one of our ancestors is also an
    // ancestor of the daemon within a few hops (cursor-agent → zsh →
    // agent-gossip). Walk each candidate's parent chain up.
    let daemonPid = '';
    for (const candidate of daemonPids) {
      let daemonAncestor = candidate;
      for (let depth = 0; depth < 4 && daemonAncestor; depth++) {
        daemonAncestor = parentOf.get(daemonAncestor) ?? '';
        if (ancestorPids.has(daemonAncestor)) {
          daemonPid = candidate;
          break;
        }
      }
      if (daemonPid) break;
    }
    if (!daemonPid) return null;

    // `lsof -Fn` prints each open name on an `n…` line; normalize macOS's
    // `/private/tmp` alias to `/tmp`, then derive the state file from the
    // directory + `<nick>` stem.
    const lsofOutput = Bun.spawnSync(['lsof', '-p', daemonPid, '-Fn'], { stderr: 'ignore' })
      .stdout.toString();
    const stateSiblingPattern = new RegExp(
      `^(${gossipRuntimeBase}/[^/]+)/(.+)\\.(?:ipc\\.sock|tracing\\.log)$`,
    );
    for (const line of lsofOutput.split('\n')) {
      if (!line.startsWith('n')) continue;
      const name = line.slice(1).replace(/^\/private\/tmp\//, '/tmp/');
      const match = name.match(stateSiblingPattern);
      if (match) return readJsonFile(`${match[1]}/${match[2]}.state.json`);
    }
    return null;
  } catch {
    return null;
  }
}

// Humanized token counts so the pill stays narrow: 999, 12k, 1.2M.
function formatTokens(count: number): string {
  if (!(count > 0)) return '0';
  if (count < 1000) return String(count);
  for (const [unit, size] of [['M', 1_000_000], ['k', 1_000]] as const) {
    if (count >= size) {
      const scaled = count / size;
      return `${scaled < 10 ? Math.trunc(scaled * 10) / 10 : Math.trunc(scaled)}${unit}`;
    }
  }
  return String(count);
}

const ansiEscapePattern = /\x1b\[[0-9;]*m/g;
const stripAnsi = (text: string): string => text.replace(ansiEscapePattern, '');
const printableWidth = (text: string): number => Array.from(stripAnsi(text)).length;

// ── Input ────────────────────────────────────────────────────────────
let session: any = {};
try {
  session = JSON.parse(await Bun.stdin.text());
} catch {
  session = {};
}

const modelName = String(session?.model?.display_name ?? session?.model?.id ?? '...');
const contextPercent = Math.trunc(Number(session?.context_window?.used_percentage ?? 0));
// Input is estimated by the CLI (used% × window size); output is actual.
const inputTokens = formatTokens(Number(session?.context_window?.total_input_tokens ?? 0));
const outputTokens = formatTokens(Number(session?.context_window?.total_output_tokens ?? 0));
const workspaceDirectory = String(session?.workspace?.current_dir ?? '...');
const currentDirectory = contractDirectory(workspaceDirectory);

// ── Segment: model + context usage (always shown) ────────────────────
const modelSegment = `${tealForeground}${pillLeft}${tealBackground}${darkForeground} ${brainIcon} ${modelName} ${reset}${tealForeground}${darkTealBackground}${pillRight}${reset}${darkTealBackground}${darkForeground} ${memoryIcon} ${contextPercent}% ${reset}${darkTealForeground}${pillRight}${reset}`;

// ── Segment: session tokens ──────────────────────────────────────────
// pi-statusline's session pill: input on the light shade, output on the dark.
const tokensSegment = `${purpleForeground}${pillLeft}${purpleBackground}${darkForeground} ▽ ${inputTokens} ${reset}${purpleForeground}${darkPurpleBackground}${pillRight}${reset}${darkPurpleBackground}${darkForeground} △ ${outputTokens} ${reset}${darkPurpleForeground}${pillRight}${reset}`;

// ── Segment: working directory ───────────────────────────────────────
const directorySegment = `${blueForeground}${pillLeft}${blueBackground}${darkForeground} ${directoryIcon} ${currentDirectory} ${reset}${blueForeground}${pillRight}${reset}`;

// ── Segment: git branch (only inside a repo) ─────────────────────────
// Run git in the session's workspace, not this script's cwd, so the branch
// tracks the directory cursor-agent is working in.
let gitSegment = '';
try {
  const repoProbe = Bun.spawnSync(['git', 'rev-parse', '--git-dir'], {
    cwd: workspaceDirectory,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  if (repoProbe.exitCode === 0) {
    const branchResult = Bun.spawnSync(['git', 'branch', '--show-current'], {
      cwd: workspaceDirectory,
      stderr: 'ignore',
    });
    const branchName = branchResult.stdout.toString().trim();
    gitSegment = `${greenForeground}${pillLeft}${greenBackground}${darkForeground} ${branchIcon} ${branchName} ${reset}${greenForeground}${pillRight}${reset}`;
  }
} catch {
  gitSegment = '';
}

// ── Segment: gossip membership ───────────────────────────────────────
// The agent-gossip daemon is the sole writer of its state file and refreshes
// last_updated every ~10s even when membership is unchanged, so a fresh
// timestamp doubles as a liveness signal; the staleness window is ~3x that
// cadence. `ready` is false until the daemon's event loop is serving IPC.
const GOSSIP_STALENESS_SECONDS = 30;
let gossipSegment = '';
const gossipState = findGossipState();
if (gossipState) {
  const gossipNickname = String(gossipState.nickname ?? '');
  const gossipName = String(gossipState.name ?? '');
  // The daemon renamed `participant_count` to `peer_count`; keep the old
  // name as a fallback for daemons still on the previous binary.
  const gossipPeerCount = Number(gossipState.peer_count ?? gossipState.participant_count ?? 0);
  const gossipLastUpdated = Number(gossipState.last_updated ?? 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const gossipIsAlive =
    gossipLastUpdated > 0 && nowSeconds - gossipLastUpdated < GOSSIP_STALENESS_SECONDS;
  if (gossipNickname && gossipName && gossipIsAlive && gossipState.ready !== false) {
    gossipSegment = `${yellowForeground}${pillLeft}${yellowBackground}${darkForeground} ${robotIcon} ${gossipNickname} ${reset}${yellowForeground}${darkYellowBackground}${pillRight}${reset}${darkYellowBackground}${darkForeground} ${chatIcon} ${gossipName} ${gossipPeerCount} ${reset}${darkYellowForeground}${pillRight}${reset}`;
  }
}

// ── Render: fit segments to the available width ──────────────────────
// The first segment is always shown; the rest are appended greedily
// and dropped once the next one would overflow. cursor-agent reports the
// rendering width directly via render_width_chars.
const FALLBACK_COLUMNS = 120;
let availableColumns = Number(session?.render_width_chars);
if (!(availableColumns > 0)) availableColumns = FALLBACK_COLUMNS;

// In a gossip session, the gossip pill takes the leftmost slot.
const segments = gossipSegment
  ? [gossipSegment, modelSegment, tokensSegment, directorySegment, gitSegment]
  : [modelSegment, tokensSegment, directorySegment, gitSegment];
let renderedLine = segments[0];
let usedWidth = printableWidth(segments[0]);
const SEPARATOR_WIDTH = 1;
for (let index = 1; index < segments.length; index++) {
  const segment = segments[index];
  if (!segment) continue;
  const segmentWidth = printableWidth(segment);
  if (usedWidth + SEPARATOR_WIDTH + segmentWidth <= availableColumns) {
    renderedLine = `${renderedLine} ${segment}`;
    usedWidth += SEPARATOR_WIDTH + segmentWidth;
  } else {
    break;
  }
}

console.log(renderedLine);
