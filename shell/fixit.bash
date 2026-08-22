# fixit bash integration
# Add to ~/.bashrc: source /path/to/terminal-fix/shell/fixit.bash

_fixit_last_cmd=""
_fixit_last_exit=0

_fixit_preexec() {
  _fixit_last_cmd="$1"
}

_fixit_precmd() {
  local exit_code=$?
  [[ $exit_code -eq 0 ]] && return
  [[ "$_fixit_last_cmd" == fixit* ]] && return
  [[ -z "$_fixit_last_cmd" ]] && return

  local payload=$(python3 -c "
import json,sys
print(json.dumps({'command': sys.argv[1], 'exitCode': int(sys.argv[2]), 'output': '', 'cwd': '$(pwd)'}))
" "$_fixit_last_cmd" "$exit_code" 2>/dev/null)

  [[ -z "$payload" ]] && return
  node "$(dirname "${BASH_SOURCE[0]}")/../bin/cli.js" suggest "$payload" 2>/dev/null
}

# Bash doesn't have preexec natively; use DEBUG trap
trap '_fixit_preexec "$BASH_COMMAND"' DEBUG
PROMPT_COMMAND=_fixit_precmd
