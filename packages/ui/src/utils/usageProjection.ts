export type UsageWindow = {
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
  { usedPercent, resetsAt, windowSeconds }: UsageWindow,
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
  windows: UsageWindow[],
  now: number
): number | null {
  const projected = windows
    .map((window) => projectWindowUsage(window, now))
    .filter((value): value is number => value !== null);

  return projected.length > 0 ? Math.max(...projected) : null;
}

/**
 * When the window reaches 100% if the pace so far holds, in epoch
 * milliseconds. Null when the window is too young to extrapolate from, and
 * null when the pace does not reach 100% before the reset - there is no
 * exhaustion to name in either case.
 *
 * Derived from the projection above rather than from the pace again, so the
 * moment named here and the level drawn on the chip are the same statement in
 * two units: one exists exactly when the other passes 100.
 */
export function windowExhaustionAt(
  window: UsageWindow,
  now: number
): number | null {
  const projected = projectWindowUsage(window, now);
  if (projected === null || projected <= 100) return null;

  const windowMs = window.windowSeconds * 1000;
  return window.resetsAt - windowMs + windowMs * (100 / projected);
}
