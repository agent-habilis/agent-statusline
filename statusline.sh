#!/bin/bash
input=$(cat)

# Data extraction
model=$(echo "$input" | jq -r '.model.display_name // "..."' | sed 's/ ([^)]*context)//')
context_pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
workspace_dir=$(echo "$input" | jq -r '.workspace.current_dir // "..."')
# Fish-style contraction: parents shrink to 1 char (dotfiles 2), leaf full.
if [ "$workspace_dir" = "..." ] || [ "$workspace_dir" = "/" ]; then
  current_dir="$workspace_dir"
else
  if [ "$workspace_dir" = "$HOME" ]; then
    current_dir="~"
  else
    case "$workspace_dir" in
      "$HOME"/*) contract_dir="~/${workspace_dir#$HOME/}" ;;
      *)         contract_dir="$workspace_dir" ;;
    esac
    IFS=/ read -ra _parts <<< "$contract_dir"
    _last=$((${#_parts[@]} - 1))
    current_dir=""
    for _i in "${!_parts[@]}"; do
      _p="${_parts[$_i]}"
      if [ "$_i" -eq "$_last" ] || [ -z "$_p" ]; then
        _seg="$_p"
      elif [[ "$_p" == .?* ]]; then
        _seg="${_p:0:2}"
      else
        _seg="${_p:0:1}"
      fi
      if [ "$_i" -eq 0 ]; then
        current_dir="$_seg"
      else
        current_dir="${current_dir}/${_seg}"
      fi
    done
  fi
fi
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
cyan_bg='\033[48;2;86;207;235m'
cyan_fg='\033[38;2;86;207;235m'
dcyan_bg='\033[48;2;60;158;180m'
dcyan_fg='\033[38;2;60;158;180m'

# --- Build segments ---

# 1. Model pill (always shown)
seg_model="${yellow_fg}${pill_left}${yellow_bg}${dark_fg} ${model_icon} ${model} ${reset}${yellow_fg}${dyellow_bg}${pill_right}${reset}${dyellow_bg}${dark_fg} ${memory_icon} ${context_pct}% ${reset}${dyellow_fg}${pill_right}${reset}"

# 2. Directory pill
seg_dir="${blue_fg}${pill_left}${blue_bg}${dark_fg} ${dir_icon} ${current_dir} ${reset}${blue_fg}${pill_right}${reset}"

# 3. Rate limit pill
seg_rate="${purple_fg}${pill_left}${purple_bg}${dark_fg} ${gauge_icon} 5h ${rate_5h}% ${reset}${purple_fg}${dpurple_bg}${pill_right}${reset}${dpurple_bg}${dark_fg} ${gauge_low_icon} 7d ${rate_7d}% ${reset}${dpurple_fg}${pill_right}${reset}"

# 4. Tokens pill (session all-time in/out tokens)
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

# 6. Square pill — nickname + participant count, rendered if connected to
# a square. The agent-square daemon maintains a per-session state file at
# /tmp/agent-square/sessions/<session_id>.json. We read square, nickname,
# and participant_count from it, and verify the daemon is alive by
# connecting to its unix socket (a leftover socket file after kill -9
# would otherwise trick us into showing a stale pill).
# participant_count is eventually consistent: ungracefully-exited peers
# are evicted by the daemon's own sweeper within ~100s.
seg_square=""
state_file="/tmp/agent-square/sessions/${claude_pid}.json"
if [ -f "$state_file" ]; then
  sq=$(jq -r '.square // empty' "$state_file" 2>/dev/null)
  nick=$(jq -r '.nickname // empty' "$state_file" 2>/dev/null)
  participants=$(jq -r '.participant_count // 0' "$state_file" 2>/dev/null)
  if [ -n "$sq" ] && [ -n "$nick" ]; then
    sq_prefix=$(echo "$sq" | cut -c1-16)
    sock="/tmp/agent-square/${sq_prefix}-${nick}.sock"
    if [ -S "$sock" ] && python3 -c "import socket,sys
s=socket.socket(socket.AF_UNIX); s.settimeout(0.2); s.connect(sys.argv[1])" "$sock" 2>/dev/null; then
      square_icon=$(printf '\xf3\xb0\x97\x8b')  # nf-md-account-voice (U+F05CB)
      peer_icon=$(printf '\xf3\xb0\xa1\x89')    # nf-md-account-multiple-outline (U+F0849)
      seg_square="${orange_fg}${pill_left}${orange_bg}${dark_fg} ${square_icon} ${nick} ${reset}${orange_fg}${dorange_bg}${pill_right}${reset}${dorange_bg}${dark_fg} ${peer_icon} ${participants} ${reset}${dorange_fg}${pill_right}${reset}"
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

# 8. Room pill — room membership + nickname + member count for the
# /room plugin. Reader contract is plugins/room/AGENTS.md "Public
# reader contract": the sessions/ directory is stable, the filename
# grammar (host-pid-monitor) is NOT — read the file rather than
# parsing the name. Member count comes from `--action list`, which
# applies the 90s heartbeat TTL and reaps stale entries. The node
# spawn is ~50ms, so the count is cached for COUNT_TTL seconds and
# the cached file is the only thing read on most renders.
seg_room=""
room_v=""
room_name=""
room_nick=""
room_root=""
for f in /tmp/room-skill/*/sessions/*.json; do
  [ -f "$f" ] || continue
  out=$(jq -r --argjson pid "$claude_pid" \
    'select((.pid // -1) == $pid) | "\(.v // "")\t\(.room // "")\t\(.nickname // "")\t\(.room_root // "")"' \
    "$f" 2>/dev/null)
  if [ -n "$out" ]; then
    IFS=$'\t' read -r room_v room_name room_nick room_root <<<"$out"
    break
  fi
done
if [ -n "$room_name" ]; then
  case "$room_v" in 1.*) ;; *) room_name="" ;; esac
  if [ -n "$room_name" ] && [ -n "$room_nick" ] && [ -n "$room_root" ]; then
    cache_dir="/tmp/statusline-cache"
    cache_file="${cache_dir}/room-${claude_pid}.count"
    count_ttl=2
    member_count=""
    if [ -f "$cache_file" ]; then
      cache_age=$(( $(date +%s) - $(stat -f %m "$cache_file" 2>/dev/null || echo 0) ))
      [ "$cache_age" -lt "$count_ttl" ] && member_count=$(cat "$cache_file" 2>/dev/null)
    fi
    if [ -z "$member_count" ]; then
      mkdir -p "$cache_dir" 2>/dev/null
      member_count=$(node /Users/caiogondim/Developer/upgrade/llm-context/plugins/room/src/session-state.js \
        --action list --room "$room_name" --path "$room_root" 2>/dev/null \
        | grep '"event":"peers_listed"' | tail -1 \
        | jq '.peers | length' 2>/dev/null)
      member_count=${member_count:-0}
      printf '%s' "$member_count" > "$cache_file" 2>/dev/null
    fi
    room_icon=$(printf '\xf3\xb0\x80\x84')      # nf-md-account (U+F0004)
    peers_icon=$(printf '\xf3\xb0\xa1\x89')     # nf-md-account-multiple-outline (U+F0849)
    seg_room="${cyan_fg}${pill_left}${cyan_bg}${dark_fg} ${room_icon} ${room_nick} ${reset}${cyan_fg}${dcyan_bg}${pill_right}${reset}${dcyan_bg}${dark_fg} ${peers_icon} ${member_count} ${room_name} ${reset}${dcyan_fg}${pill_right}${reset}"
  fi
fi

# --- Render all segments ---
# Claude Code runs the statusline subprocess without a controlling
# terminal, so $COLUMNS / tput / /dev/tty are all unavailable here.
# But Claude Code itself does have a tty — we can walk up the process
# tree to find its tty and read the viewport size from there.
# $STATUSLINE_DEBUG_COLS wins for tests.
cols="${STATUSLINE_DEBUG_COLS:-}"
cols_source="env"
cols_tty=""
if [ -z "$cols" ]; then
  cols_source="fallback"
  pid=$PPID
  for _ in 1 2 3 4 5 6; do
    tty=$(ps -o tty= -p "$pid" 2>/dev/null | tr -d ' ')
    if [ -n "$tty" ] && [ "$tty" != "?" ] && [ "$tty" != "??" ] && [ -r "/dev/$tty" ]; then
      cols=$(stty size < "/dev/$tty" 2>/dev/null | awk '{print $2}')
      if [ -n "$cols" ]; then
        cols_source="tty"
        cols_tty="/dev/$tty"
        break
      fi
    fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$pid" ] || [ "$pid" -le 1 ] && break
  done
fi
if [ -z "$cols" ] || ! [ "$cols" -gt 0 ] 2>/dev/null; then
  cols=120
  cols_source="fallback"
fi

# Claude Code reserves a right-edge gutter for its own UI chrome (the
# rounded box around the input area extends past where the statusline
# stops). The pty width from stty is the full terminal viewport; the
# actually paintable area for the statusline is narrower. Subtracting
# 4 cols matches the observed clipping point in Ghostty.
cols=$((cols - 4))
[ "$cols" -lt 20 ] && cols=20

# Printable widths and stripped strings for all segments in one python
# call (process spawn is the dominant cost on a statusline). Our segments
# embed ANSI escapes as literal `\033[...m` sequences (interpreted only
# by the final `echo -e`), so we strip both the literal form and real
# ESC-CSI bytes, then count Unicode codepoints. Nerd Font / Powerline
# glyphs are single-width in modern terminals. We separate segments on
# the wire with U+001E (Record Separator), and each line emits
# "<width>\x1f<stripped>" so we can preserve the stripped string for
# debug logging without a second python invocation.
seg_data=$(printf '%s\x1e' "$seg_dir" "$seg_model" "$seg_rate" "$seg_role" "$seg_square" "$seg_room" "$seg_git" | python3 -c '
import re, sys
esc = re.compile(r"\\033\[[0-9;]*m|\x1b\[[0-9;]*m")
data = sys.stdin.read()
parts = data.split("\x1e")
# printf leaves a trailing sep, so drop the empty last element.
if parts and parts[-1] == "":
    parts.pop()
for p in parts:
    stripped = esc.sub("", p)
    sys.stdout.write(f"{len(stripped)}\x1f{stripped}\n")
')
# Split newline-separated records into parallel arrays (bash 3.2-compatible).
seg_widths=()
seg_stripped=()
while IFS= read -r line; do
  seg_widths+=("${line%%$'\x1f'*}")
  seg_stripped+=("${line#*$'\x1f'}")
done <<< "$seg_data"

seg_names=(dir model rate role square room git)
output="$seg_dir"
used="${seg_widths[0]}"
included=("dir")
dropped=()
i=1
for seg in "$seg_model" "$seg_rate" "$seg_role" "$seg_square" "$seg_room" "$seg_git"; do
  name="${seg_names[i]}"
  w="${seg_widths[i]}"
  i=$((i + 1))
  [ -z "$seg" ] && continue
  # +1 for the space separator
  if [ $((used + 1 + w)) -le "$cols" ]; then
    output="${output} ${seg}"
    used=$((used + 1 + w))
    included+=("$name")
  else
    dropped+=("$name")
    break
  fi
done

echo -e "$output"

# Diagnostic logging — gated behind STATUSLINE_DEBUG. Zero overhead when off.
# Writes one JSON record per render to /tmp/statusline-debug.log (override
# with STATUSLINE_DEBUG_LOG). Use to investigate width/cols mismatches.
if [ -n "$STATUSLINE_DEBUG" ]; then
  debug_log="${STATUSLINE_DEBUG_LOG:-/tmp/statusline-debug.log}"
  ts=$(python3 -c 'import time; print(int(time.time()*1000))')
  jq -nc \
    --argjson ts "$ts" \
    --argjson cols "$cols" \
    --arg cols_source "$cols_source" \
    --arg cols_tty "$cols_tty" \
    --argjson total "$used" \
    --arg names "${seg_names[*]}" \
    --arg widths "${seg_widths[*]}" \
    --arg included "${included[*]}" \
    --arg dropped "${dropped[*]}" \
    --arg s_dir "${seg_stripped[0]}" \
    --arg s_model "${seg_stripped[1]}" \
    --arg s_rate "${seg_stripped[2]}" \
    --arg s_role "${seg_stripped[3]}" \
    --arg s_square "${seg_stripped[4]}" \
    --arg s_room "${seg_stripped[5]}" \
    --arg s_git "${seg_stripped[6]}" \
    '{
      ts: $ts,
      cols: $cols,
      cols_source: $cols_source,
      cols_tty: (if $cols_tty == "" then null else $cols_tty end),
      total: $total,
      included: ($included | split(" ") | map(select(. != ""))),
      dropped: ($dropped | split(" ") | map(select(. != ""))),
      segs: [
        ($names | split(" ")) as $n
        | ($widths | split(" ")) as $w
        | [$s_dir, $s_model, $s_rate, $s_role, $s_square, $s_room, $s_git] as $r
        | range(0; $n | length)
        | {name: $n[.], width: ($w[.] | tonumber), rendered: $r[.]}
      ]
    }' >> "$debug_log"
fi
