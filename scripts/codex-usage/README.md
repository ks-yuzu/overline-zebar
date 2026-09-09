# Codex usage integration

This optional integration displays Codex rate-limit usage in the main Zebar
widget. An authenticated Codex app-server refreshes a JSON cache in WSL, while
Zebar only reads the cached value.

See [`docs/ai-usage-integration.md`](../../docs/ai-usage-integration.md) for the
shared architecture, UI behavior, stale detection, and operations runbook.

The helper performs only the app-server initialization handshake and the
account-level `account/rateLimits/read` request. It never calls `thread/start`
or `turn/start`, so refreshes do not create conversation history or invoke a
model.

Each successful live refresh also stores a usage sample for every reported
rate-limit window. Samples are retained for 14 days in the existing cache.

## WSL setup

Install `jq` and `flock`, then install the helper:

```sh
install -Dm755 scripts/codex-usage/codex-usage-json \
  "$HOME/bin/codex-usage-json"
```

Codex must already be authenticated for the WSL user that runs the helper.
Confirm the live refresh and JSON output with:

```sh
codex-usage-json --force
```

The helper takes Codex from `CODEX_USAGE_CODEX_BIN`, then from `PATH`, and
fails when neither names an executable. It does not look for `node`, which the
launcher's `#!/usr/bin/env node` needs: any node it picked would be a guess at
which one the operator meant, and a version manager installs a global package
under one node version, so the launcher and its node come as a pair.

`crontab.example` asks nvm for that pair. `nvm.sh` can be sourced without an rc
file, and `nvm exec <alias>` puts the alias's bin directory in front, so both
`codex` and `node` come from the same version. Re-pointing `nvm alias default`
is then the only thing to keep current -- no path is written down here.

nvm installs a global package under one node version. After `nvm install`,
reinstall Codex under the new version (or use `--reinstall-packages-from`), or
the helper exits 69 and says so.

Install the entries in `crontab.example` with `crontab -e`. The cache is stored
at `$HOME/.cache/codex-usage-json/usage.json`; the main widget reads it once a
minute without starting a new Codex app-server.

## Zebar setup

The WSL command is isolated in
`widgets/main/src/components/codexUsage/config.ts`:

```text
wsl.exe -- sh -c '$HOME/bin/codex-usage-json --cached-only'
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

- `--force`: refresh the cache through `account/rateLimits/read`.
- `--cached-only`: print the existing cache without starting Codex.

Environment variables provide optional overrides:

- `CODEX_USAGE_TIMEOUT` (default: `15` seconds per response)
- `CODEX_USAGE_CACHE_TTL` (default: `300` seconds)
- `CODEX_USAGE_CACHE_DIR`
- `CODEX_USAGE_CODEX_BIN`
