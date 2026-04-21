#!/bin/bash
input=$(cat)

# Data extraction
model=$(echo "$input" | jq -r '.model.display_name // "..."' | sed 's/ ([^)]*context)//')
context_pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
current_dir=$(echo "$input" | jq -r '.workspace.current_dir // "..."' | xargs basename)
rate_5h=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // 0' | cut -d. -f1)
rate_7d=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // 0' | cut -d. -f1)
session_id=$(echo "$input" | jq -r '.session_id // "..."')
session_short=$(echo "$session_id" | cut -c1-8)
claude_pid=$PPID

# Powerline rounded glyphs
pill_left=$(printf '\xee\x82\xb6')
pill_right=$(printf '\xee\x82\xb4')

# Shared
dark_fg='\033[38;2;26;27;38m'
reset='\033[0m'

# Icons
model_icon=$(printf '\xf3\xb0\x86\xa7')    # nf-md-brain (U+F01A7)
memory_icon=$(printf '\xf3\xb0\x8d\x9b')   # nf-md-memory (U+F035B)
dir_icon=$(printf '\xf3\xb0\x89\x96')      # 󰉖 (U+F0256)
branch_icon=$(printf '\xf3\xb0\x98\xac')    # nf-md-source-branch (U+F062C)
gauge_icon=$(printf '\xf3\xb0\x8a\x9a')    # nf-md-gauge (U+F029A)
gauge_low_icon=$(printf '\xf3\xb0\x8a\x98') # nf-md-gauge-low (U+F0298)
session_icon=$(printf '\xf3\xb0\x97\x92')  # nf-md-card-account-details (U+F05D2)
cost_icon=$(printf '\xf3\xb0\x96\x88')    # nf-md-currency-usd (U+F0588)
mode_icon=$(printf '\xf3\xb0\x94\xa3')   # nf-md-circle-outline (U+F0523)

# Color definitions
yellow_bg='\033[48;2;224;175;104m'
yellow_fg='\033[38;2;224;175;104m'
dyellow_bg='\033[48;2;178;140;83m'
dyellow_fg='\033[38;2;178;140;83m'
blue_bg='\033[48;2;118;159;240m'
blue_fg='\033[38;2;118;159;240m'
green_bg='\033[48;2;158;206;106m'
green_fg='\033[38;2;158;206;106m'
dgreen_bg='\033[48;2;105;156;58m'
dgreen_fg='\033[38;2;105;156;58m'
purple_bg='\033[48;2;187;154;247m'
purple_fg='\033[38;2;187;154;247m'
dpurple_bg='\033[48;2;157;124;216m'
dpurple_fg='\033[38;2;157;124;216m'
orange_bg='\033[48;2;255;158;100m'
orange_fg='\033[38;2;255;158;100m'
dorange_bg='\033[48;2;200;120;65m'
dorange_fg='\033[38;2;200;120;65m'
gray_bg='\033[48;2;86;95;137m'
gray_fg='\033[38;2;86;95;137m'
teal_bg='\033[48;2;115;218;202m'
teal_fg='\033[38;2;115;218;202m'
dteal_bg='\033[48;2;78;158;145m'
dteal_fg='\033[38;2;78;158;145m'
pink_bg='\033[48;2;243;139;168m'
pink_fg='\033[38;2;243;139;168m'
dpink_bg='\033[48;2;200;100;130m'
dpink_fg='\033[38;2;200;100;130m'

# --- Build segments ---

# 1. Model pill (always shown)
seg_model="${yellow_fg}${pill_left}${yellow_bg}${dark_fg} ${model_icon} ${model} ${reset}${yellow_fg}${dyellow_bg}${pill_right}${reset}${dyellow_bg}${dark_fg} ${memory_icon} ${context_pct}% ${reset}${dyellow_fg}${pill_right}${reset}"

# 2. Directory pill
seg_dir="${blue_fg}${pill_left}${blue_bg}${dark_fg} ${dir_icon} ${current_dir} ${reset}${blue_fg}${pill_right}${reset}"

# 3. Rate limit pill
seg_rate="${purple_fg}${pill_left}${purple_bg}${dark_fg} ${gauge_icon} 5h ${rate_5h}% ${reset}${purple_fg}${dpurple_bg}${pill_right}${reset}${dpurple_bg}${dark_fg} ${gauge_low_icon} 7d ${rate_7d}% ${reset}${dpurple_fg}${pill_right}${reset}"

# 4. Tokens pill (session all-time in/out tokens)
workspace_dir=$(echo "$input" | jq -r '.workspace.current_dir // ""')
project_key=$(echo "$workspace_dir" | sed 's|/|-|g')
session_jsonl="$HOME/.claude/projects/${project_key}/${session_id}.jsonl"
token_display="..."
if [ -f "$session_jsonl" ]; then
  token_display=$(python3 -c "
import json
in_tok = 0
out_tok = 0
with open('$session_jsonl') as f:
    for line in f:
        try:
            usage = json.loads(line).get('message', {}).get('usage', {})
            in_tok += usage.get('input_tokens', 0) + usage.get('cache_creation_input_tokens', 0) + usage.get('cache_read_input_tokens', 0)
            out_tok += usage.get('output_tokens', 0)
        except: pass

def fmt(n):
    if n >= 1_000_000: return f'{round(n/1_000_000)}M'
    if n >= 1_000: return f'{round(n/1_000)}k'
    return str(n)

print(f'↓{fmt(in_tok)} ↑{fmt(out_tok)}')
" 2>/dev/null)
fi
seg_mode="${teal_fg}${pill_left}${teal_bg}${dark_fg} ${token_display} ${reset}${teal_fg}${pill_right}${reset}"

# 5. Git pill (rightmost, only if in a git repo)
seg_git=""
if git rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git branch --show-current 2>/dev/null)

  seg_git="${green_fg}${pill_left}${green_bg}${dark_fg} ${branch_icon} ${branch} ${reset}${green_fg}${pill_right}${reset}"
fi

# 6. Square pill — nickname + peer count, rendered if connected to a square.
# The /square skill maintains a per-session state file at
# /tmp/agent-square/sessions/<session_id>.json. We read square, nickname,
# and peer_count from it, and verify the daemon is alive by connecting to
# its unix socket (a leftover socket file after kill -9 would otherwise
# trick us into showing a stale pill).
seg_square=""
state_file="/tmp/agent-square/sessions/${claude_pid}.json"
if [ -f "$state_file" ]; then
  sq=$(jq -r '.square // empty' "$state_file" 2>/dev/null)
  nick=$(jq -r '.nickname // empty' "$state_file" 2>/dev/null)
  peers=$(jq -r '.peer_count // 0' "$state_file" 2>/dev/null)
  if [ -n "$sq" ] && [ -n "$nick" ]; then
    sq_prefix=$(echo "$sq" | cut -c1-16)
    sock="/tmp/agent-square/${sq_prefix}-${nick}.sock"
    if [ -S "$sock" ] && python3 -c "import socket,sys
s=socket.socket(socket.AF_UNIX); s.settimeout(0.2); s.connect(sys.argv[1])" "$sock" 2>/dev/null; then
      square_icon=$(printf '\xf3\xb0\x97\x8b')  # nf-md-account-voice (U+F05CB)
      peer_icon=$(printf '\xf3\xb0\xa1\x89')    # nf-md-account-multiple-outline (U+F0849)
      seg_square="${orange_fg}${pill_left}${orange_bg}${dark_fg} ${square_icon} ${nick} ${reset}${orange_fg}${dorange_bg}${pill_right}${reset}${dorange_bg}${dark_fg} ${peer_icon} ${peers} ${reset}${dorange_fg}${pill_right}${reset}"
    fi
  fi
fi

# 7. Role pill (only if a role is set)
seg_role=""
role_state_file="/tmp/agent-role/state.json"
if [ -f "$role_state_file" ] && [ -n "$claude_pid" ]; then
  current_role=$(jq -r --arg pid "$claude_pid" '.[$pid].role // empty' "$role_state_file" 2>/dev/null)
  if [ -n "$current_role" ]; then
    role_icon=$(printf '\xf3\xb0\x96\xb5')  # U+F05B5
    seg_role="${pink_fg}${pill_left}${pink_bg}${dark_fg} ${role_icon} ${current_role} ${reset}${pink_fg}${pill_right}${reset}"
  fi
fi

# --- Render all segments ---
# Note: COLUMNS/tput unavailable in statusline subprocess context.
# Claude Code clips overflow, so render all segments and let it handle it.

output="$seg_model"
for seg in "$seg_rate" "$seg_dir" "$seg_role" "$seg_square" "$seg_git"; do
  [ -n "$seg" ] && output="${output} ${seg}"
done

echo -e "$output"
