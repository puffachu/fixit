# fixit bash integration
# Add to ~/.bashrc: source /path/to/terminal-fix/shell/fixit.bash

_FIXIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_FIXIT_SUGGESTION=""
_FIXIT_SUGGESTION_ACTIVE=0
_FIXIT_LAST_FAILED_CMD=""
_FIXIT_LAST_EC=""

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

  local result
  result=$(node "${_FIXIT_DIR}/../bin/cli.js" suggest-json "$payload" 2>/dev/null)
  [[ -z "$result" ]] && return

  _FIXIT_LAST_FAILED_CMD="$last_cmd"
  _FIXIT_LAST_EC="$ec"

  local msg cmd learned
  msg=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message',''))" 2>/dev/null)
  cmd=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('command',''))" 2>/dev/null)
  learned=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('learned',False))" 2>/dev/null)

  [[ -z "$cmd" ]] && { echo -e "  \033[36m● ${msg}\033[0m"; return; }

  _FIXIT_SUGGESTION="$result"
  _FIXIT_SUGGESTION_ACTIVE=1

  if [[ "$learned" == "True" ]]; then
    echo -e "  \033[35m● ${msg}\033[0m"
  else
    echo -e "  \033[36m● ${msg}\033[0m"
  fi
  echo -e "  \033[33m[Tab to run] ${cmd}\033[0m"
}

_fixit_tab_complete() {
  if [[ $_FIXIT_SUGGESTION_ACTIVE -eq 1 && -n "$_FIXIT_SUGGESTION" ]]; then
    local cmd
    cmd=$(echo "$_FIXIT_SUGGESTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('command',''))" 2>/dev/null)
    if [[ -n "$cmd" ]]; then
      READLINE_LINE="$cmd"
      READLINE_POINT=${#READLINE_LINE}
      _FIXIT_SUGGESTION_ACTIVE=0

      # Record acceptance for learning
      local accept_payload
      accept_payload=$(python3 -c "
import json, sys
print(json.dumps({'command': sys.argv[1], 'exitCode': int(sys.argv[2]), 'suggestion': sys.argv[3], 'cwd': '$(pwd)'}))
" "$_FIXIT_LAST_FAILED_CMD" "${_FIXIT_LAST_EC:-1}" "$cmd" 2>/dev/null)

      [[ -n "$accept_payload" ]] && node "${_FIXIT_DIR}/../bin/cli.js" accept "$accept_payload" 2>/dev/null &
      _FIXIT_SUGGESTION=""
    fi
  fi
}

bind -x '"\t":_fixit_tab_complete' 2>/dev/null

if [[ -n "${PROMPT_COMMAND}" ]]; then
  case "${PROMPT_COMMAND}" in *_fixit_on_prompt*) ;; *) PROMPT_COMMAND="_fixit_on_prompt; ${PROMPT_COMMAND}" ;; esac
else
  PROMPT_COMMAND="_fixit_on_prompt"
fi
