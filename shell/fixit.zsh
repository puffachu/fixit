# fixit zsh integration
# Add to ~/.zshrc: source /path/to/terminal-fix/shell/fixit.zsh

autoload -U add-zsh-hook
typeset -g _FIXIT_SUGGESTION=""
typeset -g _FIXIT_SUGGESTION_ACTIVE=0
typeset -g _FIXIT_LAST_FAILED_CMD=""
typeset -g _FIXIT_LAST_EC=""
typeset -g _FIXIT_LAST_OUTPUT=""
typeset -g _FIXIT_SCRIPT_DIR="${0:A:h}"

_fixit_preexec() {
  # Redirect stderr to a temp file for output capture
  exec 2> >(tee /tmp/.fixit-zsh-output-$$ >&2)
}

_fixit_precmd() {
  local ec=$?
  add-zsh-hook -d precmd _fixit_precmd 2>/dev/null
  [[ $ec -eq 0 ]] && return
  [[ -z "$_FIXIT_LAST_CMD" ]] && return
  case "$_FIXIT_LAST_CMD" in fixit*|node*|python3*|_fixit*|source*) return ;; esac

  local captured_output=""
  [[ -f "/tmp/.fixit-zsh-output-$$" ]] && captured_output=$(head -c 4096 "/tmp/.fixit-zsh-output-$$" 2>/dev/null)

  local payload
  payload=$(python3 -c "
import json, sys
print(json.dumps({'command': sys.argv[1], 'exitCode': int(sys.argv[2]), 'output': sys.argv[3], 'cwd': '$(pwd)'}))
" "$_FIXIT_LAST_CMD" "$ec" "$captured_output" 2>/dev/null)

  [[ -z "$payload" ]] && return

  local result
  result=$(node "${_FIXIT_SCRIPT_DIR}/../bin/cli.js" suggest-json "$payload" 2>/dev/null)
  [[ -z "$result" ]] && return

  _FIXIT_LAST_FAILED_CMD="$_FIXIT_LAST_CMD"
  _FIXIT_LAST_EC="$ec"

  local msg cmd learned
  msg=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message',''))")
  cmd=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('command',''))")
  learned=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('learned',False))")

  [[ -z "$cmd" ]] && { echo "  ● ${msg}"; return; }

  _FIXIT_SUGGESTION="$result"
  _FIXIT_SUGGESTION_ACTIVE=1

  if [[ "$learned" == "True" ]]; then
    echo -e "  \033[35m● ${msg}\033[0m"
  else
    echo -e "  \033[36m● ${msg}\033[0m"
  fi
  echo -e "  \033[33m[Ctrl+X Tab to run] ${cmd}\033[0m"
}

_fixit_tab_complete() {
  if [[ $_FIXIT_SUGGESTION_ACTIVE -eq 1 ]]; then
    local cmd
    cmd=$(echo "$_FIXIT_SUGGESTION" | python3 -c "import json,sys; print(json.load(sys.stdin).get('command',''))")
    if [[ -n "$cmd" ]]; then
      BUFFER="$cmd"
      CURSOR=${#BUFFER}
      _FIXIT_SUGGESTION_ACTIVE=0

      local accept_payload
      accept_payload=$(python3 -c "
import json, sys
print(json.dumps({'command': sys.argv[1], 'exitCode': int(sys.argv[2]), 'suggestion': sys.argv[3], 'cwd': '$(pwd)'}))
" "$_FIXIT_LAST_FAILED_CMD" "${_FIXIT_LAST_EC:-1}" "$cmd")

      [[ -n "$accept_payload" ]] && node "${_FIXIT_SCRIPT_DIR}/../bin/cli.js" accept "$accept_payload" 2>/dev/null &
      _FIXIT_SUGGESTION=""
    fi
  fi
  zle expand-or-complete
}
zle -N _fixit_tab_complete
bindkey '^X^I' _fixit_tab_complete

add-zsh-hook preexec _fixit_preexec_store_cmd
_fixit_preexec_store_cmd() { _FIXIT_LAST_CMD="$1"; }
add-zsh-hook precmd _fixit_precmd
