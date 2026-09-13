import { Card, formatCost, sessionDisplayName } from '@overline-zebar/ui';
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

  const { sessions, total, unresolved } = costWindow;

  return (
    <Card className="bg-background-deeper/60 min-h-0 p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="shrink-0 text-xs font-medium text-text-muted">{label}</p>
          <StaleMark status={status} />
        </div>
        <p className="text-base font-semibold tabular-nums">
          {formatCost(total)}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {sessions.length === 0 && unresolved.sessions === 0 ? (
          <p className="text-xs text-text-muted">Nothing spent in this window</p>
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
                  <div className="relative flex items-baseline justify-between gap-2 px-1 py-0.5">
                    <span className="min-w-0 truncate text-xs" title={name}>
                      {name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">
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
                <div className="relative flex items-baseline justify-between gap-2 px-1 py-0.5">
                  <span className="min-w-0 truncate text-xs italic text-text-muted">
                    Unresolved ({unresolved.sessions})
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-text-muted">
                    {formatCost(unresolved.cost)}
                  </span>
                </div>
              </li>
            )}
          </ul>
        )}
      </div>
    </Card>
  );
}
