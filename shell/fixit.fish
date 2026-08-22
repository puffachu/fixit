# fixit fish integration
# Add to config.fish or source from terminal-fix/shell/

function __fixit_on_event --on-event fish_postexec
  set -l exit_code $status
  test $exit_code -eq 0; and return
  string match -q "fixit*" "$argv"; and return
  test -z "$argv"; and return

  set -l script_dir (dirname (status filename))
  set -l payload (python3 -c "
import json,sys
print(json.dumps({'command': sys.argv[1], 'exitCode': int(sys.argv[2]), 'output': '', 'cwd': '(pwd)'}))
" "$argv" "$exit_code" 2>/dev/null)

  test -z "$payload"; and return
  node "$script_dir/../bin/cli.js" suggest "$payload" 2>/dev/null
end
