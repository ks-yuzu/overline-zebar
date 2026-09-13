export type UsageHistorySample = {
  recordedAt: number;
  value: number;
  /**
   * When the window ends, in epoch seconds. This identifies the window: it is
   * pinned once usage starts and only slides while the quota sits unused.
   */
  windowEndsAt?: number;
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
  /**
   * The usage series, split where a reset is identified so the drop is not
   * drawn as a line. An off-schedule reset keeps the same reset time and so
   * cannot be identified: it stays within a segment and draws as a cliff,
   * which reads as the reset it was.
   */
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

/**
 * Providers report the window's end a little differently from one reading to
 * the next - a minute either side for Claude, seconds for Codex - so ends this
 * close apart are the same window.
 */
const WINDOW_END_TOLERANCE_SECONDS = 5 * 60;

/**
 * Keeps the samples whose scope matches. The helper does not cut a scoped
 * series when its name changes, so the cut is made here; without it two quotas
 * read as one continuous line. See docs/ai-usage-integration.md.
 */
export function selectScopedSamples<T>(
  samples: T[],
  scopeOf: (sample: T) => string | undefined,
  scope: string | undefined
): T[] {
  return samples.filter((sample) => scopeOf(sample) === scope);
}

export function isSameWindow(a: number | undefined, b: number | undefined) {
  if (a === undefined || b === undefined) return true;
  return Math.abs(a - b) <= WINDOW_END_TOLERANCE_SECONDS;
}

type UsageWindow = {
  /** Latest end seen in the run; jitter updates it without opening a window. */
  endsAt: number | undefined;
  samples: UsageHistorySample[];
  /** Whether anything has been spent in this run yet. */
  used: boolean;
};

function splitIntoWindows(samples: UsageHistorySample[]): UsageWindow[] {
  const windows: UsageWindow[] = [];
  for (const sample of samples) {
    const current = windows.at(-1);
    // A window ends where the reported end moves beyond jitter, but only once
    // something has been spent in it. While the quota sits unused that end
    // slides on its own, and there is no window there to end - the idle run
    // simply joins the window that starts next, which is where it belongs.
    //
    // Asking whether the run has seen usage, rather than whether this one
    // reading is above zero, matters when a sample lands on the reset already
    // at 0% while still carrying the old end. It joins the window it belongs
    // to, and the move that follows still closes that window; keying off the
    // previous reading alone would let the idle run swallow the next window
    // whole. Requiring a fall in usage instead would miss every reset that
    // landed inside a sampling gap, since the reading after a gap is as likely
    // to be higher as lower.
    const reset =
      current !== undefined &&
      current.used &&
      !isSameWindow(current.endsAt, sample.windowEndsAt);

    if (!current || reset) {
      windows.push({
        endsAt: sample.windowEndsAt,
        samples: [sample],
        used: sample.value > 0,
      });
      continue;
    }
    current.endsAt = sample.windowEndsAt ?? current.endsAt;
    current.used = current.used || sample.value > 0;
    current.samples.push(sample);
  }
  return windows;
}

/**
 * Turns a usage series into per-day consumption and reset-split segments.
 * Consumption is the sum of the day's rises, so for a window that only grows
 * until it resets the bars are exactly how far the line climbed that day, and
 * both share one axis. For a rolling window the line also falls as usage ages
 * out, so the bars stay meaningful while that identity no longer holds.
 */
/**
 * How much of the quota was spent over a span, in percentage points, counted
 * as the daily bars count it. Null where the span is not covered.
 * See docs/ai-usage-integration.md.
 */
export function consumedOver(
  samples: UsageHistorySample[],
  range: { startAt: number; endAt: number }
): number | null {
  const sorted = samples
    .slice()
    .sort((a, b) => a.recordedAt - b.recordedAt)
    .filter((sample) => sample.recordedAt <= range.endAt);

  // Walked back by hand: the package compiles against es2022, which has no
  // findLastIndex.
  let baselineIndex = -1;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if ((sorted[index]?.recordedAt ?? Infinity) <= range.startAt) {
      baselineIndex = index;
      break;
    }
  }
  const span = baselineIndex < 0 ? [] : sorted.slice(baselineIndex);

  /* This also stands in for counting the samples: an empty span finds no
     baseline, and a lone one would have to sit within tolerance of both ends
     at once, which no frame here is short enough to allow. */
  const baseline = span[0];
  const newest = span[span.length - 1];
  if (
    !baseline ||
    !newest ||
    range.startAt - baseline.recordedAt > MISSING_SAMPLES_SECONDS ||
    range.endAt - newest.recordedAt > MISSING_SAMPLES_SECONDS
  ) {
    return null;
  }

  let consumed = 0;
  splitIntoWindows(span).forEach((usageWindow, index) => {
    // A window opening inside the span opens empty, so its first reading is all
    // consumption; the span's own baseline stands in for the window it starts in.
    let previous = index === 0 ? (usageWindow.samples[0]?.value ?? 0) : 0;
    for (const sample of usageWindow.samples) {
      consumed += Math.max(0, sample.value - previous);
      previous = sample.value;
    }
  });

  return consumed;
}

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

  const segments = splitIntoWindows(withinRange).map((usageWindow) =>
    usageWindow.samples.map((sample) => ({
      recordedAt: sample.recordedAt,
      value: sample.value,
    }))
  );

  const consumedByDay = new Map<number, number>();
  const sampledDays = new Set<number>();

  // Only the rises count within a window: a fall is the quota being handed
  // back, never something the user spent.
  let previous = 0;
  segments.forEach((segment, index) => {
    // A window opens empty, so its first reading is all consumption. Carrying
    // the previous window's total over instead would lose everything used
    // before the first sample of the new window - the whole of it when a
    // sampling gap swallows the reset. The oldest segment is the exception:
    // retention cut it off mid-window, so its first reading is a baseline.
    previous = index === 0 ? (segment[0]?.value ?? 0) : 0;

    for (const point of segment) {
      const day = startOfLocalDay(point.recordedAt);
      sampledDays.add(day);
      consumedByDay.set(
        day,
        (consumedByDay.get(day) ?? 0) + Math.max(0, point.value - previous)
      );
      previous = point.value;
    }
  });

  const bars: UsageBar[] = [];
  // Same as the window chart: a day that ended before collection began holds no
  // data because none was being kept, which is not the same as a day the cron
  // missed. Drawn as missing it is indistinguishable, and while the history is
  // young those days are most of the axis.
  const collectionStartsAt = withinRange[0]?.recordedAt;
  for (
    let day = startOfLocalDay(range.startAt);
    day <= range.endAt;
    day = nextLocalDay(day)
  ) {
    const nextDay = nextLocalDay(day);
    if (collectionStartsAt === undefined || nextDay <= collectionStartsAt) {
      continue;
    }
    bars.push({
      startAt: day,
      endAt: nextDay,
      value: consumedByDay.get(day) ?? 0,
      hasSamples: sampledDays.has(day),
      // The day at either end of the axis is only partly inside it, so it
      // holds part of a day's consumption and cannot be read against days
      // that are whole.
      partial: day < range.startAt || nextDay > range.endAt,
    });
  }

  return { bars, segments };
}

/** Below this a gap is just sampling jitter, not a stretch without data. */
const MISSING_SAMPLES_SECONDS = 15 * 60;

/**
 * Spans of the range that hold no samples at all. Drawn apart from the windows
 * so that a stretch the cron missed does not read as a window left unused -
 * the one distinction this panel exists to make.
 *
 * A span may lie under a window bar, and is meant to: a bar covers its whole
 * window, but one sample is enough to draw it, so the stretch the bar spans is
 * not necessarily a stretch that was sampled. Clipping the span to the bar
 * would erase an outage shorter than a window instead of shrinking it. The two
 * marks say different things, and the span is drawn at a tenth of the bar's
 * opacity so the overlap tints rather than hides.
 */
function missingSpans(
  samples: UsageHistorySample[],
  range: { startAt: number; endAt: number }
) {
  const spans: { startAt: number; endAt: number }[] = [];
  // Retention reaches back further than collection does, and the stretch before
  // the first sample is not a stretch anything failed to record - nothing was
  // running yet. Marking it as missing paints most of the axis while the
  // history is young, and the mark stops meaning "the cron stopped here".
  const firstSample = samples[0];
  if (!firstSample) return spans;
  let cursor = Math.max(range.startAt, firstSample.recordedAt);
  for (const sample of samples) {
    if (sample.recordedAt - cursor > MISSING_SAMPLES_SECONDS) {
      spans.push({ startAt: cursor, endAt: sample.recordedAt });
    }
    cursor = Math.max(cursor, sample.recordedAt);
  }
  if (range.endAt - cursor > MISSING_SAMPLES_SECONDS) {
    spans.push({ startAt: cursor, endAt: range.endAt });
  }
  return spans;
}

/**
 * Reduces each quota window to a single bar spanning the window, valued at the
 * highest usage it reached. Plotting the raw series instead would alias: a 14
 * day axis resamples a five hour sawtooth far below its period.
 *
 * Usage only grows inside a window, so the peak is normally the last sample.
 * Taking the maximum instead keeps a sample that straddles a reset - already
 * back at zero, but still carrying the previous window's end - from erasing
 * the window it is grouped with.
 */
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

    const endAt = last.windowEndsAt ?? last.recordedAt;
    return [
      {
        startAt: endAt - range.windowSeconds,
        endAt: Math.min(range.endAt, endAt),
        value: Math.max(...usageWindow.samples.map((sample) => sample.value)),
        hasSamples: true,
        partial: endAt > range.now,
      },
    ];
  });

  return [
    ...peaks,
    ...missingSpans(withinRange, range).map((span) => ({
      ...span,
      value: 0,
      hasSamples: false,
    })),
  ].sort((a, b) => a.startAt - b.startAt);
}

/**
 * The axis a window's trend is drawn against: the window the provider reports,
 * ending at the reset it names.
 *
 * Both providers report a reset that contains now, but they arrive at it
 * differently. Claude counts a fixed boundary down and steps it on by a whole
 * window once it passes, so an idle quota's window began hours ago and is
 * genuinely part-way through. Codex slides its reset to now plus the window's
 * length while nothing is spent, so an idle window begins at now and the
 * reading sits at the axis' own origin. Either way `resetsAt - windowSeconds`
 * is where the window on show starts, and the axis agrees with the reset the
 * card states. Measured in docs/ai-usage-integration.md.
 *
 * Falls back to the hours just gone only where the reset is unreadable. That
 * is the absence of anything to anchor to, which is not the same as a quota
 * that has yet to be spent from.
 *
 * `now` and `resetsAt` are epoch seconds, like every recordedAt here.
 */
export function windowTrendRange(window: {
  resetsAt: number;
  windowSeconds: number;
  now: number;
}) {
  const anchored = Number.isFinite(window.resetsAt);
  const endAt = anchored ? window.resetsAt : window.now;
  return { startAt: endAt - window.windowSeconds, endAt, anchored };
}

/**
 * The samples belonging to the window on show: the ones reporting the end the
 * axis is anchored to. Where the reset was unreadable there is no end to match
 * on, and it falls back to the run since usage last fell. Selecting by time
 * range instead would carry the previous window's climb into a card labelled
 * as the current one.
 */
export function selectCurrentWindow(
  samples: UsageHistorySample[],
  window: {
    endsAt: number | undefined;
    anchored: boolean;
    startAt: number;
    endAt: number;
  }
): { recordedAt: number; value: number }[] {
  const sorted = samples
    .slice()
    .sort((a, b) => a.recordedAt - b.recordedAt)
    .map(({ recordedAt, value, windowEndsAt }) => ({
      recordedAt,
      value,
      windowEndsAt,
    }));

  // Reporting this window's end is what makes a sample part of it, and a window
  // end is unique in time, so no time range is needed to keep other windows out
  // - and using one loses the sample that opens the window. Providers derive
  // the end from a moment after the reading: one second was enough to put the
  // only sample a just-reset window had a second before its own axis began.
  // `endsAt` is what the samples are matched against, and isSameWindow treats
  // an undefined end as matching anything, so without it here every retained
  // sample would be returned for a 5-hour axis.
  if (window.anchored && window.endsAt !== undefined) {
    return sorted
      .filter(
        (sample) =>
          sample.windowEndsAt !== undefined &&
          isSameWindow(sample.windowEndsAt, window.endsAt)
      )
      .map(({ recordedAt, value }) => ({ recordedAt, value }));
  }

  const withinRange = sorted.filter(
    (sample) =>
      sample.recordedAt >= window.startAt && sample.recordedAt <= window.endAt
  );

  // No end to match on: the reading that would carry it was unreadable. The
  // run since usage last fell is the best that can be said - the climb so far,
  // or the stretch of zeros if nothing has been spent.
  let windowStart = 0;
  for (let index = withinRange.length - 1; index > 0; index -= 1) {
    const value = withinRange[index]?.value ?? 0;
    const before = withinRange[index - 1]?.value ?? 0;
    if (value < before) {
      windowStart = index;
      break;
    }
  }
  return withinRange
    .slice(windowStart)
    .map(({ recordedAt, value }) => ({ recordedAt, value }));
}
