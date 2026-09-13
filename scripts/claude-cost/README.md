# Claude cost breakdown

`claude-cost-json` answers where a week's spend went, in real USD, by session.

Claude Code's cost metric reaches Grafana with a `session_id` and nothing else
that says what the session was; `claude_session_info`, published by
[`scripts/claude-sessions`](../claude-sessions/README.md), carries the names.
This helper queries both through `gcx`, joins them, and writes a JSON cache the
widget reads with `--cached-only`.

See [`docs/ai-usage-integration.md`](../../docs/ai-usage-integration.md) for the
shared architecture, stale detection, and operations runbook.

## What the windows are

Both of them — the five-hour session window and the seven-day week — because
every other row of the panel shows the two side by side, and a row that answers
only one of them is answering a different question than the rest.

Each is anchored to the reset the usage helper reports, in
`$HOME/.cache/claude-usage-json/usage.json`: `current_session.resets_at` less
five hours, `current_week.resets_at` less seven days. When one cannot be read it
falls back to that length back from now, and `source` says which produced the
number — the same shape of figure from a different
window is otherwise indistinguishable afterwards.

**A reset that has already passed is carried forward in whole windows.** A usage
cache that stopped across a reset still reads, but its `resets_at` belongs to
the previous window; used as it stands, the window grows past its length and
publishes a longer period as "this one". The length is already assumed by
deriving the start from the reset, so the same assumption carries it forward,
and `source` becomes `usage_cache_rolled`.

**That rule is false if the provider changes a window's length.** The window
would then drift silently; the giveaway is `resets_at` disagreeing with the
countdown on the chip. The lengths here are one more copy of a number the spec
already lists in several places — change them together.

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

**All three queries are evaluated at one instant** — both cost queries and the
one that reads the names. `--time` pins them to the moment the helper captured;
without it each is evaluated at whatever `gcx` reaches the server, so the
ranges start after the intended boundary, and a rename landing between two
queries would attach one moment's labels to another moment's costs.

**The two queries are not one PromQL expression.** `A + (B unless C)` is an
inner join: the series `unless` removes are dropped from the addition entirely,
taking their cost with them ($49.04 became $4.46 in a measured case). The error
is invisible in a week where nothing spans the boundary, because then `unless`
removes nothing — it would first appear in production at a weekly reset. The
addition is done in the helper.

## Output

```json
{"generated_at":"2026-09-14T00:07:35+09:00","currency":"USD",
 "windows":{
   "session":{"starts_at":"…","resets_at":"…","source":"usage_cache","total":21.12,
              "sessions":[…],"unresolved":{…}},
   "week":{"starts_at":"…","resets_at":"…","source":"usage_cache","total":1246.03,
           "sessions":[{"session_name":"#46","custom_title":"#46",
                        "ai_title":"ツール仕様まとめ","task_id":"46","project":"…",
                        "session_id":"…","cost":123.92}],
           "unresolved":{"cost":451.61,"sessions":11}}}}
```

**Every label the emitter publishes is carried through**, so the reader can
filter on any of them. The ones the scrape adds — `agent_hostname`, `instance`,
`job` — are not: they describe the collector rather than the session, and a
change to the scrape configuration would take them away without notice.

**Every session that spent anything gets a row.** There is no cap. Cutting the
list would leave the cut amount inside `total` with nowhere to account for it,
and a reader filtering by label would come up short without being able to say
by how much — an incomplete cache built for a consumer whose needs are not
settled yet. There is nothing to bound anyway: the count is limited by how many
sessions spend money in a window, which measured 29 even over the 20 days
Prometheus keeps.

**Sessions that spent nothing are left out** — exactly nothing, not "not much".
A session can sit inside a window without using it, seven of the ten series in
a measured five-hour window, and `increase()` reports those as exactly zero.
There is no threshold: four tenths of a cent is still spend, and dropping it
would either take it out of `total` or leave it there with nothing to account
for it. Measured across every window, nothing fell between zero and half a
cent anyway.

**The rows and `unresolved` add up to `total`.** The total is summed from the
reported amounts, so nothing counted can be missing from the breakdown.

**Amounts are not rounded.** How many decimals to show is the reader's
decision, and rounding here would make the sentence above need a caveat: rows
rounded on their own and a total rounded on its own do not have to agree. A
reader adding them back in a different order can still differ in a double's
last bits, which is a property of floating point rather than of this output,
and it is far below anything displayed.

**`unresolved` means no `claude_session_info` series at all** — a session from
another machine, or one whose transcript is gone. Leaving those out would make
the rows stop adding up to the total, so they are counted instead. **It does not
mean untitled.** A session that has not been titled yet still has info, carrying
`project`, and a row that names a project says more than "unknown" does.

**The reader takes the display name in order:** `custom_title` (with `ai_title`
appended when the custom title carries no text of its own), then `ai_title`,
then `project`, then the head of `session_id`. **That last one is not
decoration.** The emitter makes every label but `session_id` optional, so a
session whose `cwd` is `/` arrives carrying nothing else. It is still a session
we know about, so it gets a row; only a missing or ambiguous mapping goes to
`unresolved`.

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
| `CLAUDE_COST_TIMEOUT` | `30` seconds per query |
| `CLAUDE_COST_CACHE_TTL` | `240` seconds |

Each refresh makes five queries — one for the names, two for each window — so
an outer timeout has to cover five times `CLAUDE_COST_TIMEOUT` plus start-up, or
it kills the helper before it can say why it gave up.

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
