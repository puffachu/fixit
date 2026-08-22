# fixit bash integration
# Add to ~/.bashrc: source /path/to/terminal-fix/shell/fixit.bash

_FIXIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_FIXIT_LAST_CMD=""
_FIXIT_ACTIVE=0

_fixit_preexec() {
  [[ $_FIXIT_ACTIVE -eq 1 ]] && return
  _FIXIT_LAST_CMD="$BASH_COMMAND"
}

_fixit_precmd() {
  local ec=$?
  # Reset flag
  if [[ $_FIXIT_ACTIVE -eq 1 ]]; then
    _FIXIT_ACTIVE=0
    return
  fi

  # Skip success, empty, or our own commands
  [[ $ec -eq 0 ]] && return
  [[ -z "$_FIXIT_LAST_CMD" ]] && return
  case "$_FIXIT_LAST_CMD" in
    _fixit*|_FIXIT*|node*|python3*|PROMPT_COMMAND*) return ;;
  esac

  # Mark active to prevent re-triggering
  _FIXIT_ACTIVE=1

  local payload
  payload=$(python3 -c "
import json, sys
print(json.dumps({'command': sys.argv[1], 'exitCode': int(sys.argv[2]), 'output': '', 'cwd': '$(pwd)'}))
" "$_FIXIT_LAST_CMD" "$ec" 2>/dev/null)

  if [[ -n "$payload" ]]; then
    node "${_FIXIT_DIR}/../bin/cli.js" suggest "$payload" 2>/dev/null
  fi

  _FIXIT_LAST_CMD=""
}

# Capture command via DEBUG trap (fires before each command)
trap '_fixit_preexec' DEBUG

# Run on prompt (captures exit code of previous command)
if [[ -n "${PROMPT_COMMAND}" ]]; then
  PROMPT_COMMAND="_fixit_precmd; ${PROMPT_COMMAND}"
else
  PROMPT_COMMAND="_fixit_precmd"
fi
