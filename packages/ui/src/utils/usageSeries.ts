export type UsageHistorySample = {
  recordedAt: number;
  value: number;
  /**
   * Identifies the quota window the sample belongs to (a reset timestamp, for
   * instance). A change marks a reset, which breaks the cumulative series and
   * restarts consumption from zero.
   */
  windowKey?: string;
};

export type UsageBar = {
  startAt: number;
  endAt: number;
  value: number;
  hasSamples: boolean;
  /** The bar covers a window that has not reached its reset yet. */
  partial?: boolean;
};

export type DailyUsage = {
  bars: UsageBar[];
  /** Cumulative series, split at every reset so the drop is not drawn. */
  segments: { recordedAt: number; value: number }[][];
};

function startOfLocalDay(epochSeconds: number) {
  const date = new Date(epochSeconds * 1000);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

function nextLocalDay(dayStart: number) {
  const date = new Date(dayStart * 1000);
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}

type UsageWindow = {
  key: string | undefined;
  samples: UsageHistorySample[];
};

function splitIntoWindows(samples: UsageHistorySample[]): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const sample of samples) {
    const current = windows.at(-1);
    if (!current || current.key !== sample.windowKey) {
      windows.push({ key: sample.windowKey, samples: [sample] });
      continue;
    }
    current.samples.push(sample);
  }
  return windows;
}

/**
 * Turns a cumulative usage series into per-day consumption and reset-split
 * segments. Because usage only grows inside a window, a day's consumption is
 * exactly how far the cumulative line rose that day, so both share one axis.
 */
export function buildDailyUsage(
  samples: UsageHistorySample[],
  range: { startAt: number; endAt: number }
): DailyUsage {
  const withinRange = samples
    .filter(
      (sample) =>
        sample.recordedAt >= range.startAt && sample.recordedAt <= range.endAt
    )
    .sort((a, b) => a.recordedAt - b.recordedAt);

  const windows = splitIntoWindows(withinRange);
  const consumedByDay = new Map<number, number>();
  const sampledDays = new Set<number>();

  windows.forEach((usageWindow, windowIndex) => {
    // The oldest window is truncated by the retention limit, so its first
    // sample already includes consumption from before the range. Later windows
    // start at a reset, where the quota is known to have been zero.
    let previous = windowIndex === 0 ? (usageWindow.samples[0]?.value ?? 0) : 0;

    for (const sample of usageWindow.samples) {
      const day = startOfLocalDay(sample.recordedAt);
      sampledDays.add(day);
      const consumed = Math.max(0, sample.value - previous);
      consumedByDay.set(day, (consumedByDay.get(day) ?? 0) + consumed);
      previous = sample.value;
    }
  });

  const bars: UsageBar[] = [];
  for (
    let day = startOfLocalDay(range.startAt);
    day <= range.endAt;
    day = nextLocalDay(day)
  ) {
    bars.push({
      startAt: day,
      endAt: nextLocalDay(day),
      value: consumedByDay.get(day) ?? 0,
      hasSamples: sampledDays.has(day),
    });
  }

  return {
    bars,
    segments: windows.map((usageWindow) =>
      usageWindow.samples.map((sample) => ({
        recordedAt: sample.recordedAt,
        value: sample.value,
      }))
    ),
  };
}

/**
 * Reduces each quota window to a single bar spanning the window, valued at the
 * highest usage it reached. Plotting the raw series instead would alias: a 14
 * day axis resamples a five hour sawtooth far below its period.
 *
 * Usage only grows inside a window, so the peak is normally the last sample.
 * Taking the maximum instead keeps a sample that straddles a reset - already
 * back at zero, but still carrying the previous window's key - from erasing
 * the window it is grouped with.
 */
/** Below this a gap is just sampling jitter, not a window without data. */
const MISSING_WINDOW_SECONDS = 15 * 60;

export function buildWindowPeaks(
  samples: UsageHistorySample[],
  range: {
    startAt: number;
    endAt: number;
    now: number;
    windowSeconds: number;
  }
): UsageBar[] {
  const withinRange = samples
    .filter(
      (sample) =>
        sample.recordedAt >= range.startAt && sample.recordedAt <= range.endAt
    )
    .sort((a, b) => a.recordedAt - b.recordedAt);

  const peaks = splitIntoWindows(withinRange).flatMap((usageWindow) => {
    const last = usageWindow.samples.at(-1);
    if (!last) return [];

    const resetAt = usageWindow.key ? Date.parse(usageWindow.key) / 1000 : NaN;
    const endAt = Number.isFinite(resetAt) ? resetAt : last.recordedAt;
    return [
      {
        startAt: Math.max(range.startAt, endAt - range.windowSeconds),
        endAt: Math.min(range.endAt, endAt),
        value: Math.max(...usageWindow.samples.map((sample) => sample.value)),
        hasSamples: true,
        partial: endAt > range.now,
      },
    ];
  });

  // Without this a window the cron missed looks exactly like a window that
  // went unused, which is the one distinction this panel has to keep.
  const withGaps: UsageBar[] = [];
  let cursor = range.startAt;
  for (const peak of peaks) {
    if (peak.startAt - cursor > MISSING_WINDOW_SECONDS) {
      withGaps.push({
        startAt: cursor,
        endAt: peak.startAt,
        value: 0,
        hasSamples: false,
      });
    }
    withGaps.push(peak);
    cursor = Math.max(cursor, peak.endAt);
  }
  if (range.endAt - cursor > MISSING_WINDOW_SECONDS) {
    withGaps.push({
      startAt: cursor,
      endAt: range.endAt,
      value: 0,
      hasSamples: false,
    });
  }

  return withGaps;
}
