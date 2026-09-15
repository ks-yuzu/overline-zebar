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
 * The two figure columns, at a width the figures cannot move.
 *
 * Left to size themselves, a row's quota lands wherever the cost beside it
 * happens to end - across the amounts on screen that moved the percentages by
 * 43px within one card, which reads as a ragged column rather than as a number.
 *
 * A floor rather than a fixed width, set just past what the readings actually
 * reach (measured: 7.4% and $127.00, against 36px and 50px of glyph). Every
 * ordinary row therefore lands on the floor and lines up, and the rare wider
 * one - a quota past 100% in a week the provider reset, a four-figure session -
 * takes the width it needs instead of being cut. **Sizing to the widest
 * conceivable reading instead costs every row 34px of name to keep one row
 * aligned that may never arrive.**
 */
const QUOTA_COLUMN = 'min-w-[2.5rem] shrink-0 text-right text-xs tabular-nums';
const COST_COLUMN = 'min-w-[3.5rem] shrink-0 text-right text-xs tabular-nums';

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

  return (
    <Card className="bg-background-deeper/60 min-h-0 p-2.5">
      {/* `pr-1` matches the gutter the scrolling list reserves below, so each
          total ends on the same edge as the column it totals. */}
      <div className="flex items-baseline justify-between gap-2 pr-1">
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
        <p className="shrink-0 text-base font-semibold tabular-nums">
          {/* What the rows add up to: the quota consumed during this window.
              Not the gauge's current reading and not the chip above - the
              provider resets the quota mid-window on occasion, and a measured
              week consumed 199% of the limit against a final reading of 56%.
              Reading the rows against the chip would then be reading them
              against a number they do not belong to.

              Only the cost total ends level with its column. Boxing these to
              the column widths instead would align the quota too, but they are
              set larger than the rows and a four-figure total then overflows
              its box far enough to land on the percentage beside it - $571.32,
              a real weekly figure, already overlaps by 3px. */}
          {quota && (
            <span className="mr-2 text-text-muted">
              {formatQuota(quota.total)}
            </span>
          )}
          {formatCost(total)}
        </p>
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
                      <span className={`${QUOTA_COLUMN} text-text-muted`}>
                        {formatQuota(session.quota ?? 0)}
                      </span>
                    )}
                    <span className={`${COST_COLUMN} text-text-muted`}>
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
                    <span className={`${QUOTA_COLUMN} text-text-muted`}>
                      {formatQuota(unresolved.quota ?? 0)}
                    </span>
                  )}
                  <span className={`${COST_COLUMN} text-text-muted`}>
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
                <span className={`${QUOTA_COLUMN} text-text-muted`}>
                  {formatQuota(quota.unattributed)}
                </span>
                <span className={`${COST_COLUMN} text-text-muted`}>
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
