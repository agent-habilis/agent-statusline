#!/usr/bin/env bun
// A powerline-style statusline for Claude Code, run as a single Bun process.
// Claude Code pipes the session JSON to stdin and renders this script's
// stdout (ANSI colors included) as the status line.

import * as fs from 'node:fs';

const HOME_DIRECTORY = process.env.HOME ?? '';

// Mirrors $PPID: the Claude Code process that spawned this script. The swarm,
// role, and room state files are keyed by it, so it must match the value those
// integrations recorded.
const claudeProcessId = String(process.ppid);

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
const greenBackground = '\x1b[48;2;158;206;106m';
const greenForeground = '\x1b[38;2;158;206;106m';
const purpleBackground = '\x1b[48;2;187;154;247m';
const purpleForeground = '\x1b[38;2;187;154;247m';
const darkPurpleBackground = '\x1b[48;2;157;124;216m';
const darkPurpleForeground = '\x1b[38;2;157;124;216m';
const tealBackground = '\x1b[48;2;115;218;202m';
const tealForeground = '\x1b[38;2;115;218;202m';
const darkTealBackground = '\x1b[48;2;82;170;156m';
const darkTealForeground = '\x1b[38;2;82;170;156m';
const cyanBackground = '\x1b[48;2;86;207;235m';
const cyanForeground = '\x1b[38;2;86;207;235m';
const darkCyanBackground = '\x1b[48;2;60;158;180m';
const darkCyanForeground = '\x1b[38;2;60;158;180m';
const pinkBackground = '\x1b[48;2;243;139;168m';
const pinkForeground = '\x1b[38;2;243;139;168m';

// ── Nerd Font icons ──────────────────────────────────────────────────
const brainIcon = '\u{f01a7}';
const memoryIcon = '\u{f035b}';
const directoryIcon = '\u{f0256}';
const branchIcon = '\u{f062c}';
const gaugeIcon = '\u{f029a}';
const gaugeLowIcon = '\u{f0298}';
const beehiveIcon = '\u{f10ce}';
const robotIcon = '\u{f06a9}';
const peopleIcon = '\u{f0849}';
const roleIcon = '\u{f05b5}';
const accountIcon = '\u{f0004}';

// ── Helpers ──────────────────────────────────────────────────────────
function readJsonFile(path: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readProcessField(field: string, processId: string): string {
  try {
    const output = Bun.spawnSync(['ps', '-o', `${field}=`, '-p', processId], { stderr: 'ignore' });
    return output.stdout.toString().trim();
  } catch {
    return '';
  }
}

// Locate the swarm state file the daemon launched without `--state-file`
// writes by default: `/tmp/agent-habilis/swarm/<swarm_prefix>/<nick>.state.json`.
// The filename is keyed by swarm+nick, not by PID, so find THIS session's file
// via the daemon process: the `ahsw` daemon is a descendant of the Claude Code
// process and holds its socket + tracing log open beside the state file in that
// same per-swarm directory (`<nick>.ipc.sock` / `<nick>.tracing.log`). Find the
// daemon under our process tree, read an open name off `lsof`, and swap the
// extension for `.state.json`. Best-effort: returns null if anything is missing
// or the session is not in a swarm (and skips `lsof` entirely in that case).
function findSwarmStatePath(processId: string): string | null {
  try {
    const psOutput = Bun.spawnSync(['ps', '-axo', 'pid=,ppid=,command='], { stderr: 'ignore' })
      .stdout.toString();
    const parentOf = new Map<string, string>();
    const ahswPids: string[] = [];
    for (const line of psOutput.split('\n')) {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) continue;
      const [, pid, ppid, command] = match;
      parentOf.set(pid, ppid);
      if (/(^|\/)ahsw\s/.test(command)) ahswPids.push(pid);
    }

    // An `ahsw` daemon is ours if the Claude Code process is an ancestor within
    // a few hops (claude → zsh → ahsw). Walk each candidate's parent chain up.
    let ahswPid = '';
    for (const candidate of ahswPids) {
      let ancestor = candidate;
      for (let depth = 0; depth < 4 && ancestor; depth++) {
        ancestor = parentOf.get(ancestor) ?? '';
        if (ancestor === processId) {
          ahswPid = candidate;
          break;
        }
      }
      if (ahswPid) break;
    }
    if (!ahswPid) return null;

    // The daemon holds its socket and tracing log open in the per-swarm
    // directory beside the state file, sharing the `<nick>` stem. `lsof -Fn`
    // prints each open name on an `n…` line; normalize macOS's `/private/tmp`
    // alias to `/tmp`, then derive the state file from the directory + stem.
    const lsofOutput = Bun.spawnSync(['lsof', '-p', ahswPid, '-Fn'], { stderr: 'ignore' })
      .stdout.toString();
    for (const line of lsofOutput.split('\n')) {
      if (!line.startsWith('n')) continue;
      const name = line.slice(1).replace(/^\/private\/tmp\//, '/tmp/');
      const match = name.match(
        /^(\/tmp\/agent-habilis\/swarm\/[^/]+)\/(.+)\.(?:ipc\.sock|tracing\.log)$/,
      );
      if (match) return `${match[1]}/${match[2]}.state.json`;
    }
    return null;
  } catch {
    return null;
  }
}

// Live member count for a /room room, via the plugin's public reader contract
// (plugins/room/AGENTS.md). `session-state.js --action list` applies the 90s
// heartbeat TTL, reaps stale entries, and counts self — none of which the
// filename layout exposes. That node spawn is ~50ms, far too slow for the many
// renders per second during streaming, so the result is cached per room+pid
// for ROOM_COUNT_TTL_SECONDS and the cache file is read on the hot path.
const ROOM_COUNT_TTL_SECONDS = 2;
const SESSION_STATE_SCRIPT =
  '/Users/caiogondim/Developer/upgrade/llm-context/plugins/room/src/session-state.js';
function readRoomMemberCount(roomName: string, roomRoot: string): number {
  const cacheDirectory = '/tmp/statusline-cache';
  const cacheFile = `${cacheDirectory}/room-${claudeProcessId}.count`;
  try {
    const cacheAgeSeconds = (Date.now() - fs.statSync(cacheFile).mtimeMs) / 1000;
    if (cacheAgeSeconds < ROOM_COUNT_TTL_SECONDS) {
      const cached = Number(fs.readFileSync(cacheFile, 'utf8').trim());
      if (Number.isFinite(cached)) return cached;
    }
  } catch {
    // No usable cache; fall through to a fresh count.
  }

  let memberCount = 0;
  try {
    const listResult = Bun.spawnSync(
      ['node', SESSION_STATE_SCRIPT, '--action', 'list', '--room', roomName, '--path', roomRoot],
      { stderr: 'ignore' },
    );
    // The CLI emits one JSON line per event; the peer roster is on the
    // `peers_listed` line.
    for (const line of listResult.stdout.toString().split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: any;
      try {
        event = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (event?.event === 'peers_listed' && Array.isArray(event.peers)) {
        memberCount = event.peers.length;
      }
    }
  } catch {
    memberCount = 0;
  }

  try {
    fs.mkdirSync(cacheDirectory, { recursive: true });
    fs.writeFileSync(cacheFile, String(memberCount));
  } catch {
    // Best-effort cache write; never let it break the statusline.
  }
  return memberCount;
}

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

const modelName = String(session?.model?.display_name ?? '...').replace(/ \([^)]*context\)/, '');
const contextPercent = Math.trunc(Number(session?.context_window?.used_percentage ?? 0));
const workspaceDirectory = String(session?.workspace?.current_dir ?? '...');
const fiveHourRatePercent = Math.trunc(Number(session?.rate_limits?.five_hour?.used_percentage ?? 0));
const sevenDayRatePercent = Math.trunc(Number(session?.rate_limits?.seven_day?.used_percentage ?? 0));
const currentDirectory = contractDirectory(workspaceDirectory);

// ── Segment: model + context usage (always shown) ────────────────────
const modelSegment = `${tealForeground}${pillLeft}${tealBackground}${darkForeground} ${brainIcon} ${modelName} ${reset}${tealForeground}${darkTealBackground}${pillRight}${reset}${darkTealBackground}${darkForeground} ${memoryIcon} ${contextPercent}% ${reset}${darkTealForeground}${pillRight}${reset}`;

// ── Segment: working directory ───────────────────────────────────────
const directorySegment = `${blueForeground}${pillLeft}${blueBackground}${darkForeground} ${directoryIcon} ${currentDirectory} ${reset}${blueForeground}${pillRight}${reset}`;

// ── Segment: rate limits ─────────────────────────────────────────────
const rateSegment = `${purpleForeground}${pillLeft}${purpleBackground}${darkForeground} ${gaugeIcon} 5h ${fiveHourRatePercent}% ${reset}${purpleForeground}${darkPurpleBackground}${pillRight}${reset}${darkPurpleBackground}${darkForeground} ${gaugeLowIcon} 7d ${sevenDayRatePercent}% ${reset}${darkPurpleForeground}${pillRight}${reset}`;

// ── Segment: git branch (only inside a repo) ─────────────────────────
let gitSegment = '';
try {
  const repoProbe = Bun.spawnSync(['git', 'rev-parse', '--git-dir'], { stdout: 'ignore', stderr: 'ignore' });
  if (repoProbe.exitCode === 0) {
    const branchResult = Bun.spawnSync(['git', 'branch', '--show-current'], { stderr: 'ignore' });
    const branchName = branchResult.stdout.toString().trim();
    gitSegment = `${greenForeground}${pillLeft}${greenBackground}${darkForeground} ${branchIcon} ${branchName} ${reset}${greenForeground}${pillRight}${reset}`;
  }
} catch {
  gitSegment = '';
}

// ── Segment: swarm membership ────────────────────────────────────────
// The agent-habilis-swarm daemon is the sole writer of its state file; the
// /swarm:* skills only read it. The daemon refreshes last_updated every
// STATE_REFRESH_SECS (~10s) even when membership is unchanged, so a fresh
// timestamp doubles as a liveness signal. The staleness window below is kept
// at ~3x that cadence and is coupled to STATE_REFRESH_SECS in
// agent-habilis-swarm's src/util/tuning.rs.
//
// Two launch styles exist: a daemon started with `--state-file
// .../sessions/${PPID}.json` writes that per-session path (cheap to read by
// our own PPID), while one started without it writes a default
// `.../<swarm_prefix>/<nick>.state.json`. Prefer the PPID file, then fall back
// to locating the default file via the daemon process (findSwarmStatePath).
const SWARM_STALENESS_SECONDS = 30;
let swarmSegment = '';
let swarmState = readJsonFile(`/tmp/agent-habilis/swarm/sessions/${claudeProcessId}.json`);
if (!swarmState) {
  const defaultPath = findSwarmStatePath(claudeProcessId);
  if (defaultPath) swarmState = readJsonFile(defaultPath);
}
if (swarmState) {
  const swarmNickname = String(swarmState.nickname ?? '');
  const swarmName = String(swarmState.name ?? '');
  const swarmPeerCount = Number(swarmState.participant_count ?? 0);
  const swarmLastUpdated = Number(swarmState.last_updated ?? 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const swarmIsAlive = swarmLastUpdated > 0 && nowSeconds - swarmLastUpdated < SWARM_STALENESS_SECONDS;
  if (swarmNickname && swarmName && swarmIsAlive) {
    swarmSegment = `${yellowForeground}${pillLeft}${yellowBackground}${darkForeground} ${robotIcon} ${swarmNickname} ${reset}${yellowForeground}${darkYellowBackground}${pillRight}${reset}${darkYellowBackground}${darkForeground} ${beehiveIcon} ${swarmName} ${swarmPeerCount} ${reset}${darkYellowForeground}${pillRight}${reset}`;
  }
}

// ── Segment: role ────────────────────────────────────────────────────
let roleSegment = '';
const roleState = readJsonFile('/tmp/agent-role/state.json');
if (roleState && claudeProcessId) {
  const currentRole = String(roleState?.[claudeProcessId]?.role ?? '');
  if (currentRole) {
    roleSegment = `${pinkForeground}${pillLeft}${pinkBackground}${darkForeground} ${roleIcon} ${currentRole} ${reset}${pinkForeground}${pillRight}${reset}`;
  }
}

// ── Segment: room membership ─────────────────────────────────────────
// Reader contract is plugins/room/AGENTS.md "Public reader contract": the
// sessions/ directory is stable, but the filename grammar (host-pid-monitor)
// is NOT — find this session's file by reading each candidate and matching
// payload.pid, not by parsing the name. Accept any payload v of 1.x. Member
// count comes from `--action list`, which applies the 90s heartbeat TTL,
// reaps stale entries, and counts self. The node spawn is ~50ms, so the
// count is cached for ROOM_COUNT_TTL_SECONDS and the cache file is the only
// thing touched on most renders.
let roomState: any | null = null;
try {
  outer: for (const roomDirectory of fs.readdirSync('/tmp/room-skill')) {
    const sessionsDirectory = `/tmp/room-skill/${roomDirectory}/sessions`;
    let sessionFiles: string[] = [];
    try {
      sessionFiles = fs.readdirSync(sessionsDirectory);
    } catch {
      continue;
    }
    for (const sessionFile of sessionFiles) {
      if (!sessionFile.endsWith('.json')) continue;
      const candidate = readJsonFile(`${sessionsDirectory}/${sessionFile}`);
      if (candidate && String(candidate.pid ?? '') === claudeProcessId) {
        roomState = candidate;
        break outer;
      }
    }
  }
} catch {
  roomState = null;
}

let roomSegment = '';
if (roomState) {
  const roomVersion = String(roomState?.v ?? '');
  const roomName = String(roomState?.room ?? '');
  const roomNickname = String(roomState?.nickname ?? '');
  const roomRoot = String(roomState?.room_root ?? '');
  if (/^1\./.test(roomVersion) && roomName && roomNickname && roomRoot) {
    const memberCount = readRoomMemberCount(roomName, roomRoot);
    roomSegment = `${cyanForeground}${pillLeft}${cyanBackground}${darkForeground} ${accountIcon} ${roomNickname} ${reset}${cyanForeground}${darkCyanBackground}${pillRight}${reset}${darkCyanBackground}${darkForeground} ${peopleIcon} ${memberCount} ${roomName} ${reset}${darkCyanForeground}${pillRight}${reset}`;
  }
}

// ── Terminal width ───────────────────────────────────────────────────
// Claude Code runs the statusline without a controlling terminal, so $COLUMNS
// / tput / /dev/tty are all unavailable here. Claude Code itself does own a
// tty, though, so walk up the process tree to find an ancestor's tty and read
// its viewport width from there. $STATUSLINE_DEBUG_COLS overrides this for
// tests.
const PROCESS_TREE_DEPTH = 6;
const FALLBACK_COLUMNS = 120;
// Claude Code reserves a right-edge gutter for its own UI chrome, so the
// paintable area is narrower than the pty width; subtracting this matches the
// observed clipping point in Ghostty.
const GUTTER_COLUMNS = 4;
const MINIMUM_COLUMNS = 20;

let columns = process.env.STATUSLINE_DEBUG_COLS ?? '';
let columnsSource = 'env';
let columnsTty = '';
if (!columns) {
  columnsSource = 'fallback';
  let ancestorPid = String(process.ppid);
  for (let depth = 0; depth < PROCESS_TREE_DEPTH; depth++) {
    const ttyName = readProcessField('tty', ancestorPid);
    if (ttyName && ttyName !== '?' && ttyName !== '??' && fs.existsSync(`/dev/${ttyName}`)) {
      try {
        const sttyResult = Bun.spawnSync(['sh', '-c', `stty size < /dev/${ttyName} 2>/dev/null`], {
          stderr: 'ignore',
        });
        const reportedColumns = sttyResult.stdout.toString().trim().split(/\s+/)[1];
        if (reportedColumns) {
          columns = reportedColumns;
          columnsSource = 'tty';
          columnsTty = `/dev/${ttyName}`;
          break;
        }
      } catch {
        // Fall through to the parent process.
      }
    }
    ancestorPid = readProcessField('ppid', ancestorPid);
    if (!ancestorPid || Number(ancestorPid) <= 1) break;
  }
}

let availableColumns = Number(columns);
if (!columns || !(availableColumns > 0)) {
  availableColumns = FALLBACK_COLUMNS;
  columnsSource = 'fallback';
}
availableColumns = Math.max(availableColumns - GUTTER_COLUMNS, MINIMUM_COLUMNS);

// ── Render: fit segments to the available width ──────────────────────
// The directory segment is always shown first; the rest are appended greedily
// and dropped once the next one would overflow. Widths count Unicode
// codepoints after stripping ANSI, since Nerd Font / Powerline glyphs render
// single-width in modern terminals.
const segments = [
  { name: 'dir', value: directorySegment },
  { name: 'model', value: modelSegment },
  { name: 'rate', value: rateSegment },
  { name: 'role', value: roleSegment },
  { name: 'swarm', value: swarmSegment },
  { name: 'room', value: roomSegment },
  { name: 'git', value: gitSegment },
];
// On a swarm, promote the swarm pill to the leftmost position.
if (swarmSegment) {
  const swarmIndex = segments.findIndex((s) => s.name === 'swarm');
  segments.unshift(segments.splice(swarmIndex, 1)[0]);
}
const segmentNames = segments.map((s) => s.name);
const segmentValues = segments.map((s) => s.value);
const segmentWidths = segmentValues.map(printableWidth);
const segmentStripped = segmentValues.map(stripAnsi);

let renderedLine = segmentValues[0];
let usedWidth = segmentWidths[0];
const includedSegments = [segmentNames[0]];
const droppedSegments: string[] = [];
const SEPARATOR_WIDTH = 1;
for (let index = 1; index < segmentValues.length; index++) {
  const segment = segmentValues[index];
  if (!segment) continue;
  const segmentWidth = segmentWidths[index];
  if (usedWidth + SEPARATOR_WIDTH + segmentWidth <= availableColumns) {
    renderedLine = `${renderedLine} ${segment}`;
    usedWidth += SEPARATOR_WIDTH + segmentWidth;
    includedSegments.push(segmentNames[index]);
  } else {
    droppedSegments.push(segmentNames[index]);
    break;
  }
}

console.log(renderedLine);

// ── Diagnostic logging (gated behind STATUSLINE_DEBUG) ───────────────
// One JSON record per render, for investigating width / column mismatches.
if (process.env.STATUSLINE_DEBUG) {
  const debugLogPath = process.env.STATUSLINE_DEBUG_LOG ?? '/tmp/statusline-debug.log';
  const record = {
    ts: Date.now(),
    cols: availableColumns,
    cols_source: columnsSource,
    cols_tty: columnsTty === '' ? null : columnsTty,
    total: usedWidth,
    included: includedSegments,
    dropped: droppedSegments,
    segs: segmentNames.map((name, index) => ({
      name,
      width: segmentWidths[index],
      rendered: segmentStripped[index],
    })),
  };
  try {
    fs.appendFileSync(debugLogPath, `${JSON.stringify(record)}\n`);
  } catch {
    // Best-effort logging; never let it break the statusline.
  }
}
