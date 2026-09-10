/**
 * Statusline Extension for pi
 *
 * Powerline-style footer showing model, directory, OpenRouter credits,
 * session token stats, and git branch.
 *
 * Colors: Tokyo Night Storm (https://github.com/folke/tokyonight.nvim)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { visibleWidth } from "@mariozechner/pi-tui";
import fs from "node:fs";
import path from "node:path";

// --- Nerd Font glyphs (powerline rounded) ---
const PILL_LEFT = "\ue0b6"; // 
const PILL_RIGHT = "\ue0b4"; // 

// Icons (Nerd Font glyphs)
const ICON_BRAIN = "\u{F01A7}"; // 󰆧
const ICON_BOLT = "\u{F140C}"; // 󱐌 nf-md-lightning_bolt
const ICON_ROBOT = "\u{F167A}"; // 󱙺 robot happy
const ICON_FOLDER = "\u{F0256}"; // 󰉖
const ICON_CURRENCY = "\u{F0588}"; // 󰖈
const ICON_ARROW_DOWN = "▽";
const ICON_ARROW_UP = "△";
const ICON_BRANCH = "\u{F062C}"; // 󰘬
const ICON_MEMORY = "\u{F035B}"; // 󰍛
const ICON_CHAT = "\u{F0EDE}";

// --- ANSI helpers ---
const RESET = "\x1b[0m";
const DARK_FG = "\x1b[38;2;26;27;38m";

// --- Tokyo Night Storm color palette ---
// https://github.com/folke/tokyonight.nvim/blob/main/extras/lua/tokyonight_storm.lua
// Base colors (used for pill backgrounds)
const YELLOW = { r: 224, g: 175, b: 104 };   // Yellow   #e0af68
const BLUE = { r: 122, g: 162, b: 247 };     // Blue     #7aa2f7
const PURPLE = { r: 187, g: 154, b: 247 };   // Purple   #bb9af7
const TEAL = { r: 115, g: 218, b: 202 };     // Teal     #73daca
const GREEN = { r: 158, g: 206, b: 106 };    // Green    #9ece6a
const ORANGE = { r: 255, g: 158, b: 100 };   // Orange   #ff9e64
const RED = { r: 247, g: 118, b: 142 };      // Red      #f7768e
const MAGENTA = { r: 157, g: 124, b: 216 }; // Magenta  #9d7cd8

// Darker variants (multiply each channel by 0.8, rounded)
const darker = (c: typeof YELLOW) => ({ r: Math.round(c.r * 0.8), g: Math.round(c.g * 0.8), b: Math.round(c.b * 0.8) });
const DYELLOW = darker(YELLOW);  // 179,140,83
const DBLUE = darker(BLUE);      // 98,130,198
const DPURPLE = darker(PURPLE);  // 150,123,198
const DTEAL = darker(TEAL);      // 92,174,162
const DGREEN = darker(GREEN);    // 126,165,85
const DORANGE = darker(ORANGE);  // 204,126,81
const DRED = darker(RED);        // 198,94,114
const DMAGENTA = darker(MAGENTA);

function ansiFg(c: typeof YELLOW) { return `\x1b[38;2;${c.r};${c.g};${c.b}m`; }
function ansiBg(c: typeof YELLOW) { return `\x1b[48;2;${c.r};${c.g};${c.b}m`; }

// --- OpenRouter state ---
interface OpenRouterCredits {
	limit: number;
	usage: number;
	limitRemaining: number;
	lastFetched: number;
}

let credits: OpenRouterCredits | null = null;
let fetchTimer: ReturnType<typeof setInterval> | null = null;
let gossipTimer: ReturnType<typeof setInterval> | null = null;

async function fetchOpenRouterCredits(signal?: AbortSignal): Promise<OpenRouterCredits | null> {
	const apiKey = process.env.OPENROUTER_API_KEY;
	if (!apiKey) return null;

	try {
		const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
			headers: { Authorization: `Bearer ${apiKey}` },
			signal,
		});
		if (!res.ok) return null;

		const json = (await res.json()) as {
			data: { limit: number | null; usage: number };
		};

		const limit = json.data.limit ?? 0;
		const usage = json.data.usage;
		const limitRemaining = limit - usage;

		return {
			limit,
			usage,
			limitRemaining,
			lastFetched: Date.now(),
		};
	} catch {
		return null;
	}
}

// --- Formatting helpers ---
function fmtNum(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

function fmtMoney(n: number): string {
	return `$${n.toFixed(2)}`;
}

function truncate(str: string, maxLen: number): string {
	if (str.length <= maxLen) return str;
	return str.slice(0, Math.max(0, maxLen - 1)) + "…";
}

// --- agent-gossip state ---
// The agent-gossip daemon writes a per-session state file under its
// uid-scoped runtime base at /tmp/agent-gossip-<uid>/sessions/<pid>.json,
// keyed by the pid of the harness process the daemon was launched from
// ($PPID of the skill's shell — this pi process, hence process.pid here).
// The daemon refreshes last_updated every ~10s even when membership is
// unchanged, so a fresh timestamp == alive. Keep the staleness window
// ~3x that cadence (30s). `ready` stays false until the daemon serves IPC.
const GOSSIP_RUNTIME_BASE = `/tmp/agent-gossip-${process.getuid?.() ?? ""}`;

interface GossipState {
	nickname?: string;
	name?: string;
	// The daemon renamed `participant_count` to `peer_count`; keep the old
	// name as a fallback for daemons still on the previous binary.
	peer_count?: number;
	participant_count?: number;
	last_updated?: number;
	ready?: boolean;
	pid?: number;
	gossip?: string;
}

function readGossipState(): GossipState | null {
	try {
		const raw = fs.readFileSync(`${GOSSIP_RUNTIME_BASE}/sessions/${process.pid}.json`, "utf8");
		const s = JSON.parse(raw) as GossipState;

		const now = Math.floor(Date.now() / 1000);
		if (!s.last_updated || now - s.last_updated >= 30) return null; // stale == daemon gone
		if (s.ready === false) return null; // daemon not serving IPC yet
		if (!s.nickname || !s.name) return null; // require both, like the reference

		return s;
	} catch {
		return null; // file missing or unparseable
	}
}

// --- Segment builders ---
// Model + context usage in one pill, like the Claude Code statusline.
// The vendor prefix ("moonshotai/") is dropped to match its short names.
function buildModelSegment(ctx: ExtensionContext): string {
	const modelId = ctx.model?.id || "unknown";
	const name = truncate(modelId.slice(modelId.indexOf("/") + 1), 32);

	const contextUsage = ctx.getContextUsage();
	const [base, dark] = contextUsage && contextUsage.percent > 90 ? [RED, DRED] : [TEAL, DTEAL];
	const modelHalf = `${ansiFg(base)}${PILL_LEFT}${ansiBg(base)}${DARK_FG} ${ICON_BRAIN} ${name} ${RESET}`;
	if (!contextUsage) return `${modelHalf}${ansiFg(base)}${PILL_RIGHT}${RESET}`;

	const pct = contextUsage.percent;
	const pctDisplay = pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1);

	return (
		modelHalf +
		`${ansiFg(base)}${ansiBg(dark)}${PILL_RIGHT}${RESET}${ansiBg(dark)}${DARK_FG} ${ICON_MEMORY} ${pctDisplay}% ${RESET}${ansiFg(dark)}${PILL_RIGHT}${RESET}`
	);
}

function buildDirSegment(): string {
	const dir = truncate(path.basename(process.cwd()), 24);

	return `${ansiFg(BLUE)}${PILL_LEFT}${ansiBg(BLUE)}${DARK_FG} ${ICON_FOLDER} ${dir} ${RESET}${ansiFg(BLUE)}${PILL_RIGHT}${RESET}`;
}

function buildCreditsSegment(): string | null {
	if (!credits || credits.limit === 0) return null;

	const pct = Math.round((credits.usage / credits.limit) * 100);
	const remaining = fmtMoney(credits.limitRemaining);

	return (
		`${ansiFg(PURPLE)}${PILL_LEFT}${ansiBg(PURPLE)}${DARK_FG} ${ICON_CURRENCY} ${remaining} left ${RESET}` +
		`${ansiFg(PURPLE)}${ansiBg(DPURPLE)}${PILL_RIGHT}${RESET}${ansiBg(DPURPLE)}${DARK_FG} ${pct}% used ${RESET}${ansiFg(DPURPLE)}${PILL_RIGHT}${RESET}`
	);
}

function buildSessionSegment(ctx: ExtensionContext): string {
	let inputTokens = 0;
	let outputTokens = 0;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			const msg = entry.message as AssistantMessage;
			const usage = msg.usage ?? { input: 0, output: 0 };
			inputTokens += usage.input ?? 0;
			outputTokens += usage.output ?? 0;
		}
	}

	return (
		`${ansiFg(ORANGE)}${PILL_LEFT}${ansiBg(ORANGE)}${DARK_FG} ${ICON_ARROW_DOWN} ${fmtNum(inputTokens)} ${RESET}` +
		`${ansiFg(ORANGE)}${ansiBg(DORANGE)}${PILL_RIGHT}${RESET}${ansiBg(DORANGE)}${DARK_FG} ${ICON_ARROW_UP} ${fmtNum(outputTokens)} ${RESET}${ansiFg(DORANGE)}${PILL_RIGHT}${RESET}`
	);
}

function buildGossipSegment(): string | null {
	const s = readGossipState();
	if (!s) return null;

	const nick = truncate(s.nickname!, 20);
	const name = truncate(s.name!, 20);
	const peers = s.peer_count ?? s.participant_count ?? 0;

	return (
		`${ansiFg(YELLOW)}${PILL_LEFT}${ansiBg(YELLOW)}${DARK_FG} ${ICON_ROBOT} ${nick} ${RESET}` +
		`${ansiFg(YELLOW)}${ansiBg(DYELLOW)}${PILL_RIGHT}${RESET}${ansiBg(DYELLOW)}${DARK_FG} ${ICON_CHAT} ${name} ${peers} ${RESET}${ansiFg(DYELLOW)}${PILL_RIGHT}${RESET}`
	);
}

function buildEffortSegment(pi: ExtensionAPI): string | null {
	let level: string | undefined;
	try {
		level = pi.getThinkingLevel?.();
	} catch {
		return null;
	}
	if (!level) return null;

	return `${ansiFg(MAGENTA)}${PILL_LEFT}${ansiBg(MAGENTA)}${DARK_FG} ${ICON_BOLT} ${level} ${RESET}${ansiFg(MAGENTA)}${PILL_RIGHT}${RESET}`;
}

function buildGitSegment(branch: string): string {
	const shortBranch = truncate(branch, 20);

	return `${ansiFg(GREEN)}${PILL_LEFT}${ansiBg(GREEN)}${DARK_FG} ${ICON_BRANCH} ${shortBranch} ${RESET}${ansiFg(GREEN)}${PILL_RIGHT}${RESET}`;
}

// --- Extension entry ---
export default function (pi: ExtensionAPI) {
	let tuiRef: { requestRender: () => void } | null = null;

	function installFooter(ctx: ExtensionContext) {
		ctx.ui.setFooter((tui, _theme, footerData) => {
			tuiRef = tui;

			const unsub = footerData.onBranchChange(() => tui.requestRender());

			return {
				dispose: () => {
					unsub();
				},
				invalidate() {},
				render(width: number): string[] {
					if (!width || width <= 0) {
						return [""];
					}

					const segs: string[] = [];

					// 1. Directory
					segs.push(buildDirSegment());

					// 2. OpenRouter credits (only if available)
					const creditsSeg = buildCreditsSegment();
					if (creditsSeg) segs.push(creditsSeg);

					// 3. Session tokens
					segs.push(buildSessionSegment(ctx));

					// 3b. Gossip (only when in a live agent-gossip session)
					const gossipSeg = buildGossipSegment();
					if (gossipSeg) segs.push(gossipSeg);

					// 4. Git branch
					const branch = footerData.getGitBranch();
					if (branch) segs.push(buildGitSegment(branch));

					// 5. Model + context usage
					segs.push(buildModelSegment(ctx));

					// 6. Reasoning effort
					const effortSeg = buildEffortSegment(pi);
					if (effortSeg) segs.push(effortSeg);

					// Drop whole segments from the right until the line fits.
					// We never render a partial pill — half-rendered powerline
					// glyphs look broken.
					const SEP = " ";
					let visible = segs;
					while (visible.length > 0) {
						const line = visible.join(SEP);
						if (visibleWidth(line) <= width) break;
						visible = visible.slice(0, -1);
					}
					return [visible.join(SEP)];
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		// Install footer immediately (synchronously) so pi's built-in footer
		// doesn't get a chance to overwrite it during async init.
		installFooter(ctx);

		// Fetch OpenRouter credits asynchronously after footer is up
		credits = await fetchOpenRouterCredits();
		tuiRef?.requestRender();

		// Set up periodic refresh (every 5 minutes)
		if (fetchTimer) clearInterval(fetchTimer);
		fetchTimer = setInterval(async () => {
			credits = await fetchOpenRouterCredits();
			tuiRef?.requestRender();
		}, 5 * 60 * 1000);

		// The gossip pill reflects out-of-band daemon state, so the
		// footer must re-render on a timer to make it appear/expire
		// without user interaction (daemon heartbeats every ~10s).
		if (gossipTimer) clearInterval(gossipTimer);
		gossipTimer = setInterval(() => tuiRef?.requestRender(), 5000);
	});

	pi.on("turn_end", async (_event, ctx) => {
		// Re-assert our footer in case another extension or pi core
		// replaced it during the turn.
		installFooter(ctx);
	});

	pi.on("session_shutdown", () => {
		if (fetchTimer) {
			clearInterval(fetchTimer);
			fetchTimer = null;
		}
		if (gossipTimer) {
			clearInterval(gossipTimer);
			gossipTimer = null;
		}
	});
}
