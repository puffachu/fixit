<div align="center">

# fixit

**Zero-dependency terminal error fixer. Works offline. Learns from you.**

Your shell fails. fixit knows why — and stays quiet when it doesn't.

![fixit demo](docs/demo.gif)

</div>

---

## Why

```bash
$ gti status
gti: command not found
  ● `gti` not found. Did you mean `git`?
  [Ctrl+X Tab to run] git status
```

No API keys. No telemetry. No AI server. Just a rule engine + your own history, running locally.

## Install

```bash
curl -sL https://raw.githubusercontent.com/puffachu/fixit/main/install.sh | bash
```

Or manually:

```bash
git clone https://github.com/puffachu/fixit.git ~/.local/share/fixit
echo 'source ~/.local/share/fixit/shell/fixit.bash' >> ~/.bashrc  # or .zshrc
source ~/.bashrc
```

**What it does:**

| Error | Suggestion |
|-------|-----------|
| Typo'd binary (`gti`, `pytohn`) | Fuzzy match against PATH (`git`, `python3`) |
| Command not installed (`rg`, `jq`) | The install command for your package manager |
| Wrong path in any command | Fuzzy-corrects against the filesystem (`notes.md` → `cat notes.txt`) |
| Permission denied | Suggests `sudo` (skips if already using it) |
| Port in use | Shows what's holding the port |
| Git push rejected | `git pull --rebase && git push` |
| Docker not running | Start command for your OS |
| Missing npm/pip module | Install command, with import→package mapping (`cv2` → `opencv-python`) |
| Chained commands (`&&`) | Identifies *which* part failed, and fixes only that |
| …and more | See [`src/rules/index.js`](src/rules/index.js) |

Corrections are always whole commands, so **Ctrl+X Tab** gives you a line you can run.

## When it stays quiet

A wrong suggestion costs more than a missing one, so fixit says nothing unless it is confident:

- **Exit code 0** — nothing happens.
- **You stopped it** — Ctrl+C and SIGTERM (130/131/143) are not failures.
- **Nonzero is the answer** — `grep` with no match, `diff` on differing files, a false `test`.
- **Failing test suites** — `pytest`, `jest`, `npm test` and friends only produce a suggestion at high
  confidence (a missing import, say), never a guess about your assertions.
- **Below the confidence floor** — anything under `minConfidence` (default `0.7`) is dropped.

## It learns

Every time you press **Ctrl+X Tab** on a suggestion, fixit records it. Next time you hit *the same*
failure, it recalls your own fix first.

```bash
$ nohup ../../bin/python bot/main.py &
  ● Based on your history:          ← purple = learned from YOU
  [Ctrl+X Tab to run] nohup python3 bot/main.py &
```

"The same failure" is deliberately strict — same program, same exit code, and substantial overlap in
the command itself. A recalled fix also scores below a confident rule match, so your history can
never bury a known-correct answer. History lives in `~/.fixit/history.json`; delete it to start fresh.

## Config

Create `~/.fixit/config.json`:

```json
{
  "maxSuggestions": 3,
  "minConfidence": 0.7,
  "disabledRules": ["permission-denied-file"]
}
```

- `maxSuggestions` — how many lines to print at most (default `3`).
- `minConfidence` — raise it to `0.85` for near-silence, lower it to `0.5` to see marginal guesses.
- `disabledRules` — rule names from [`src/rules/index.js`](src/rules/index.js).

## How it works

```
Failed command → hook captures exit code + stderr + cwd
              → drops non-failures (signals, "no match", exit 0)
              → picks which part of a chain actually failed
              → checks your accepted history (gated on program + exit code + similarity)
              → matches against the built-in rules
              → drops anything under the confidence floor, dedupes
              → best suggestion printed below the prompt
              → [Ctrl+X Tab] accepts and records it; otherwise ignored
```

- **Never auto-executes**: suggestions wait for Ctrl+X Tab.
- **Ctrl+X Tab is a no-op** when there's no suggestion — it falls through to normal completion.

### stderr capture

Rules that read a program's output need a copy of stderr. The bash and zsh hooks tee it to a private
temp file and pass it through to your terminal unchanged. To opt out:

```bash
FIXIT_CAPTURE=0   # set before sourcing the hook
```

With capture off — and in fish, which has no equivalent mechanism — fixit still catches typo'd
binaries, uninstalled commands and bad paths, since it inspects PATH and the filesystem directly.
Rules that depend on a program's error text won't fire.

## Adding a rule

```js
{
  name: 'my-rule',
  match: ({ command, exitCode, output, context }) => {
    if (!output.includes('some pattern')) return null;
    return {
      message: 'Human-readable explanation',
      command: 'suggested --command',   // a whole command, not a fragment
      confidence: 0.9                   // < 0.7 will be dropped
    };
  }
}
```

`context` includes: `{ cwd, platform, isGitRepo, gitBranch, packageManager, ... }`

Confidence scale: `0.95+` the error names the problem and the fix is mechanical; `0.85` one plausible
reading of an unambiguous error; `0.7` actionable but worth a look first. Below `0.7` means stay quiet.
Set `FIXIT_DEBUG=1` to print rule exceptions instead of swallowing them.

## Test

```bash
npm test   # 46 precision + 16 engine + 6 learning
```

`test/noise.test.js` is the important one: a labelled corpus of real failures asserting both that
fixit speaks up when it should and that it stays silent when it shouldn't.

## License

MIT
