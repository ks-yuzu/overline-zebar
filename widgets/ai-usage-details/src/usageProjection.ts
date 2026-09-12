import {
  formatRemaining,
  usableTimeZone,
  windowPace,
} from '@overline-zebar/ui';
import type { QuotaWindow, UsageHistorySample } from '@overline-zebar/ui';

/** Below this the card counts down rather than naming a date. */
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
  /** The point the chart runs its dashed line to, in epoch seconds. */
  point: { recordedAt: number; value: number };
  /** The same projection as the card's second line. */
  text: string;
};

/**
 * What the recent pace says about the rest of the window, for both the card
 * and the chart. One call rather than two, so the moment the line crosses 100%
 * is the moment the card names.
 */
export function usageProjection(
  window: QuotaWindow,
  samples: UsageHistorySample[],
  now: number,
  timeZone?: string
): UsageProjection | undefined {
  const pace = windowPace(window, samples, now);
  if (!pace) return undefined;

  if (pace.exhaustsAt === null) {
    return {
      point: {
        recordedAt: window.resetsAt / 1000,
        value: pace.valueAtReset,
      },
      /* No floor: with no exhaustion to name, the window lands at or under
         100 either way. */
      text: `${Math.round(100 - pace.valueAtReset)}% left at reset`,
    };
  }

  return {
    point: { recordedAt: pace.exhaustsAt / 1000, value: 100 },
    text:
      window.windowSeconds < RELATIVE_WINDOW_SECONDS
        ? `Runs out in ${formatRemaining(pace.exhaustsAt, now)}`
        : `Runs out ${formatMoment(pace.exhaustsAt, timeZone)}`,
  };
}
