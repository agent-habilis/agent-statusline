# claude-code-statusline

A powerline-style statusline for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Displays model, context usage, rate limits, token counts, git branch, and more — directly in your Claude Code terminal.

<!-- TODO: add screenshot -->

## Prerequisites

- [Bun](https://bun.sh/) (to run the install/uninstall scripts)
- [jq](https://jqlang.github.io/jq/)
- python3
- A [Nerd Font](https://www.nerdfonts.com/) (for powerline glyphs and icons)

## Install

```sh
git clone git@github.com:agent-habilis/claude-code-statusline.git
cd claude-code-statusline
bun run cc:install
```

This symlinks `statusline.sh` into `~/.claude/` and adds the `statusLine` config to your `~/.claude/settings.json`.

## Uninstall

```sh
bun run cc:uninstall
```

## Development

Since `make install` creates a symlink, any edits you make to `statusline.sh` in this repo are picked up automatically on the next Claude Code interaction. No copy or restart needed.
