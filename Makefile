STATUSLINE_SRC := $(CURDIR)/statusline.sh
STATUSLINE_DST := $(HOME)/.claude/statusline.sh
SETTINGS_FILE  := $(HOME)/.claude/settings.json

STATUSLINE_JSON := {"type": "command", "command": "~/.claude/statusline.sh", "padding": 0}

.PHONY: install uninstall

install:
	@# Create ~/.claude/ if it doesn't exist
	@mkdir -p $(HOME)/.claude

	@# Backup existing statusline.sh if it's a regular file (not a symlink)
	@if [ -f "$(STATUSLINE_DST)" ] && [ ! -L "$(STATUSLINE_DST)" ]; then \
		backup="$(STATUSLINE_DST).bak.$$(date +%Y%m%d_%H%M%S)"; \
		cp "$(STATUSLINE_DST)" "$$backup"; \
		echo "Backed up existing statusline.sh to $$backup"; \
	fi

	@# Ensure source script is executable
	@chmod +x "$(STATUSLINE_SRC)"

	@# Create symlink
	@ln -sf "$(STATUSLINE_SRC)" "$(STATUSLINE_DST)"
	@echo "Symlinked $(STATUSLINE_DST) -> $(STATUSLINE_SRC)"

	@# Add statusLine config to settings.json
	@if [ ! -f "$(SETTINGS_FILE)" ]; then \
		echo '{}' > "$(SETTINGS_FILE)"; \
	fi
	@jq '.statusLine = $(STATUSLINE_JSON)' "$(SETTINGS_FILE)" > "$(SETTINGS_FILE).tmp" \
		&& mv "$(SETTINGS_FILE).tmp" "$(SETTINGS_FILE)"
	@echo "Updated $(SETTINGS_FILE) with statusLine config"

	@echo ""
	@echo "Done! Statusline will appear on your next Claude Code interaction."

uninstall:
	@# Remove symlink (only if it is a symlink)
	@if [ -L "$(STATUSLINE_DST)" ]; then \
		rm "$(STATUSLINE_DST)"; \
		echo "Removed symlink $(STATUSLINE_DST)"; \
	else \
		echo "$(STATUSLINE_DST) is not a symlink, skipping removal"; \
	fi

	@# Remove statusLine key from settings.json
	@if [ -f "$(SETTINGS_FILE)" ]; then \
		jq 'del(.statusLine)' "$(SETTINGS_FILE)" > "$(SETTINGS_FILE).tmp" \
			&& mv "$(SETTINGS_FILE).tmp" "$(SETTINGS_FILE)"; \
		echo "Removed statusLine config from $(SETTINGS_FILE)"; \
	fi

	@echo ""
	@echo "Done! Statusline has been removed."
