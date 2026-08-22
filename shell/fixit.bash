# fixit bash integration
# Add to ~/.bashrc: source /path/to/terminal-fix/shell/fixit.bash
# Press Tab to accept the suggested command, or just keep typing

_FIXIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_FIXIT_SUGGESTION=""
_FIXIT_SUGGESTION_ACTIVE=0

_fixit_on_prompt() {
  local ec=$?
  [[ $ec -eq 0 ]] && return

  local last_cmd
  last_cmd=$(history | tail -1 | sed 's/^ *[0-9]* *//')

  [[ -z "$last_cmd" ]] && return
  case "$last_cmd" in _fixit*|_FIXIT*|node*|python3*|fixit*|history*|echo*|sed*|tail*|source*) return ;; esac

  local payload
  payload=$(python3 -c "
import json, sys
print(json.dumps({'command': sys.argv[1], 'exitCode': int(sys.argv[2]), 'output': '', 'cwd': '$(pwd)'}))
" "$last_cmd" "$ec" 2>/dev/null)

  [[ -z "$payload" ]] && return

  # Get suggestion and store it for Tab completion
  local result
  result=$(node "${_FIXIT_DIR}/../bin/cli.js" suggest-json "$payload" 2>/dev/null)
  [[ -z "$result" ]] && return

  _FIXIT_SUGGESTION="$result"
  _FIXIT_SUGGESTION_ACTIVE=1

  # Display the suggestion
  local msg cmd
  msg=$(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message',''))" 2>/dev/null)
  cmd=$(echo "$result" | python3 -c "import json,sys; print(json.load(sys.stdin).get('command',''))" 2>/dev/null)

  if [[ -n "$cmd" ]]; then
    echo -e "  \033[36m● ${msg}\033[0m"
    echo -e "  \033[33m[Tab to run] ${cmd}\033[0m"
  else
    echo -e "  \033[36m● ${msg}\033[0m"
    _FIXIT_SUGGESTION_ACTIVE=0
  fi
}

_fixit_tab_complete() {
  if [[ $_FIXIT_SUGGESTION_ACTIVE -eq 1 && -n "$_FIXIT_SUGGESTION" ]]; then
    local cmd
    cmd=$(echo "$_FIXIT_SUGGESTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('command',''))" 2>/dev/null)
    if [[ -n "$cmd" ]]; then
      READLINE_LINE="$cmd"
      READLINE_POINT=${#READLINE_LINE}
      _FIXIT_SUGGESTION_ACTIVE=0
      _FIXIT_SUGGESTION=""
    fi
  fi
}

bind -x '"\t":_fixit_tab_complete' 2>/dev/null

if [[ -n "${PROMPT_COMMAND}" ]]; then
  case "${PROMPT_COMMAND}" in
    *_fixit_on_prompt*) ;;
    *) PROMPT_COMMAND="_fixit_on_prompt; ${PROMPT_COMMAND}" ;;
  esac
else
  PROMPT_COMMAND="_fixit_on_prompt"
fi
