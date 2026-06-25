# claude-code-statusline

A powerline-style statusline for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Displays model, context usage, rate limits, git branch, and more — directly in your Claude Code terminal.

<!-- TODO: add screenshot -->

## Prerequisites

- [Bun](https://bun.sh/) (runs the statusline and the install/uninstall scripts)
- A [Nerd Font](https://www.nerdfonts.com/) (for powerline glyphs and icons)

## Install

```sh
git clone git@github.com:agent-habilis/claude-code-statusline.git
cd claude-code-statusline
bun run plug
```

This symlinks `statusline.ts` into `~/.claude/` and adds the `statusLine` config to your `~/.claude/settings.json`.

## Uninstall

```sh
bun run unplug
```

## Development

Since `bun run plug` creates a symlink, any edits you make to `statusline.ts` in this repo are picked up automatically on the next Claude Code interaction. No copy or restart needed.
