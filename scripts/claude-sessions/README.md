# Claude session info metric

`claude-session-info-prom` publishes one Prometheus series per Claude Code
session so that cost metrics, which carry only `session_id`, can be read with a
name attached.

Claude Code's own OpenTelemetry export labels every sample with `session_id` and
nothing that says what the session was about. The transcripts under
`~/.claude/projects` hold that: the directory a session started in, and the
title it was given. This emitter reads them and writes a node_exporter textfile
collector file; the join happens in PromQL, at read time.

Resolving names through a metric rather than on the reading machine is what lets
sessions from another machine resolve too — run this emitter there as well and
its sessions gain names in the same query.

## Output

```text
claude_session_info{session_id="…",session_name="#104 …",custom_title="#104 …",
  ai_title="…",task_id="104",project="overline-zebar",cwd="/home/…"} 1
claude_session_last_activity_timestamp_seconds{session_id="…"} 1789243502
```

| Label | Source |
| --- | --- |
| `session_id` | transcript filename |
| `custom_title` | the last `customTitle` record — set by a person or a hook |
| `ai_title` | the last `aiTitle` record — generated from the conversation |
| `session_name` | `custom_title`, else `ai_title` |
| `task_id` | the `#<digits>` a `custom_title` starts with, if it does |
| `project` | basename of `cwd` |
| `cwd` | the **first** `cwd` in the transcript |

Empty values are written as no label at all, because Prometheus reads an empty
label and a missing one as the same thing. Writing `foo=""` would make a series
look replaced the first time a session is named.

**`cwd` is the first one, not the last.** A session moves into worktrees and
subdirectories as it works — 17 of 53 local transcripts hold more than one `cwd`,
one of them 11 — and the last one is wherever it happened to stop. The first is
the directory it was started in, the same one `~/.claude/projects` names its
directory after (checked against all 53: they agree).

**`task_id` is read from `custom_title` only.** A custom title is a deliberate
act of naming, where a leading `#104` can only be a reference. An `aiTitle` is
prose generated from the conversation, which is the only place a title like
`#3 things to fix` comes from. The separator matters too: titles that are just
`#102` with no text exist, so `#<digits>` must be accepted at end of string as
well as before a space.

**The rule is false when a custom title deliberately starts with a number.**
Name a session `#3 things to fix` and it will carry `task_id="3"`. The label
copies what the title starts with; it does not assert that such a task exists.
Re-check it against the titles with:

```sh
gcx metrics query -d grafanacloud-prom 'claude_session_info'
```

## Running it

With no `--output` and no `CLAUDE_SESSION_INFO_TEXTFILE_PATH`, it prints to
stdout, which is the way to look at what it would publish:

```sh
scripts/claude-sessions/claude-session-info-prom | head
```

Install it and point it at the textfile collector directory that
`--collector.textfile.directory` was given — node_exporter has no default for
it, and the emitter does not create it:

```sh
install -Dm755 scripts/claude-sessions/claude-session-info-prom \
  "$HOME/bin/claude-session-info-prom"
claude-session-info-prom --output /var/lib/textfile-collector/claude-sessions.prom
```

| Variable | Default |
| --- | --- |
| `CLAUDE_SESSION_INFO_TEXTFILE_PATH` | unset — print to stdout |
| `CLAUDE_SESSION_INFO_PROJECTS_DIR` | `$HOME/.claude/projects` |
| `CLAUDE_SESSION_INFO_MAX_AGE_DAYS` | `30` |
| `CLAUDE_SESSION_INFO_CACHE` | `$HOME/.cache/claude-session-info/scan.json` |

Transcripts last written longer ago than `MAX_AGE_DAYS` are left out. They can
no longer appear in a cost query anyway — Prometheus keeps far less than that —
and the series would accumulate for as long as the transcripts do, which with
`cleanupPeriodDays` at its default is forever.

**The scan cache is what keeps the run short.** Transcripts are append-only, so
an unchanged `mtime` and size mean unchanged contents. Reading all 53 local
transcripts (186MB on drvfs) took 12.3s; reading only the ones that changed
takes 2.0s, most of which is interpreter startup. Losing the cache costs one
slow run, not a wrong answer.

**The published titles come from conversations.** They reach Grafana alongside
the account labels the usage helper already sends, so treat the collector file
and the Prometheus instance as account information.

## Tests

```sh
python3 scripts/claude-sessions/test-claude-session-info-prom
```
