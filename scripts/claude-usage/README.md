# Claude usage integration

This optional integration displays the current Claude session and weekly usage
in the main Zebar widget. An authenticated Claude Code process refreshes a JSON
cache in WSL, while Zebar only reads the cached value.

The helper starts Claude Code in screen-reader mode and waits for its input
prompt before opening `/usage`. This avoids depending on optional welcome text
that can change between Claude Code UI versions.

Each successful live refresh also stores a usage sample in the cache. Samples
are retained for 14 days; source-reported last-known values are not added as new
history points.

See [`docs/ai-usage-integration.md`](../../docs/ai-usage-integration.md) for the
shared architecture, UI behavior, stale detection, and operations runbook.

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

The WSL command is isolated in
`widgets/main/src/components/claudeUsage/config.ts`:

```text
wsl.exe -- sh -c '$HOME/bin/claude-usage-json --cached-only'
```

It carries no distribution name, user name, or absolute home path, so it runs
in the default WSL distribution as its default user. That distribution must be
the one whose cron refreshes the cache; check it with `wsl -l -v` and switch it
with `wsl --set-default <name>`, or pin `-d <name>` in the config file.

When changing the command, change the matching `wsl.exe` permission in
`zpack.json` at the same time; Zebar rejects a `shellExec` call that no
`argsRegex` matches.

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
