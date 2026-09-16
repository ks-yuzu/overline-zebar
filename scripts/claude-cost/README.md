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

**The increments are not built in PromQL — neither side of the split.** For the
gauge, `delta` and `increase` both extrapolate, so neighbouring differences do
not sum to the difference of the endpoints. For the cost, a series that starts
inside an interval loses its first exported sample, because Prometheus never
sees the implicit zero a counter starts from — the same loss `window_cost`
repairs with its addback, except that here **what is lost is not an amount but a
share, so it passes straight to whoever else was running in that interval.**
Measured over 20 hours that was 11.6% of the total and −14% to +60% per session.
Both are fetched raw and subtracted in the helper.

**A counter that falls is a resumed session, and what is there after the fall is
this window's spend.** Resuming restarts the counter; five sessions in a measured
week did.

The balance a session carried into the window needs no special handling here. A
range query's steps align to the step boundary rather than to `--from`, so the
first reading of a series that already existed lands at or before the window
start, and the split only looks at intervals after it. `window_cost` has to
suppress that balance explicitly because it counts the whole window in one range
and has no such edge to hide behind.

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

**A reading that only predates the window gets no quota either.** `measured` is
read with the same fifteen-minute lookback, so just after a reset — before the
gauge's write and its scrape have caught up — it still carries the previous
window's figure. Pinned against zero at the start that reads as a single huge
rise at the head of the window, charging the previous window to whichever
sessions happened to be running just after the reset, and **no fall occurs, so
the check below cannot see it.** When nothing inside the window has been read
and `measured` is not zero, the split is withheld. A window that has simply not
been used yet reads zero and still gets its (empty) split.

**A reset inside the window is added back.** The provider clears the quota
mid-window on occasion, for incident remediation and the like: one measured week
had three (45→0, 24→5, 73→0) and consumed 199% of the limit against a final
reading of 56%. Dropping what came before would take every session that ran
before the reset out of the rows entirely. **Measured over 13 days the 5H window
had none of these, across about 105 windows — it is a 7D phenomenon.**

**A fall is a reset only if it lands below half of what it fell from.** The
gauge also revises itself downward by a point now and then, and reading one of
those as a reset puts the whole remaining value on the total again - 84→81 read
as a reset reports 165%. **A reset goes to nothing; a revision stays near the
level.** Measured, resets land on 0, 0 and 5, and revisions come to 0.92, 0.988
and 0.989 of what they fell from. **Measuring the drop instead puts the two
kinds a few points apart** - 1, 1, 1 against 19, 45, 73 - so a revision one
point past the line reads as a reset.

**Which window a reading belongs to comes from
`claude_usage_reset_timestamp_seconds`, not from its value.** For as long as the
lookback, a query inside a new window still returns the previous window's gauge:
the write and its scrape have not caught up, and the value that comes back is
indistinguishable from real consumption at the head of the window. Each reading
is paired with its own host's stamp, and only the pairs whose stamp is later
than the window start are aggregated - the previous window's reset being this
window's start, that is exactly the ones that have caught up.

**The pairing is per host, not per query.** Taking the maximum value and the
maximum stamp separately lets the stamp come from a host that has caught up
while the value comes from one that has not: measured 60 seconds after a reset,
one host read `0` with the new stamp and the other `18` with the old, and the
two maxima together would have put 18 at the head of the new window.

**A reset is an allocation boundary whether or not it lands on zero.** What sits
after a reset is what has been spent since it, so splitting it by costs from
before the reset hands quota to sessions that had already finished. A reset to
zero records no rise and would otherwise never reach the boundary code at all; a
reset that lands above zero - the measured `24→5` - records one and would
otherwise be split across the whole interval since the previous rise.

**Spend in the reset's own five-minute step stays with the side it can be read
on.** The reset happened somewhere inside that step, and nothing here says
whether a cost in it came before or after. Excluded from both sides it would
vanish from the rows while the panel says `No spend recorded` about spend that
was recorded, so the boundary is drawn one step back and the ambiguous step
counts towards the rise after the reset.

**One account is assumed, here and in the cost queries.** Neither side filters
on `user_account_uuid`, so a datasource holding two accounts would apportion one
account's gauge across both accounts' costs. **That rule is false the moment
`count(count by (user_account_uuid) (claude_usage_used_percent))` returns more
than one** — measured at 1 for both metrics across the 20 days Prometheus keeps.

**A window whose start is not a reset gets no quota at all.** The split rests
entirely on the window having begun at zero. When no reset can be read and the
start is just one length back from now, the balance sitting there arrives as a
rise just after the start and goes whole to whoever was running — up to the
entire window on one session. `source` says which windows those are; the cost
columns still stand, because a window taken slightly wrong only moves the
amounts.

**A quota that cannot be read does not fail the cost.** The range queries are 28
of the week's calls against the cost side's 3; letting them take the cache down
to its previous copy would let **the failure rate of the 28 decide the freshness
of the 3**. `quota` becomes `null` and the cost columns stand.

### How far to trust it

**The total is exact.** Rows plus `unresolved` plus `unattributed` equals
`quota.total` — zero difference in both windows, measured.

**`total` and `used_percent` are different numbers.** The first is what was
consumed during the window; the second is what the gauge reads now, which is
what the chip shows. A window the provider reset mid-way consumes more than the
gauge ends up reading, and the total then passes 100%.

**A downward revision separates them too, by its own size.** The rise before a
revision is already counted and is not given back, so the total stays at what
the gauge had reached. Measured, revisions are one point and arrive about once
a week: the 7D window read `total 37` against a gauge of 36 the day after a
34→33 revision. Giving the point back would mean taking it off a session that
has already been credited with it, which is machinery for a point a week.

```sh
CLAUDE_COST_GCX_CONTEXT=cron claude-cost-json --force | python3 -c '
import json, sys
for name, w in json.load(sys.stdin)["windows"].items():
    q = w.get("quota")
    if not q: print(name, "quota unavailable"); continue
    parts = sum(r["quota"] for r in w["sessions"]) + w["unresolved"].get("quota", 0)
    print(f"{name}: {parts + q[\"unattributed\"]:.2f} vs total {q[\"total\"]:.2f}"
          f"  (gauge {q[\"used_percent\"]:.2f})")'
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

**Spend during a gap in a series lands where the series comes back.** A session
that goes quiet drops out of the step grid and returns carrying what it did on
returning, which is where that work happened. If ingestion itself dropped
samples while work continued, the same shape would place that work later than it
happened. Measured over 24 hours: one gap with growth across it, of the harmless
kind.

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
naming sessions will not touch it. **Both are reported**, or a row that
exists goes unshown with nothing to say so. What adds up exactly is the output;
the panel rounds each row to one decimal, so the figures on screen need not sum
to the figure on screen above them.

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
           "quota":{"used_percent":25.0,"total":25.0,"unattributed":1.0}}}}
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

**A sample that is not a finite number is treated as unreadable.** Prometheus
returns `"NaN"`, and `float()` takes it. Carried through, `json.dumps` writes a
bare `NaN` and the cache that replaces the last good one is not JSON any more:
the widget's parser rejects the whole file, so the spend columns go too instead
of the quota alone. Refusing it at the parser puts it on the path below instead,
and `allow_nan=False` before the write is the last guard: finite values can
still overflow when two of them are added, as the two cost queries are. **Both
land on the same path as a failed query** - the previous cache is reprinted and
one line says why. Stopping at a traceback would keep the cache but lose that
reprint, and leave the cron log holding an exception instead of a sentence.

**A query whose value is never read does not have to have a readable value.**
`claude_session_info` always publishes 1 and only its labels are used, so
refusing a `NaN` there would let one name lookup take the run's costs down with
it. Its parser returns label sets and never looks at the number; the response
envelope is still checked the same way.

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
window two for the cost and one for the quota gauge — plus two per twelve hours of each window, one of which
fetches the cost counters unaggregated (62 series and 0.5 MB over a measured 20
hours). A full seven-day week is 28 of those, about 60 seconds in all. **An outer timeout has to cover the range queries too**, or it
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
