# Claude usage integration

This optional integration displays the current Claude session and weekly usage
in the main Zebar widget. An authenticated Claude Code process refreshes a JSON
cache in WSL, while Zebar only reads the cached value.

## WSL setup

Install `expect`, Perl, and `flock`, then install the helper:

```sh
install -Dm755 scripts/claude-usage/claude-usage-json \
  "$HOME/bin/claude-usage-json"
```

Claude Code must already be authenticated for the WSL user that runs the
helper. Confirm the live refresh and JSON output with:

```sh
claude-usage-json --force
```

Install the entries in `crontab.example` with `crontab -e`. The cache is stored
at `$HOME/.cache/claude-usage-json/usage.json`; the main widget reads it once a
minute without starting a new Claude process.

## Zebar setup

The machine-specific WSL command is isolated in
`widgets/main/src/components/claudeUsage/config.ts`. When using another WSL
distribution, user, or helper path, change that new file and the matching
`wsl.exe` permission in `zpack.json` together.

The default values in this branch are:

- Distribution: `<wsl-distribution>`
- WSL user: `<wsl-user>`
- Helper: `$HOME/bin/claude-usage-json`

After changing the settings, rebuild the main widget:

```sh
pnpm --filter @overline-zebar/main build
```

## Helper options

- `--force`: refresh the cache by opening Claude Code `/usage`.
- `--cached-only`: print the existing cache without opening Claude Code.

Environment variables provide optional overrides:

- `CLAUDE_USAGE_TIMEOUT` (default: `45` seconds)
- `CLAUDE_USAGE_CACHE_TTL` (default: `300` seconds)
- `CLAUDE_USAGE_CACHE_DIR`
- `CLAUDE_USAGE_CLAUDE_BIN`
- `CLAUDE_USAGE_SESSION_ID`
- `CLAUDE_USAGE_WORK_DIR` (default: `/tmp`)
- `CLAUDE_USAGE_CAPTURE_PATH` (debug capture; may contain terminal output)
