import {
  formatRemaining,
  projectWindowUsage,
  usableTimeZone,
  windowExhaustionAt,
} from '@overline-zebar/ui';
import type { UsageWindow } from '@overline-zebar/ui';

/**
 * A window this short carries its reset as a countdown rather than a date, and
 * the projection has to read the same way: a card that counts down to its
 * reset and names a date for running out is read as two different clocks.
 */
const RELATIVE_WINDOW_SECONDS = 24 * 60 * 60;

function formatMoment(epochMs: number, timeZone: string | undefined) {
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: usableTimeZone(timeZone),
  }).format(new Date(epochMs));
}

export type UsageProjection = {
  /**
   * The point the chart runs its dashed line to, in epoch seconds as the
   * axis reads them: where 100% is reached, or where the window lands at its
   * reset when it is not.
   */
  point: { recordedAt: number; value: number };
  /** The same projection as the card's second line. */
  text: string;
};

/**
 * What the pace so far says about the rest of the window, for both the card
 * and the chart. Undefined where there is nothing worth saying: a window with
 * nothing spent, or one too young to extrapolate from.
 *
 * The two readings are one call so that the moment the line crosses 100% is
 * the moment the card names.
 */
export function usageProjection(
  window: UsageWindow,
  now: number,
  timeZone?: string
): UsageProjection | undefined {
  /* Nothing spent is no pace to carry forward. The reset such a window reports
     is still sliding - `windowTrendRange` refuses to pin its axis to it for
     that reason - so a point placed at it lands outside the axis on show.
     `windowExhaustionAt` already declines these, as its own tests hold; this
     is the same rule for the branch that has no exhaustion to decline. */
  if (window.usedPercent <= 0) return undefined;

  const value = projectWindowUsage(window, now);
  if (value === null) return undefined;

  const exhaustsAt = windowExhaustionAt(window, now);
  if (exhaustsAt === null) {
    return {
      point: { recordedAt: window.resetsAt / 1000, value },
      text: `${Math.round(100 - value)}% left at reset`,
    };
  }

  return {
    point: { recordedAt: exhaustsAt / 1000, value: 100 },
    text:
      window.windowSeconds < RELATIVE_WINDOW_SECONDS
        ? `Runs out in ${formatRemaining(exhaustsAt, now)}`
        : `Runs out ${formatMoment(exhaustsAt, timeZone)}`,
  };
}
