<div align="center">

# fixit

**Zero-dependency terminal error fixer. Works offline. Runs on anything.**

Your shell fails. fixit knows why.

</div>

---

## Why

Every developer has been here:

```bash
$ git push
! [rejected] main -> main (non-fast-forward)
```

You know the fix. You type it every time. fixit just does it faster — **automatically, inline, with zero cloud calls**.

No API keys. No telemetry. No Node server running in the background. Just a rule engine that recognizes 25+ common failure patterns and tells you what to do next.

## Install

```bash
git clone https://github.com/YOUR_USERNAME/fixit.git
cd fixit
npm link   # optional: makes `fixit` globally available
```

Then add to your shell config:

```bash
# zsh — add to ~/.zshrc
source /path/to/fixit/shell/fixit.zsh

# bash — add to ~/.bashrc
source /path/to/fixit/shell/fixit.bash

# fish — add to ~/.config/fish/config.fish
source /path/to/fixit/shell/fixit.fish
```

Or run `fixit install` from inside a supported shell to get the snippet.

## What it catches

| Error | Suggestion |
|-------|-----------|
| `git push` rejected | `git pull --rebase && git push` |
| Permission denied | Prefix with `sudo` |
| Port already in use (`EADDRINUSE`) | `lsof -ti :PORT \| xargs kill -9` |
| Missing npm module | `npm install <module>` |
| Docker daemon not running | Start Docker |
| Disk full (`ENOSPC`) | Show disk usage breakdown |
| DNS resolution failure | Check connectivity |
| Git branch has no upstream | `git push --set-upstream origin <branch>` |
| Python module not found | `pip install <module>` |
| Process OOM-killed (exit 137) | Show memory status |
| Missing environment variable | `export VAR=` |
| SSL certificate expired | Clock/cert diagnostic |
| SSH host key changed | Key rotation warning |
| Connection refused | Service check hint |
| …and more | See [`src/rules/index.js`](src/rules/index.js) |

## How it works

```
Failed command → shell hook captures exit code + stderr
              → fixit matches against rule table
              → best suggestion printed inline below your prompt
              → Tab or Enter to dismiss; nothing is executed automatically
```

- **Silent on success**: if exit code is `0`, nothing happens
- **Silent when unsure**: no match means no output
- **Never auto-executes**: suggestions are read-only until you copy/run them

## Design principles

- **Zero runtime dependencies** — just Node.js ≥16
- **Offline first** — no network calls, ever
- **Fail silently** — never break your shell or slow down your prompt
- **Extensible** — rules are plain JS objects; PRs welcome

## Adding a rule

Open `src/rules/index.js` and append:

```js
{
  name: 'my-rule',
  match: ({ command, exitCode, output, context }) => {
    if (!output.includes('some pattern')) return null;
    return {
      message: 'Human-readable explanation',
      command: 'suggested --command',
      confidence: 0.9
    };
  }
}
```

Rules are tested against `{ command, exitCode, output, context }` where `context` includes:

```js
{
  cwd, platform,
  isGitRepo, gitBranch, gitStatus,
  packageManager,       // 'npm' | 'cargo' | 'go' | 'pip' | null
  hasNodeModules, hasDockerfile,
  shell, user, home, path_dirs
}
```

## Test

```bash
node test/engine.test.js
```

## License

MIT
