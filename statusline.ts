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
const orangeBackground = '\x1b[48;2;255;158;100m';
const orangeForeground = '\x1b[38;2;255;158;100m';
const darkOrangeBackground = '\x1b[48;2;200;120;65m';
const darkOrangeForeground = '\x1b[38;2;200;120;65m';
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
const voiceIcon = '\u{f05cb}';
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
const modelSegment = `${yellowForeground}${pillLeft}${yellowBackground}${darkForeground} ${brainIcon} ${modelName} ${reset}${yellowForeground}${darkYellowBackground}${pillRight}${reset}${darkYellowBackground}${darkForeground} ${memoryIcon} ${contextPercent}% ${reset}${darkYellowForeground}${pillRight}${reset}`;

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
// The agent-habilis-swarm daemon is the sole writer of this per-session file;
// the /swarm:* skills only read it. The daemon refreshes last_updated every
// STATE_REFRESH_SECS (~10s) even when membership is unchanged, so a fresh
// timestamp doubles as a liveness signal. The staleness window below is kept
// at ~3x that cadence and is coupled to STATE_REFRESH_SECS in
// agent-habilis-swarm's src/util/tuning.rs.
const SWARM_STALENESS_SECONDS = 30;
let swarmSegment = '';
const swarmState = readJsonFile(`/tmp/agent-habilis/swarm/sessions/${claudeProcessId}.json`);
if (swarmState) {
  const swarmNickname = String(swarmState.nickname ?? '');
  const swarmName = String(swarmState.name ?? '');
  const swarmPeerCount = Number(swarmState.participant_count ?? 0);
  const swarmLastUpdated = Number(swarmState.last_updated ?? 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const swarmIsAlive = swarmLastUpdated > 0 && nowSeconds - swarmLastUpdated < SWARM_STALENESS_SECONDS;
  if (swarmNickname && swarmName && swarmIsAlive) {
    swarmSegment = `${orangeForeground}${pillLeft}${orangeBackground}${darkForeground} ${voiceIcon} ${swarmNickname} ${reset}${orangeForeground}${darkOrangeBackground}${pillRight}${reset}${darkOrangeBackground}${darkForeground} ${peopleIcon} ${swarmName} ${swarmPeerCount} ${reset}${darkOrangeForeground}${pillRight}${reset}`;
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
// The /room plugin writes one file per session under each room's sessions
// directory and reaps stale ones every 30s, so the number of sibling files
// (minus self) is a reliable live peer count.
let roomStateFile = '';
try {
  for (const roomDirectory of fs.readdirSync('/tmp/room-skill')) {
    const candidatePath = `/tmp/room-skill/${roomDirectory}/sessions/${claudeProcessId}.json`;
    if (fs.existsSync(candidatePath)) {
      roomStateFile = candidatePath;
      break;
    }
  }
} catch {
  roomStateFile = '';
}

let roomSegment = '';
if (roomStateFile) {
  const roomState = readJsonFile(roomStateFile);
  const roomName = String(roomState?.room ?? '');
  const roomNickname = String(roomState?.nickname ?? '');
  const roomRoot = String(roomState?.room_root ?? '');
  if (roomName && roomNickname && roomRoot) {
    let peerCount = 0;
    try {
      peerCount = fs
        .readdirSync(`${roomRoot}/${roomName}/sessions/`)
        .filter((fileName) => fileName !== `${claudeProcessId}.json`).length;
    } catch {
      peerCount = 0;
    }
    roomSegment = `${cyanForeground}${pillLeft}${cyanBackground}${darkForeground} ${accountIcon} ${roomNickname} ${reset}${cyanForeground}${darkCyanBackground}${pillRight}${reset}${darkCyanBackground}${darkForeground} ${peopleIcon} ${peerCount} ${roomName} ${reset}${darkCyanForeground}${pillRight}${reset}`;
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
const segmentNames = ['dir', 'model', 'rate', 'role', 'swarm', 'room', 'git'];
const segmentValues = [directorySegment, modelSegment, rateSegment, roleSegment, swarmSegment, roomSegment, gitSegment];
const segmentWidths = segmentValues.map(printableWidth);
const segmentStripped = segmentValues.map(stripAnsi);

let renderedLine = directorySegment;
let usedWidth = segmentWidths[0];
const includedSegments = ['dir'];
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
