# fixit — zsh integration
# Add to ~/.zshrc:  source /path/to/fixit/shell/fixit.zsh
#
# Set FIXIT_CAPTURE=0 before sourcing to skip stderr capture. Without it fixit
# still catches typos, missing commands and bad paths (which it checks directly),
# but not errors it can only learn from a program's output.

[[ -o interactive ]] || return 0
(( $+commands[node] )) || return 0

autoload -U add-zsh-hook

typeset -g _FIXIT_DIR="${${(%):-%x}:A:h:h}"
typeset -g _FIXIT_CLI="${_FIXIT_DIR}/bin/cli.js"
typeset -g _FIXIT_SUGGESTION=""
typeset -g _FIXIT_LAST_CMD=""
typeset -g _FIXIT_LAST_EC=""
typeset -g _FIXIT_SAVED_ERR=""

# Private, non-predictable scratch dir — the capture file holds command stderr.
if [[ -z "$_FIXIT_TMPDIR" || ! -d "$_FIXIT_TMPDIR" ]]; then
  typeset -g _FIXIT_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/fixit.XXXXXXXX" 2>/dev/null)" || return 0
  typeset -g _FIXIT_ERRFILE="${_FIXIT_TMPDIR}/stderr"
  add-zsh-hook zshexit _fixit_cleanup
fi

_fixit_cleanup() { [[ -n "$_FIXIT_TMPDIR" ]] && rm -rf "$_FIXIT_TMPDIR"; }

_fixit_arm() {
  [[ "${FIXIT_CAPTURE:-1}" == 0 ]] && return
  [[ -n "$_FIXIT_SAVED_ERR" ]] && return
  : > "$_FIXIT_ERRFILE" 2>/dev/null || return
  # Tee through to the real terminal so the user still sees errors unchanged.
  exec {_FIXIT_SAVED_ERR}>&2
  exec 2> >(tee "$_FIXIT_ERRFILE" >&$_FIXIT_SAVED_ERR 2>/dev/null)
}

_fixit_disarm() {
  [[ -z "$_FIXIT_SAVED_ERR" ]] && return
  exec 2>&$_FIXIT_SAVED_ERR
  exec {_FIXIT_SAVED_ERR}>&-
  _FIXIT_SAVED_ERR=""
}

_fixit_preexec() {
  _FIXIT_LAST_CMD="$1"
  _fixit_arm
}

_fixit_precmd() {
  local ec=$?
  # Restore stderr first, so anything below prints to the real terminal.
  _fixit_disarm
  # A suggestion is only valid for the command that just ran; clearing it up
  # front stops Ctrl+X Tab inserting a stale fix from an earlier prompt.
  _FIXIT_SUGGESTION=""

  [[ $ec -eq 0 ]] && return
  [[ -z "$_FIXIT_LAST_CMD" ]] && return
  case "$_FIXIT_LAST_CMD" in
    fixit*|_fixit*) return ;;
  esac

  local result
  result=$(node "$_FIXIT_CLI" hook "$_FIXIT_LAST_CMD" "$ec" "$PWD" "$_FIXIT_ERRFILE" 2>/dev/null)
  [[ -z "$result" ]] && return

  local msg cmd learned
  # 0x1f, not tab: a tab is IFS whitespace, so repeated ones collapse and a
  # fix with no command would shift the learned flag into the command slot.
  IFS=$'\x1f' read -r msg cmd learned <<< "$result"
  [[ -z "$msg" ]] && return

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

_fixit_accept() {
  if [[ -n "$_FIXIT_SUGGESTION" ]]; then
    BUFFER="$_FIXIT_SUGGESTION"
    CURSOR=${#BUFFER}
    node "$_FIXIT_CLI" accept \
      "$_FIXIT_LAST_CMD" "${_FIXIT_LAST_EC:-1}" "$_FIXIT_SUGGESTION" "$PWD" >/dev/null 2>&1 &!
    _FIXIT_SUGGESTION=""
  else
    # Nothing pending: behave like the binding the user would otherwise expect.
    zle expand-or-complete
  fi
}
zle -N _fixit_accept
bindkey '^X^I' _fixit_accept

# Registered once, and never removed. The previous version called
# `add-zsh-hook -d precmd` from inside precmd itself, deleting the hook on the
# first prompt so fixit fired at most once per session.
add-zsh-hook preexec _fixit_preexec
add-zsh-hook precmd _fixit_precmd
