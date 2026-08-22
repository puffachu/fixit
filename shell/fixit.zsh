# fixit zsh integration
# Add to ~/.zshrc: source /path/to/terminal-fix/shell/fixit.zsh

autoload -U add-zsh-hook
_fixit_last_cmd=""
_fixit_last_exit=0

_fixit_preexec() {
  _fixit_last_cmd="$1"
}

_fixit_precmd() {
  local exit_code=$?
  # Only trigger on failure, skip if last command was fixit itself
  [[ $exit_code -eq 0 ]] && return
  [[ "$_fixit_last_cmd" == fixit* ]] && return
  [[ -z "$_fixit_last_cmd" ]] && return

  # Capture stderr from the failed command (best effort)
  # We re-run nothing; we just pass what we have. The hook captures output via pipe.
  # For now we use a temp file approach for stderr capture.
  local tmpfile=$(mktemp)
  # This is set by exec redirect in the wrapper below; fallback: no captured output
  local captured_output=""
  if [[ -f "$tmpfile" ]]; then
    captured_output=$(cat "$tmpfile")
    rm -f "$tmpfile"
  fi

  local payload=$(python3 -c "
import json,sys
print(json.dumps({'command': sys.argv[1], 'exitCode': int(sys.argv[2]), 'output': sys.argv[3], 'cwd': '$(pwd)'}))
" "$_fixit_last_cmd" "$exit_code" "$captured_output" 2>/dev/null)

  [[ -z "$payload" ]] && return
  node "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")/../bin/cli.js" suggest "$payload" 2>/dev/null
}

add-zsh-hook preexec _fixit_preexec
add-zsh-hook precmd _fixit_precmd
