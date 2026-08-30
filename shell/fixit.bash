# fixit — bash integration
# Add to ~/.bashrc:  source /path/to/fixit/shell/fixit.bash
#
# Set FIXIT_CAPTURE=0 before sourcing to skip stderr capture. Without it fixit
# still catches typos, missing commands and bad paths (which it checks directly),
# but not errors it can only learn from a program's output.

[[ $- == *i* ]] || return 0
command -v node >/dev/null 2>&1 || return 0

_FIXIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_FIXIT_CLI="${_FIXIT_DIR}/bin/cli.js"
_FIXIT_SUGGESTION=""
_FIXIT_LAST_CMD=""
_FIXIT_LAST_EC=""
_FIXIT_SAVED_ERR=""

# Private, non-predictable scratch dir — the capture file holds command stderr.
if [[ -z "$_FIXIT_TMPDIR" || ! -d "$_FIXIT_TMPDIR" ]]; then
  _FIXIT_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/fixit.XXXXXXXX" 2>/dev/null)" || return 0
  _FIXIT_ERRFILE="${_FIXIT_TMPDIR}/stderr"
  trap '[[ -n "$_FIXIT_TMPDIR" ]] && rm -rf "$_FIXIT_TMPDIR"' EXIT
fi

# Point stderr at a tee that still writes through to the real terminal, so the
# user sees errors exactly as before and fixit gets a copy.
_fixit_arm() {
  [[ "${FIXIT_CAPTURE:-1}" == 0 ]] && return
  [[ -n "$_FIXIT_SAVED_ERR" ]] && return
  : > "$_FIXIT_ERRFILE" 2>/dev/null || return
  exec {_FIXIT_SAVED_ERR}>&2
  exec 2> >(tee "$_FIXIT_ERRFILE" >&"$_FIXIT_SAVED_ERR" 2>/dev/null)
}

_fixit_disarm() {
  [[ -z "$_FIXIT_SAVED_ERR" ]] && return
  exec 2>&"$_FIXIT_SAVED_ERR"
  exec {_FIXIT_SAVED_ERR}>&-
  _FIXIT_SAVED_ERR=""
}

_fixit_suggest() {
  local ec="$1"
  # A suggestion is only ever valid for the command that just ran. Clearing it
  # up front stops Ctrl+X Tab from inserting a stale fix from several prompts
  # ago, which is what happens if we return early below without resetting.
  _FIXIT_SUGGESTION=""
  [[ "$ec" -eq 0 ]] && return

  # HISTTIMEFORMAT is cleared for this call: with it set, `history` prefixes a
  # timestamp that would otherwise end up inside the command text.
  local last_cmd
  last_cmd=$(HISTTIMEFORMAT= history 1 2>/dev/null | sed 's/^ *[0-9][0-9]*[ *] *//')
  [[ -z "$last_cmd" ]] && return

  # Skip only fixit's own plumbing — not `node`/`python3`, which the old
  # skip-list silenced despite being among the most common commands to fail.
  case "$last_cmd" in
    fixit*|_fixit*|history*) return ;;
  esac

  local result
  result=$(node "$_FIXIT_CLI" hook "$last_cmd" "$ec" "$PWD" "$_FIXIT_ERRFILE" 2>/dev/null)
  [[ -z "$result" ]] && return

  local msg cmd learned
  # 0x1f, not tab: a tab is IFS whitespace, so repeated ones collapse and a
  # fix with no command would shift the learned flag into the command slot.
  IFS=$'\x1f' read -r msg cmd learned <<< "$result"
  [[ -z "$msg" ]] && return

  _FIXIT_LAST_CMD="$last_cmd"
  _FIXIT_LAST_EC="$ec"

  # Purple when the fix came from this user's own accepted history.
  if [[ "$learned" == "1" ]]; then
    printf '  \033[35m● %s\033[0m\n' "$msg"
  else
    printf '  \033[36m● %s\033[0m\n' "$msg"
  fi

  if [[ -n "$cmd" ]]; then
    _FIXIT_SUGGESTION="$cmd"
    printf '  \033[33m[Ctrl+X Tab to run]\033[0m %s\n' "$cmd"
  else
    _FIXIT_SUGGESTION=""
  fi
}

# Bash has no preexec, so one prompt hook does all three jobs in order:
# restore stderr, report on the command that just failed, re-arm for the next.
_fixit_on_prompt() {
  local ec=$?
  _fixit_disarm
  _fixit_suggest "$ec"
  _fixit_arm
  return 0
}

_fixit_accept() {
  [[ -z "$_FIXIT_SUGGESTION" ]] && return
  READLINE_LINE="$_FIXIT_SUGGESTION"
  READLINE_POINT=${#READLINE_LINE}
  # Wrapped in a subshell so interactive bash doesn't print job-control
  # notices ("[1] 12345" / "[1]+ Done ...") over the user's prompt.
  ( node "$_FIXIT_CLI" accept \
      "$_FIXIT_LAST_CMD" "${_FIXIT_LAST_EC:-1}" "$_FIXIT_SUGGESTION" "$PWD" >/dev/null 2>&1 & )
  _FIXIT_SUGGESTION=""
}

bind -x '"\C-x\t":_fixit_accept' 2>/dev/null

case "${PROMPT_COMMAND}" in
  *_fixit_on_prompt*) ;;
  '') PROMPT_COMMAND="_fixit_on_prompt" ;;
  *) PROMPT_COMMAND="_fixit_on_prompt; ${PROMPT_COMMAND}" ;;
esac
