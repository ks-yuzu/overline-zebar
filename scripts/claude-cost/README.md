# Claude cost breakdown

`claude-cost-json` answers where a week's spend went, in real USD, by session.

Claude Code's cost metric reaches Grafana with a `session_id` and nothing else
that says what the session was; `claude_session_info`, published by
[`scripts/claude-sessions`](../claude-sessions/README.md), carries the names.
This helper queries both through `gcx`, joins them, and writes a JSON cache the
widget reads with `--cached-only`.

See [`docs/ai-usage-integration.md`](../../docs/ai-usage-integration.md) for the
shared architecture, stale detection, and operations runbook.

## What the window is

The week, anchored to the reset the usage helper reports: seven days back from
`current_week.resets_at` in `$HOME/.cache/claude-usage-json/usage.json`. When
that cannot be read it falls back to a plain seven days, and `window.source`
says which produced the number — the same shape of figure from a different
window is otherwise indistinguishable afterwards.

**A reset that has already passed is carried forward by whole weeks.** A usage
cache that stopped across a reset still reads, but its `resets_at` belongs to
the previous week; used as it stands, the window grows past seven days and
publishes a period that is not a week as "this week". Seven days is already
assumed by deriving the start from the reset, so the same assumption carries it
to the current window, and `window.source` becomes `usage_cache_rolled`.

**That rule is false if the provider changes the length of the week.** The
window would then drift silently; the giveaway is `window.resets_at`
disagreeing with the countdown on the chip.

## How the amount is computed

```text
per session:  sum(increase(cost[window]))
            + sum(first_over_time(cost[window]) unless (cost @ window start))
```

**`increase()` alone is short by the first exported sample of every series.**
The counter starts from an implicit zero when a session starts, Prometheus never
sees that zero, and a series that begins inside the range gets no extrapolation
to reach back to it. Measured against the full totals on 2026-09-13, that is 9%
of the week and up to 21% of a single session.

**A series that already existed at the window start is not added back.** Its
first in-window sample is the previous window's balance, not this window's
spend.

**`last_over_time()` cannot be used instead.** Resuming a session restarts its
counter, and everything before the restart would be lost — five sessions in the
measured week had one.

**All three queries are evaluated at one instant.** `--time` pins them to the
moment the helper captured; without it each is evaluated at whatever `gcx`
reaches the server, so the ranges start after the intended boundary and the
three see different moments.

**The two queries are not one PromQL expression.** `A + (B unless C)` is an
inner join: the series `unless` removes are dropped from the addition entirely,
taking their cost with them ($49.04 became $4.46 in a measured case). The error
is invisible in a week where nothing spans the boundary, because then `unless`
removes nothing — it would first appear in production at a weekly reset. The
addition is done in the helper.

## Output

```json
{"generated_at":"2026-09-14T00:07:35+09:00","currency":"USD",
 "window":{"starts_at":"…","resets_at":"…","source":"usage_cache"},
 "total":1240.45,
 "sessions":[{"session_name":"#46","custom_title":"#46","ai_title":"ツール仕様まとめ",
              "task_id":"46","project":"…","session_id":"…","cost":123.92}],
 "unresolved":{"cost":451.61,"sessions":11},
 "truncated":{"cost":283.62,"sessions":13}}
```

**The rows, `unresolved` and `truncated` add up to `total`.** Sessions past
`CLAUDE_COST_TOP` are counted rather than dropped, because an amount inside
`total` that appears nowhere else cannot be reconciled with the breakdown.
Being unnameable and not fitting on screen are different facts, so they are
counted separately.

**Sessions with no name are kept, not dropped.** They are sessions from another
machine, or ones whose transcript is gone, and leaving them out would make the
rows stop adding up to the total. They are summed into `unresolved` instead.

**The display name is not composed here.** `session_name` is a plain coalesce of
the two titles; a title that is only `#102` reads better with the generated
title appended, and that is the reader's decision, so both titles are passed
through.

**Two `claude_session_info` series for one `session_id` yield no name at all.**
Nothing says which is right, and showing one session under another's name is
worse than showing it as unresolved.

**A failed query keeps the previous reading.** The cache is reprinted unchanged,
so `generated_at` stops moving and the widget's staleness rules see it. Nothing
is published from a half-answer.

## Running it

```sh
install -Dm755 scripts/claude-cost/claude-cost-json "$HOME/bin/claude-cost-json"
claude-cost-json --force        # query and refresh the cache
claude-cost-json --cached-only  # what the widget runs; never queries
```

| Variable | Default |
| --- | --- |
| `CLAUDE_COST_CACHE_DIR` | `$HOME/.cache/claude-cost-json` |
| `CLAUDE_COST_USAGE_CACHE` | `$HOME/.cache/claude-usage-json/usage.json` |
| `CLAUDE_COST_GCX_BIN` | `gcx` |
| `CLAUDE_COST_GCX_CONTEXT` | unset — the current context |
| `CLAUDE_COST_DATASOURCE` | `grafanacloud-prom` |
| `CLAUDE_COST_TOP` | `20` |
| `CLAUDE_COST_TIMEOUT` | `30` seconds per query |
| `CLAUDE_COST_CACHE_TTL` | `240` seconds |

`gcx` must be authenticated for the user that runs this. Browser OAuth cannot
carry a cron job — its refresh token expires in a month and the job then stops
without saying so — so give cron its own context from a service-account or
access-policy token and name it with `CLAUDE_COST_GCX_CONTEXT`.

**Failures report what `gcx` said.** It writes its error to stdout and leaves
stderr empty, so reading only stderr would log an exit status and nothing else.

No raw responses are archived. The usage helper keeps them because a wrong
reading shows up days later as a shape in a 14-day graph; this output has no
history behind it, and a wrong number is gone at the next refresh.

## Tests

```sh
python3 scripts/claude-cost/test-claude-cost-json
```
