# Claude usage integration

This optional integration displays the current Claude session and weekly usage
in the main Zebar widget. The helper refreshes a JSON cache in WSL through the
usage endpoint, while Zebar only reads the cached value.

When the endpoint cannot provide a usable reading, the helper falls back to
Claude Code's screen-reader mode and opens `/usage`.

Each successful live refresh also stores a usage sample in the cache. Samples
are retained for 14 days; source-reported last-known values are not added as new
history points.

See [`docs/ai-usage-integration.md`](../../docs/ai-usage-integration.md) for the
shared architecture, UI behavior, stale detection, and operations runbook.

## Python helper

`claude-usage-json` is a compact Python 3 implementation of the JSON contract.
It uses the standard library for HTTP, parsing, caching, and locking. `expect`
is necessary only for the fallback to Claude Code's `/usage` screen.

```sh
install -Dm755 scripts/claude-usage/claude-usage-json \
  "$HOME/bin/claude-usage-json"
```

State is stored in `$HOME/.cache/claude-usage-json/`. A successful JSON
response from the endpoint is also retained byte-for-byte as
`api-response.json`. Both files are replaced atomically and use mode `0600`.
For development, set `CLAUDE_USAGE_CACHE_DIR` to a separate directory; this
keeps the normal cache untouched.

Set `CLAUDE_USAGE_TEXTFILE_PATH` to emit node_exporter's textfile collector
format after a successful refresh:

```sh
CLAUDE_USAGE_TEXTFILE_PATH=/var/lib/node_exporter/textfile_collector/claude_usage.prom \
  claude-usage-json --force
```

The parent directory must already exist. The file exposes usage and reset
gauges plus `claude_usage_generated_timestamp_seconds` and
`claude_usage_refresh_last_known`. A failed refresh does not rewrite it, so
the reading timestamp is not made artificially fresh. For example, an alert
can test:

```promql
absent(claude_usage_generated_timestamp_seconds)
or time() - claude_usage_generated_timestamp_seconds > 600
or claude_usage_refresh_last_known == 1
```

Every emitted series is labelled with `organization_id`,
`user_account_uuid`, `user_email`, and `user_id`, sourced from
`$HOME/.claude.json`. The collector output therefore contains account
identifiers and an email address; restrict its filesystem and Prometheus access
accordingly. If the complete identity is unavailable, the helper omits all four
labels rather than publishing a partial identity. This covers every metric the
helper emits, including the generated-timestamp and stale-state gauges.

Run its self-contained regression suite with:

```sh
python3 scripts/claude-usage/test-claude-usage-json
```

## WSL setup

Install Python 3 and `expect`, then install the helper:

```sh
install -Dm755 scripts/claude-usage/claude-usage-json \
  "$HOME/bin/claude-usage-json"
```

Claude Code must already be authenticated for the WSL user that runs the
helper.

The helper starts Claude Code in `$HOME/.cache/claude-usage-json/workdir`, an
empty directory it owns. Claude Code asks once whether that workspace is
trusted and waits for an answer before showing its prompt, which a cron run
cannot provide, so answer it once by hand:

```sh
mkdir -p "$HOME/.cache/claude-usage-json/workdir"
cd "$HOME/.cache/claude-usage-json/workdir" && claude
# answer `y` at the trust prompt, then exit with /exit
```

Confirm the live refresh and JSON output with:

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

## Tests

`test-claude-usage-json` covers API and screen parsing, reset normalization,
cache behavior, raw-response caching, collector output, and stale readings:

```sh
python3 scripts/claude-usage/test-claude-usage-json
```

The per-model window reaches the JSON as the optional `current_week_model`, with
the model name in its `label`. Plans without one have no such field. To see the panel as the
helper sees it, run it with the panel pinned - in `auto` the endpoint answers,
the panel never opens and no capture is written:

```sh
CLAUDE_USAGE_SOURCE=screen CLAUDE_USAGE_CAPTURE_PATH=/tmp/usage.txt \
  claude-usage-json --force
```

## Where the reading comes from

The helper asks `https://api.anthropic.com/api/oauth/usage` first, with the
OAuth access token from `$HOME/.claude/.credentials.json`. That answer names
each window (`kind`) and the model a scoped one belongs to
(`scope.model.display_name`), and gives the reset as an instant, so none of the
panel's headings have to be classified and no reset has to be dated.

Claude Code's `/usage` panel is the way back. It is opened only when opening it
would help: a refused token (the panel renews it), or an answer that is not the
reading (the endpoint has moved). A rate-limited or unreachable endpoint serves
the last cache instead - the panel's own refresh calls the same endpoint, so
escalating there would spend fourteen seconds adding to the traffic being
refused.

Since the endpoint answers on almost every run, the panel is read on almost
none, and a path nothing exercises is broken by the time it is needed. Run it
on purpose from time to time:

```sh
CLAUDE_USAGE_SOURCE=screen claude-usage-json --force
```

## Helper options

- `--force`: refresh the cache, whatever its age.
- `--cached-only`: print the existing cache without opening Claude Code.

Environment variables provide optional overrides:

- `CLAUDE_USAGE_SOURCE` (`auto` or `screen`; default `auto`)
- `CLAUDE_USAGE_API_URL` (point it at a path that does not answer to exercise
  the way back)
- `CLAUDE_USAGE_API_TIMEOUT` (default: `15` seconds)
- `CLAUDE_USAGE_TIMEOUT` (default: `45` seconds)
- `CLAUDE_USAGE_CACHE_TTL` (default: `300` seconds)
- `CLAUDE_USAGE_CACHE_DIR`
- `CLAUDE_USAGE_CLAUDE_BIN`
- `CLAUDE_USAGE_SESSION_ID`
- `CLAUDE_USAGE_WORK_DIR` (default: `$HOME/.cache/claude-usage-json/workdir`)
- `CLAUDE_USAGE_SETTLE_QUIET` (default: `4` seconds of a still screen)
- `CLAUDE_USAGE_SETTLE_CAP` (default: `25` seconds)
- `CLAUDE_USAGE_CAPTURE_PATH` (debug capture; may contain terminal output)

The panel draws in two passes and the windows Claude scopes to one model arrive
in the second, so the helper reads until the screen has been still for
`CLAUDE_USAGE_SETTLE_QUIET`, and gives up at `CLAUDE_USAGE_SETTLE_CAP` with
whatever it has. Waiting without reading does not work: `expect` logs only what
it reads, so a pause is a stretch of screen that never reaches the capture.
