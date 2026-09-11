/* Spelt with the extension, unlike every other import here: tsc emits the
   specifier as written, and the projection tests load this file in Node, which
   will not resolve an extensionless relative path. */
import { consumedOver } from './usageSeries.js';
import type { UsageHistorySample } from './usageSeries.js';

export type QuotaWindow = {
  /** Usage reported for the window, 0-100. */
  usedPercent: number;
  /** Reset time in epoch milliseconds. */
  resetsAt: number;
  windowSeconds: number;
};

/**
 * Extrapolating from a barely started window divides by a tiny elapsed
 * fraction, so the estimate swings wildly for the first minutes after a reset.
 */
const MIN_ELAPSED_FRACTION = 0.1;

/**
 * Projects what a quota window will read at its reset if the pace so far
 * holds. This is the linear assumption the detail view already draws as a pace
 * guide, expressed as a single number. Returns null while the window is too
 * young to extrapolate from.
 */
export function projectWindowUsage(
  { usedPercent, resetsAt, windowSeconds }: QuotaWindow,
  now: number
): number | null {
  if (!Number.isFinite(resetsAt) || !Number.isFinite(usedPercent)) return null;

  const windowMs = windowSeconds * 1000;
  const elapsedFraction = (windowMs - (resetsAt - now)) / windowMs;
  // A window with no duration reported divides by zero, and NaN would pass
  // both bounds below to be announced as "Projected NaN%".
  if (!Number.isFinite(elapsedFraction)) return null;
  if (elapsedFraction >= 1) return usedPercent;
  if (elapsedFraction < MIN_ELAPSED_FRACTION) return null;

  return usedPercent / elapsedFraction;
}

/**
 * The window that runs out first is the one that stops work, so a single
 * indicator has to follow the worst projection rather than an average.
 */
export function worstProjection(
  windows: QuotaWindow[],
  now: number
): number | null {
  const projected = windows
    .map((window) => projectWindowUsage(window, now))
    .filter((value): value is number => value !== null);

  return projected.length > 0 ? Math.max(...projected) : null;
}

/**
 * The trailing part of a window whose consumption sets its pace: a seventh, so
 * a week is read from the last day and a five-hour window from the last three
 * quarters of an hour.
 */
export const PACE_FRAME_DIVISOR = 7;

export type WindowPace = {
  /** Where the window lands at its reset if this pace holds. May exceed 100. */
  valueAtReset: number;
  /** When 100% is reached, in epoch milliseconds, or null if it is not. */
  exhaustsAt: number | null;
};

/**
 * What the recent pace says about the rest of a window.
 *
 * Deliberately not `projectWindowUsage`, which the chip draws: that averages
 * the whole window, which is the right reading for one bar that has to stand
 * for everything, and the wrong one for a chart that can show the last day
 * against the days before it. The two surfaces answer with different paces on
 * purpose, so a card naming an exhaustion no longer implies the chip's fill
 * has passed 100.
 *
 * The frame is allowed to cross a reset. A pace is a property of the work, not
 * of the quota it is charged to, and clipping it to the window would leave a
 * freshly reset window with minutes of history to extrapolate from.
 *
 * Null where the samples do not cover the frame, or where the window has no
 * reset still ahead of it.
 */
export function windowPace(
  window: QuotaWindow,
  samples: UsageHistorySample[],
  now: number
): WindowPace | null {
  if (!Number.isFinite(window.resetsAt) || !Number.isFinite(window.usedPercent))
    return null;

  const remainingSeconds = (window.resetsAt - now) / 1000;
  if (remainingSeconds <= 0) return null;

  const frameSeconds = window.windowSeconds / PACE_FRAME_DIVISOR;
  const consumed = consumedOver(samples, {
    startAt: now / 1000 - frameSeconds,
    endAt: now / 1000,
  });
  if (consumed === null) return null;

  const perSecond = consumed / frameSeconds;
  const valueAtReset = window.usedPercent + perSecond * remainingSeconds;

  return {
    valueAtReset,
    exhaustsAt:
      perSecond > 0 && valueAtReset > 100
        ? now + ((100 - window.usedPercent) / perSecond) * 1000
        : null,
  };
}
