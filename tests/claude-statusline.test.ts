// Black-box tests for the Claude Code statusline: spawn the real script with a
// controlled env and a session payload on stdin, then assert on what it renders.
// The env must be controlled explicitly because the model-name resolution reads
// ANTHROPIC_DEFAULT_* — inheriting the developer's own Bedrock config would make
// these results depend on whose machine they run on.
import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';

const SCRIPT = new URL('../src/claude-statusline.ts', import.meta.url).pathname;

const brainIcon = '\u{f01a7}';
const pillRight = '\u{e0b4}';

const OPUS_ARN = 'arn:aws:bedrock:us-east-1:111122223333:application-inference-profile/aaaaaaaaaaaa';
const SONNET_ARN = 'arn:aws:bedrock:us-east-1:111122223333:application-inference-profile/bbbbbbbbbbbb';
const HAIKU_ARN = 'arn:aws:bedrock:us-east-1:111122223333:application-inference-profile/cccccccccccc';

const BEDROCK_ENV = {
  ANTHROPIC_DEFAULT_OPUS_MODEL: OPUS_ARN,
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'Opus 5',
  ANTHROPIC_DEFAULT_SONNET_MODEL: SONNET_ARN,
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'Sonnet 5',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: HAIKU_ARN,
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: 'Haiku 4.5',
};

function render(session: unknown, env: Record<string, string> = {}): string {
  const result = Bun.spawnSync(['bun', 'run', SCRIPT], {
    stdin: Buffer.from(JSON.stringify(session)),
    stderr: 'pipe',
    // A fixed env, not process.env: keeps ANTHROPIC_DEFAULT_* out unless a test
    // opts in. PATH is needed for the git/ps subprocesses the script shells out to.
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
  });
  if (result.exitCode !== 0) {
    throw new Error(`statusline exited ${result.exitCode}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

// The model name is whatever sits between the brain icon and the pill that
// closes the model half of the segment.
function modelNameOf(session: unknown, env?: Record<string, string>): string {
  const plain = stripAnsi(render(session, env));
  const match = plain.match(new RegExp(`${brainIcon} (.*?) ${pillRight}`, 'u'));
  if (!match) throw new Error(`no model segment in output: ${JSON.stringify(plain)}`);
  return match[1];
}

const sessionWith = (model: Record<string, unknown>) => ({
  model,
  context_window: { used_percentage: 42 },
  workspace: { current_dir: '/tmp' },
});

// Bedrock hands Claude Code an opaque ARN, which it echoes into both fields.
const bedrockSession = (arn: string) => sessionWith({ id: arn, display_name: arn });

describe('Bedrock ARN resolution', () => {
  test('resolves an inference-profile ARN to its configured friendly name', () => {
    expect(modelNameOf(bedrockSession(OPUS_ARN), BEDROCK_ENV)).toBe('Opus 5');
  });

  test('picks the matching tier rather than the first configured one', () => {
    expect(modelNameOf(bedrockSession(SONNET_ARN), BEDROCK_ENV)).toBe('Sonnet 5');
    expect(modelNameOf(bedrockSession(HAIKU_ARN), BEDROCK_ENV)).toBe('Haiku 4.5');
  });

  test('matches on id when display_name is already a friendly name', () => {
    const session = sessionWith({ id: SONNET_ARN, display_name: SONNET_ARN });
    expect(modelNameOf(session, BEDROCK_ENV)).toBe('Sonnet 5');
  });

  test('renders the full model segment with context percentage intact', () => {
    const plain = stripAnsi(render(bedrockSession(OPUS_ARN), BEDROCK_ENV));
    expect(plain).toContain(`${brainIcon} Opus 5 `);
    expect(plain).toContain('42%');
    expect(plain).not.toContain('arn:aws:bedrock');
  });
});

describe('1M context suffix', () => {
  test('strips [1m] before matching and appends a compact badge', () => {
    expect(modelNameOf(bedrockSession(`${OPUS_ARN}[1m]`), BEDROCK_ENV)).toBe('Opus 5 1M');
  });

  test('adds the badge when only the id carries the suffix', () => {
    const session = sessionWith({ id: `${OPUS_ARN}[1m]`, display_name: OPUS_ARN });
    expect(modelNameOf(session, BEDROCK_ENV)).toBe('Opus 5 1M');
  });

  test('does not add the badge for a plain ARN', () => {
    expect(modelNameOf(bedrockSession(OPUS_ARN), BEDROCK_ENV)).toBe('Opus 5');
  });
});

describe('first-party display names pass through untouched', () => {
  test('keeps an already-resolved name', () => {
    const session = sessionWith({ id: 'claude-opus-4-8', display_name: 'Opus 4.8' });
    expect(modelNameOf(session)).toBe('Opus 4.8');
  });

  test('keeps a resolved name even when Bedrock vars are set', () => {
    const session = sessionWith({ id: 'claude-opus-4-8', display_name: 'Opus 4.8' });
    expect(modelNameOf(session, BEDROCK_ENV)).toBe('Opus 4.8');
  });

  test('strips the verbose parenthetical context suffix', () => {
    const session = sessionWith({ id: 'claude-sonnet-5', display_name: 'Sonnet 4.5 (1M context)' });
    expect(modelNameOf(session)).toBe('Sonnet 4.5');
  });
});

describe('fallbacks when no mapping is available', () => {
  test('degrades an unmapped ARN to its trailing resource id', () => {
    const unknown = 'arn:aws:bedrock:us-east-1:999999999999:application-inference-profile/zzzzzzzzzzzz';
    expect(modelNameOf(bedrockSession(unknown), BEDROCK_ENV)).toBe('zzzzzzzzzzzz');
  });

  test('degrades an ARN to its resource id when no env pairs exist at all', () => {
    expect(modelNameOf(bedrockSession(OPUS_ARN))).toBe('aaaaaaaaaaaa');
  });

  test('ignores a tier whose MODEL is set but MODEL_NAME is missing', () => {
    expect(modelNameOf(bedrockSession(OPUS_ARN), { ANTHROPIC_DEFAULT_OPUS_MODEL: OPUS_ARN })).toBe(
      'aaaaaaaaaaaa',
    );
  });

  test('falls back to the placeholder when the payload has no model', () => {
    const session = { context_window: { used_percentage: 0 }, workspace: { current_dir: '/tmp' } };
    expect(modelNameOf(session, BEDROCK_ENV)).toBe('...');
  });

  test('survives an empty payload', () => {
    expect(modelNameOf({}, BEDROCK_ENV)).toBe('...');
  });
});

describe('role segment', () => {
  // The script keys the node file by its parent pid, which is this test process.
  const stateFile = `/tmp/agent-graph/${process.pid}.json`;
  const session = sessionWith({ id: 'claude-opus-5-5', display_name: 'Opus 5.5' });

  function renderWithNode(state: Record<string, unknown>): string {
    fs.mkdirSync('/tmp/agent-graph', { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state));
    try {
      return stripAnsi(render(session));
    } finally {
      fs.rmSync(stateFile);
    }
  }

  test('shows the node and graph with their icons', () => {
    const plain = renderWithNode({ pid: process.pid, node: 'worker', node_icon: 'N', graph: 'dev-team', graph_icon: 'G' });
    expect(plain).toContain(` N worker ${pillRight} G dev-team ${pillRight}`);
  });

  test('shows only the node for a node outside a graph', () => {
    const plain = renderWithNode({ pid: process.pid, node: 'solo', node_icon: 'N' });
    expect(plain).toContain(` N solo ${pillRight}`);
    expect(plain).not.toContain('undefined');
  });
});

describe('segment order', () => {
  test('puts the node pill first, then the gossip pill, then the model', () => {
    const gossipFile = `/tmp/agent-gossip-${process.getuid!()}/sessions/${process.pid}.json`;
    const nodeFile = `/tmp/agent-graph/${process.pid}.json`;
    fs.mkdirSync(`/tmp/agent-gossip-${process.getuid!()}/sessions`, { recursive: true });
    fs.mkdirSync('/tmp/agent-graph', { recursive: true });
    fs.writeFileSync(
      gossipFile,
      JSON.stringify({ nickname: 'nick', name: 'room', peer_count: 2, ready: true, last_updated: Math.floor(Date.now() / 1000) }),
    );
    fs.writeFileSync(nodeFile, JSON.stringify({ node: 'worker', node_icon: 'R', graph: 'dev-team', graph_icon: 'P' }));
    let plain: string;
    try {
      plain = stripAnsi(render(sessionWith({ id: 'claude-opus-5-5', display_name: 'Opus 5.5' }), { STATUSLINE_DEBUG_COLS: '400' }));
    } finally {
      fs.rmSync(gossipFile);
      fs.rmSync(nodeFile);
    }
    const gossipAt = plain.indexOf(' room 2 ');
    const nodeAt = plain.indexOf(' R worker ');
    const modelAt = plain.indexOf(`${brainIcon} Opus 5.5`);
    expect(nodeAt).toBeGreaterThanOrEqual(0);
    expect(gossipAt).toBeGreaterThan(nodeAt);
    expect(modelAt).toBeGreaterThan(gossipAt);
  });

  test('puts the node pill first without a gossip', () => {
    const nodeFile = `/tmp/agent-graph/${process.pid}.json`;
    fs.mkdirSync('/tmp/agent-graph', { recursive: true });
    fs.writeFileSync(nodeFile, JSON.stringify({ node: 'worker', node_icon: 'R' }));
    let plain: string;
    try {
      plain = stripAnsi(render(sessionWith({ id: 'claude-opus-5-5', display_name: 'Opus 5.5' }), { STATUSLINE_DEBUG_COLS: '400' }));
    } finally {
      fs.rmSync(nodeFile);
    }
    const nodeAt = plain.indexOf(' R worker ');
    const modelAt = plain.indexOf(`${brainIcon} Opus 5.5`);
    expect(nodeAt).toBeGreaterThanOrEqual(0);
    expect(modelAt).toBeGreaterThan(nodeAt);
  });
});
