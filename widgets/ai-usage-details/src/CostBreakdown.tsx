import {
  Card,
  formatCost,
  formatQuota,
  sessionDisplayName,
} from '@overline-zebar/ui';
import { ClockAlert } from 'lucide-react';
import type { UsageStatus } from '@overline-zebar/ui';
import type { ClaudeCostWindow } from './useClaudeCost';

type Props = {
  label: string;
  /**
   * How current the cost reading is. It has its own, because the helper
   * reprints its last cache when Grafana cannot be reached - the numbers stay
   * on screen and only `generated_at` stops moving - and the header above
   * reports the usage reading, which is fetched separately and can be current
   * while this one is hours old.
   */
  status: UsageStatus | undefined;
  window: ClaudeCostWindow | undefined;
};

/** Share of the window, for the bar drawn behind each row. */
function share(cost: number, total: number) {
  return total > 0 ? Math.min(100, (cost / total) * 100) : 0;
}

/**
 * A figure column: right-aligned, and the same width down the whole card.
 *
 * Left to size themselves, a row's quota lands wherever the cost beside it
 * happens to end - across the amounts on screen that moved the percentages by
 * 43px within one card, which reads as a ragged column rather than as a number.
 */
const FIGURE_COLUMN = 'shrink-0 text-right text-xs tabular-nums';

/**
 * The cost column, held two characters clear of the quota beside it.
 *
 * The row's own `gap-2` supplies half a rem of that, so the margin makes up
 * the rest. One character was not enough to read the two as separate figures
 * when both are digits ending in the same place.
 */
const COST_COLUMN = `${FIGURE_COLUMN} ml-[calc(2ch_-_0.5rem)]`;

/**
 * How wide to hold a column: the longest figure the card is actually showing.
 *
 * In characters, and set in `ch`, which is the advance of `0` - every glyph
 * these figures are made of measures 0.6em in Geist Mono, digits, `$`, `%`,
 * `,` and `.` alike, so the column ends exactly where the widest figure does.
 *
 * **Reserving room for the widest figure the column could ever hold instead
 * charges every row for one that may never arrive.** Sized for a quota past
 * 100% and a four-figure week, the cards on screen were carrying 40px and 25px
 * of empty column, all of it taken from the session names.
 */
function columnWidth(figures: string[]): string | undefined {
  const longest = figures.reduce(
    (width, figure) => Math.max(width, figure.length),
    0
  );
  return longest ? `${longest}ch` : undefined;
}

/**
 * One window's spend, session by session.
 *
 * Every session that spent anything is here - the helper caps nothing - so
 * the list scrolls rather than being cut to a length that would make the rows
 * stop adding up to the total above them.
 */
function StaleMark({ status }: { status: UsageStatus | undefined }) {
  if (!status?.isStale) return null;
  return (
    <span className="flex items-center gap-1 text-[10px] text-warning">
      <ClockAlert className="h-3 w-3" />
      {status.label}
    </span>
  );
}

export default function CostBreakdown({
  label,
  status,
  window: costWindow,
}: Props) {
  if (!costWindow) {
    return (
      <Card className="bg-background-deeper/60 min-h-0 p-2.5">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-text-muted">{label}</p>
          <StaleMark status={status} />
        </div>
        <p className="text-xs text-text-muted">No breakdown yet</p>
      </Card>
    );
  }

  const { sessions, total, unresolved, quota } = costWindow;

  /* Every figure the card will draw, so the columns can be held at the width
     of the widest one rather than at the width of the widest one imaginable.
     The totals are in here too: they sit in these columns. */
  const quotaStyle = {
    width: columnWidth(
      quota
        ? [
            formatQuota(quota.total),
            formatQuota(quota.unattributed),
            formatQuota(unresolved.quota ?? 0),
            ...sessions.map((session) => formatQuota(session.quota ?? 0)),
          ]
        : []
    ),
  };
  const costStyle = {
    width: columnWidth([
      formatCost(total),
      formatCost(unresolved.cost),
      ...sessions.map((session) => formatCost(session.cost)),
    ]),
  };

  return (
    <Card className="bg-background-deeper/60 min-h-0 p-2.5">
      {/* `pr-2` is the gutter the list below reserves plus the padding its
          rows carry, which together are what hold a row's figures off the
          card's edge. The totals sit in the same columns as those figures, so
          each one ends where the column it totals ends. */}
      <div className="flex items-baseline justify-between gap-2 pr-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* The caption gives way, not the figures. At the narrowest panel the
              bar allows - 1366px, so a 307px card - a stale mark beside a
              four-digit total leaves this 7px short, and whichever of the two
              is not allowed to shrink is the one that leaves the card. */}
          <p className="min-w-0 truncate text-xs font-medium text-text-muted">
            {label}
          </p>
          <StaleMark status={status} />
        </div>
        {/* The totals are set at the rows' size, in the rows' columns, so that
            both of them end level with the figures they are the total of. It
            is weight and not size that tells them apart, because size would
            have to come out of the columns: at a larger size a four-figure
            total runs past its column and lands on the percentage beside it -
            $571.32, a real weekly figure, already overlaps by 3px - and
            widening the columns to fit takes the room from every session name
            below. */}
        <div className="flex shrink-0 items-baseline gap-2 font-bold">
          {/* What the rows add up to: the quota consumed during this window.
              Not the gauge's current reading and not the chip above - the
              provider resets the quota mid-window on occasion, and a measured
              week consumed 199% of the limit against a final reading of 56%.
              Reading the rows against the chip would then be reading them
              against a number they do not belong to. */}
          {quota && (
            <span className={FIGURE_COLUMN} style={quotaStyle}>
              {formatQuota(quota.total)}
            </span>
          )}
          <span className={COST_COLUMN} style={costStyle}>
            {formatCost(total)}
          </span>
        </div>
      </div>

      {/* The gutter is reserved whether or not the list is long enough to
          scroll, so the rows sit at the same right edge either way and the
          header can be inset to meet them. Padding alone does not do it: the
          scrollbar takes its 4px out of the content box only while it is
          showing, which moved the rows away from the total under them exactly
          when the card had enough rows to want the comparison. */}
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {/* Quota with no spend beside it is still something to show: a window
            can have moved while every session that moved it went unrecorded,
            and "nothing spent" would then contradict the reading above. */}
        {sessions.length === 0 &&
        unresolved.sessions === 0 &&
        !(quota && quota.unattributed > 0) ? (
          <p className="text-xs text-text-muted">
            Nothing spent in this window
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {sessions.map((session) => {
              const name = sessionDisplayName(session);
              return (
                <li className="relative" key={session.session_id}>
                  {/* The bar sits behind the text rather than beside it: at a
                      narrow panel width the names need every pixel. */}
                  <div
                    aria-hidden
                    className="absolute inset-y-0 left-0 rounded-sm bg-button-border/40"
                    style={{ width: `${share(session.cost, total)}%` }}
                  />
                  <div className="relative flex items-baseline gap-2 px-1 py-0.5">
                    <span
                      className="min-w-0 flex-1 truncate text-xs"
                      title={name}
                    >
                      {name}
                    </span>
                    {quota && (
                      <span
                        className={`${FIGURE_COLUMN} text-text-muted`}
                        style={quotaStyle}
                      >
                        {formatQuota(session.quota ?? 0)}
                      </span>
                    )}
                    <span
                      className={`${COST_COLUMN} text-text-muted`}
                      style={costStyle}
                    >
                      {formatCost(session.cost)}
                    </span>
                  </div>
                </li>
              );
            })}
            {/* Kept in the list rather than dropped: without it the rows stop
                adding up to the total, and on this machine it is a third of
                the week - sessions from another host, which gain names as soon
                as the same emitter runs there. */}
            {unresolved.sessions > 0 && (
              <li className="relative">
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 rounded-sm bg-button-border/20"
                  style={{ width: `${share(unresolved.cost, total)}%` }}
                />
                <div className="relative flex items-baseline gap-2 px-1 py-0.5">
                  <span className="min-w-0 flex-1 truncate text-xs italic text-text-muted">
                    Unresolved ({unresolved.sessions})
                  </span>
                  {quota && (
                    <span
                      className={`${FIGURE_COLUMN} text-text-muted`}
                      style={quotaStyle}
                    >
                      {formatQuota(unresolved.quota ?? 0)}
                    </span>
                  )}
                  <span
                    className={`${COST_COLUMN} text-text-muted`}
                    style={costStyle}
                  >
                    {formatCost(unresolved.cost)}
                  </span>
                </div>
              </li>
            )}
            {/* Quota that reached no session at all: the gauge rose over a
                stretch where nothing reported spend. Separate from Unresolved,
                which is spend whose session is known but unnamed - without
                this row the quota column stops adding up to the reading in
                the header, and the shortfall would look like rounding. */}
            {quota && quota.unattributed > 0 && (
              <li className="relative flex items-baseline gap-2 px-1 py-0.5">
                <span className="min-w-0 flex-1 truncate text-xs italic text-text-muted">
                  No spend recorded
                </span>
                <span
                  className={`${FIGURE_COLUMN} text-text-muted`}
                  style={quotaStyle}
                >
                  {formatQuota(quota.unattributed)}
                </span>
                <span
                  className={`${COST_COLUMN} text-text-muted`}
                  style={costStyle}
                >
                  &mdash;
                </span>
              </li>
            )}
          </ul>
        )}
      </div>
    </Card>
  );
}
