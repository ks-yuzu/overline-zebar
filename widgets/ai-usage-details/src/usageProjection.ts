import {
  formatRemaining,
  usableTimeZone,
  windowPace,
} from '@overline-zebar/ui';
import type { QuotaWindow, UsageHistorySample } from '@overline-zebar/ui';

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
 * What the recent pace says about the rest of the window, for both the card
 * and the chart. Undefined where there is nothing to say - the samples do not
 * cover the frame the pace is measured over, or the reset is already past.
 *
 * The two readings come from one call so that the moment the line crosses
 * 100% is the moment the card names.
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
      text: `${Math.round(Math.max(0, 100 - pace.valueAtReset))}% left at reset`,
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
