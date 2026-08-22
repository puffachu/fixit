# fixit bash integration
# Add to ~/.bashrc: source /path/to/terminal-fix/shell/fixit.bash

_FIXIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_fixit_on_prompt() {
  local ec=$?
  [[ $ec -eq 0 ]] && return

  local last_cmd
  last_cmd=$(history | tail -1 | sed 's/^ *[0-9]* *//')

  [[ -z "$last_cmd" ]] && return
  case "$last_cmd" in _fixit*|_FIXIT*|node*|python3*|fixit*|history*|echo*|sed*|tail*) return ;; esac

  local payload
  payload=$(python3 -c "
import json, sys
print(json.dumps({'command': sys.argv[1], 'exitCode': int(sys.argv[2]), 'output': '', 'cwd': '$(pwd)'}))
" "$last_cmd" "$ec" 2>/dev/null)

  [[ -z "$payload" ]] && return
  node "${_FIXIT_DIR}/../bin/cli.js" suggest "$payload" 2>/dev/null
}

if [[ -n "${PROMPT_COMMAND}" ]]; then
  PROMPT_COMMAND="_fixit_on_prompt; ${PROMPT_COMMAND}"
else
  PROMPT_COMMAND="_fixit_on_prompt"
fi
