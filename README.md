# agent-statusline

Powerline-style statuslines for [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Cursor Agent CLI](https://cursor.com/docs/cli), and [pi](https://github.com/badlogic/pi-mono), sharing one look: Tokyo Night colors, rounded pills, Nerd Font icons.

<!-- TODO: add screenshot -->

| File | Harness | Segments |
| --- | --- | --- |
| `src/claude-statusline.ts` | Claude Code | model + context, directory, rate limits, role, gossip, room, git |
| `src/cursor-statusline.ts` | Cursor Agent CLI | gossip, model + context, session tokens, directory, git |
| `src/pi-statusline.ts` | pi | directory, OpenRouter credits, session tokens, gossip, git, model, effort, context |

## Prerequisites

- [Bun](https://bun.sh/) (runs the statuslines and the install/uninstall scripts)
- A [Nerd Font](https://www.nerdfonts.com/) (for powerline glyphs and icons)

## Install

```sh
bun run plug      # install
bun run unplug    # uninstall
```

This symlinks `src/claude-statusline.ts` into `~/.claude/` (adding the `statusLine` config to `~/.claude/settings.json`) and `src/pi-statusline.ts` into `~/.pi/agent/extensions/` (run `/reload` in pi afterwards).

For Cursor Agent CLI, add to `~/.cursor/cli-config.json`:

```json
"statusLine": {
  "type": "command",
  "command": "bun /path/to/this/repo/src/cursor-statusline.ts",
  "padding": 0
}
```

## Development

Installs are symlinks (Cursor points at the repo directly), so edits are picked up on the next render — no copy or restart needed; pi needs a `/reload`.
