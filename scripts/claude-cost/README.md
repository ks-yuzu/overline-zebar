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

## How the quota share is computed

The same window's `claude_usage_used_percent`, split across the sessions that
moved it. **Cost cannot stand in for this.** In one measured five-hour window
the biggest spender held 10.9% of the limit while the second held 26.9%: the
dollars and the tokens agree with each other and the quota agrees with neither,
so no single rate for the window can produce both columns.

```text
boundaries:  window start → each moment the gauge rose → now
each rise is split by the share of cost since the boundary before it
```

**The boundaries are the gauge's own ticks, not a fixed grid.** The gauge reports
whole percent only, so a five-minute grid leaves buckets holding cost and no
rise — 35% of a window's spend, measured. That spend reaches no row at all,
while the rise it caused turns up in a later bucket and goes whole to whoever
was running then.

**Both ends of the window are pinned**: zero at the start, the measured reading
at now. Without that the total is only "first sample to last sample", which
loses the window's head and tail (2 of 3 in a measured five-hour window, 1 of 25
in the week). **What makes the rows add up to the gauge is the pinning, not the
precision of the queries.**

**The increments are not built in PromQL.** `delta` and `increase` both
extrapolate, so neighbouring differences do not sum to the difference of the
endpoints. The gauge's own values are fetched and subtracted in the helper.

**Read with `max by (window)`, not filtered to one instance.** Several hosts
report the same account's figure — two of them measured, agreeing exactly at
177.0 over 24 hours — and picking one loses every rise that happened while that
host was down.

**Range queries are split into twelve-hour spans.** `gcx` raises the step on its
own when a range is long: 300s holds to 12h (145 points), 18h becomes 600s, and
a 7d range in one call becomes 900s. **Nothing in the response says the step
changed.** A full week is 28 calls.

**None of it goes in a subquery.** `(cost share * quota rise)[6h:5m]` and longer
returns zero **without an error**; `[1h:5m]` is correct, and either half alone is
correct even at `[24h:5m]`. Only the product of two metrics over a long subquery
breaks, and it breaks silently.

**A quota that cannot be read does not fail the cost.** The range queries are 28
of the week's calls against the cost side's 3; letting them take the cache down
to its previous copy would let **the failure rate of the 28 decide the freshness
of the 3**. `quota` becomes `null` and the cost columns stand.

### How far to trust it

**The total is exact.** Rows plus `unresolved` plus `unattributed` equals the
measured `used_percent` — zero difference in both windows, measured.

```sh
CLAUDE_COST_GCX_CONTEXT=cron claude-cost-json --force | python3 -c '
import json, sys
for name, w in json.load(sys.stdin)["windows"].items():
    q = w.get("quota")
    if not q: print(name, "quota unavailable"); continue
    parts = sum(r["quota"] for r in w["sessions"]) + w["unresolved"].get("quota", 0)
    print(f"{name}: {parts + q[\"unattributed\"]:.2f} vs measured {q[\"used_percent\"]:.2f}")'
```

**A single row is an approximation.** Moving the spacing from five minutes to
fifteen moves a row by about a tenth of the window's total, and **going finer
does not converge** (21% from 60s to 120s, 12% to 300s, 7% to 600s): 24 hours
hold only 69 rises, and a fine grid just hands each one whole to whoever moved
in that minute.

**The direction of the attribution has been checked.** Taking stretches where
exactly one session ran, from 60-second raw data: stretches over ten minutes
land 90–100% on that session at any spacing from 5 to 15 minutes. Shorter ones
do not, having no room to be separated. Shifting the quota by one bucket strands
24–29 points in stretches with no cost and moves the split by 20–24%; unshifted
it strands none.

**Do not trust the ratio of dollars to quota.** Models explain part of it — a
mostly-Fable session measured $1.83/point against $2.5–6.4 for Opus ones — but
two sessions with near-identical token counts, token mixes and dollar amounts
came out 2.3× apart in quota, and **whether that remainder is real or an error
in the split cannot be told from this data.** Integer rounding was ruled out
(moving to tick boundaries shifts a row by at most 2.3 points) and so was a time
offset (±5 minutes is the optimum, ±10 is worse).

**`unattributed` is not `unresolved`.** `unresolved` is spend whose session is
known but unnamed, and it goes away once the emitter runs on the other machine.
`unattributed` is quota from a stretch where nothing reported spend at all, and
naming sessions will not touch it. **Both are reported**, or the column stops
adding up to the reading above it and the shortfall reads as rounding.

## Output

```json
{"generated_at":"2026-09-14T00:07:35+09:00","currency":"USD",
 "windows":{
   "session":{"starts_at":"…","resets_at":"…","source":"usage_cache","total":21.12,
              "sessions":[…],"unresolved":{…},"quota":{…}},
   "week":{"starts_at":"…","resets_at":"…","source":"usage_cache","total":1246.03,
           "sessions":[{"session_name":"#46","custom_title":"#46",
                        "ai_title":"ツール仕様まとめ","task_id":"46","project":"…",
                        "session_id":"…","cost":123.92,"quota":8.64}],
           "unresolved":{"cost":451.61,"sessions":11,"quota":3.2},
           "quota":{"used_percent":25.0,"unattributed":1.0}}}}
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

Each refresh makes seven instant queries — one for the names, and for each
window two for the cost and one for the quota gauge — plus two range queries per
twelve hours of each window. A full seven-day week is 28 of those, about 60
seconds in all. **An outer timeout has to cover the range queries too**, or it
kills the helper before it can say why it gave up; the cron example allows 200
seconds.

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
