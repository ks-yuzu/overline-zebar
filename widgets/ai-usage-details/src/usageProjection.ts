import {
  projectWindowUsage,
  usableTimeZone,
  windowExhaustionAt,
} from '@overline-zebar/ui';
import type { UsageWindow } from '@overline-zebar/ui';

/**
 * A window that resets several times a day is back before a projection can be
 * acted on, and its card already carries the reset as a countdown. Both the
 * line and the wording are gated here rather than at each call site, so the
 * two cannot come to differ about which windows are worth projecting.
 */
const MIN_PROJECTED_WINDOW_SECONDS = 24 * 60 * 60;

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
 * and the chart. Undefined where there is nothing worth saying: too short a
 * window, or one too young to extrapolate from.
 *
 * The two readings are one call so that the moment the line crosses 100% is
 * the moment the card names.
 */
export function usageProjection(
  window: UsageWindow,
  now: number,
  timeZone?: string
): UsageProjection | undefined {
  if (window.windowSeconds < MIN_PROJECTED_WINDOW_SECONDS) return undefined;

  const value = projectWindowUsage(window, now);
  if (value === null) return undefined;

  const exhaustsAt = windowExhaustionAt(window, now);
  return exhaustsAt === null
    ? {
        point: { recordedAt: window.resetsAt / 1000, value },
        text: `~${Math.round(100 - value)}% left at reset`,
      }
    : {
        point: { recordedAt: exhaustsAt / 1000, value: 100 },
        text: `Runs out ~${formatMoment(exhaustsAt, timeZone)}`,
      };
}
