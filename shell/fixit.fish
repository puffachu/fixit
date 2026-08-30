# fixit — fish integration
# Add to ~/.config/fish/config.fish:
#   source /path/to/fixit/shell/fixit.fish

status is-interactive; or exit 0
type -q node; or exit 0

set -g _fixit_dir (dirname (dirname (status filename)))
set -g _fixit_cli "$_fixit_dir/bin/cli.js"
set -g _fixit_suggestion ""
set -g _fixit_last_cmd ""
set -g _fixit_last_ec ""

function __fixit_postexec --on-event fish_postexec
  set -l ec $status
  # Only the command that just ran may have a pending suggestion.
  set -g _fixit_suggestion ""
  test $ec -eq 0; and return
  test -z "$argv"; and return
  string match -q 'fixit*' -- "$argv"; and return

  # cwd must be substituted, not passed literally. The previous version sent the
  # seven characters "(pwd)" as the working directory.
  set -l result (node "$_fixit_cli" hook "$argv" "$ec" (pwd) 2>/dev/null)
  test -z "$result"; and return

  # 0x1f rather than tab, matching the other hooks: keeps empty fields intact.
  set -l fields (string split (printf '\037') -- "$result")
  set -l msg $fields[1]
  set -l cmd ""
  set -l learned "0"
  test (count $fields) -ge 2; and set cmd $fields[2]
  test (count $fields) -ge 3; and set learned $fields[3]
  test -z "$msg"; and return

  set -g _fixit_last_cmd "$argv"
  set -g _fixit_last_ec "$ec"

  # Purple when the fix came from this user's own accepted history.
  if test "$learned" = "1"
    printf '  \033[35m● %s\033[0m\n' "$msg"
  else
    printf '  \033[36m● %s\033[0m\n' "$msg"
  end

  if test -n "$cmd"
    set -g _fixit_suggestion "$cmd"
    printf '  \033[33m[Ctrl+X Tab to run]\033[0m %s\n' "$cmd"
  else
    set -g _fixit_suggestion ""
  end
end

function __fixit_accept
  if test -n "$_fixit_suggestion"
    commandline -r "$_fixit_suggestion"
    node "$_fixit_cli" accept \
      "$_fixit_last_cmd" "$_fixit_last_ec" "$_fixit_suggestion" (pwd) >/dev/null 2>&1 &
    disown 2>/dev/null
    set -g _fixit_suggestion ""
  else
    commandline -f complete
  end
end

bind \cx\t __fixit_accept 2>/dev/null
