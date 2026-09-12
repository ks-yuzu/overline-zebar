// Checks how the panel reads a window's recent pace, and when it refuses to.
//
// This pace is deliberately not the one the chip draws: the chip averages the
// whole window, this measures the last seventh of it. Two surfaces answering
// with different paces is the intent, so what has to hold here is that this
// one is measured correctly and stays quiet when the samples cannot support
// it - a moment stated confidently from a gap in the history looks exactly
// like one stated from a full day of it.
//
// Runs against the built output, which the test script compiles first:
//
//   CI=1 corepack pnpm --filter @overline-zebar/ui test

import { consumedOver } from './dist/utils/usageSeries.js';
import { windowPace } from './dist/utils/usageProjection.js';

const HOUR_MS = 60 * 60 * 1000;
const HOUR = 60 * 60;
const WEEK_SECONDS = 7 * 24 * HOUR;
const NOW = 1_600_000_000_000;
const NOW_SECONDS = NOW / 1000;
/** The window every sample below belongs to, unless it says otherwise. */
const END = NOW_SECONDS + 48 * HOUR;
/** The window before it, whose spending the frame may still hold. */
const OLD_END = NOW_SECONDS + HOUR;

/** Readings at `[hoursAgo, value]`, oldest first. */
function series(entries) {
  return entries.map(([hoursAgo, value, windowEndsAt = END]) => ({
    recordedAt: NOW_SECONDS - hoursAgo * HOUR,
    value,
    windowEndsAt,
  }));
}

const lastDay = { startAt: NOW_SECONDS - 24 * HOUR, endAt: NOW_SECONDS };

/** A weekly window `usedPercent` spent, resetting in 48 hours. */
function week(usedPercent) {
  return {
    usedPercent,
    resetsAt: NOW + 48 * HOUR_MS,
    windowSeconds: WEEK_SECONDS,
  };
}

const cases = [
  {
    name: 'the span is what was spent across it',
    run: () => consumedOver(series([[48, 50], [24, 60], [0, 70]]), lastDay),
    expect: 10,
  },
  {
    // A fall inside a window is the quota being handed back, never spending.
    name: 'only rises count',
    run: () => consumedOver(series([[24, 60], [12, 40], [0, 50]]), lastDay),
    expect: 10,
  },
  {
    // 60 is the baseline, then a window opens at 5 and climbs to 20.
    name: 'a window opening inside the span counts its first reading whole',
    run: () =>
      consumedOver(
        series([[24, 60], [12, 5, END + 7 * 24 * HOUR], [0, 20, END + 7 * 24 * HOUR]]),
        lastDay
      ),
    expect: 20,
  },
  {
    // The rise from a baseline an hour the wrong side of the start spans time
    // outside the range as well as inside it, and the samples do not say which
    // part happened where. Counting it whole charged a week's work to a day.
    name: 'a span whose baseline sits before an outage is not measured',
    run: () => consumedOver(series([[25, 10], [0, 70]]), lastDay),
    expect: null,
  },
  {
    // Against the start, within the tolerance the collector is allowed.
    name: 'a baseline a few minutes early still measures the span',
    run: () => consumedOver(series([[24.2, 10], [0, 70]]), lastDay),
    expect: 60,
  },
  {
    // The other end of the same requirement. Collection that stopped hours ago
    // still divides its total by the whole range, and the caller then measures
    // what is left from now: stale consumption against live time.
    name: 'a span whose newest reading stops short is not measured',
    run: () => consumedOver(series([[24, 10], [6, 70]]), lastDay),
    expect: null,
  },
  {
    // An outage wholly inside the range is not the same problem: whenever the
    // rise across it happened, it happened within the range.
    name: 'an outage inside the span still measures it',
    run: () =>
      consumedOver(series([[24, 10], [20, 20], [4, 60], [0, 70]]), lastDay),
    expect: 60,
  },
  {
    name: 'a span with no reading at or before its start is not measured',
    run: () => consumedOver(series([[12, 40], [0, 50]]), lastDay),
    expect: null,
  },
  {
    // What stands in for counting the samples: one reading would have to sit
    // within tolerance of both ends at once, and no frame here is that short.
    name: 'a lone reading cannot cover both ends of the span',
    run: () => consumedOver(series([[24, 60]]), lastDay),
    expect: null,
  },
  {
    // 10 points a day with 48 hours to run adds 20 to the 70 already spent.
    name: 'a pace inside the quota says where the window lands',
    run: () => {
      const pace = windowPace(week(70), series([[24, 60], [0, 70]]), NOW);
      return [Math.round(pace.valueAtReset), pace.exhaustsAt];
    },
    expect: [90, null],
  },
  {
    // The same pace against 85 spent: the last 15 points take 36 hours.
    name: 'a pace past the quota says when it runs out',
    run: () => {
      const pace = windowPace(week(85), series([[24, 75], [0, 85]]), NOW);
      return [
        Math.round(pace.valueAtReset),
        Math.round((pace.exhaustsAt - NOW) / HOUR_MS),
      ];
    },
    expect: [105, 36],
  },
  {
    // Spending that stopped before the frame opened is not this window's pace.
    name: 'only the last seventh of the window sets the pace',
    run: () => {
      const pace = windowPace(
        week(70),
        series([[72, 20], [48, 70], [24, 70], [0, 70]]),
        NOW
      );
      return [pace.valueAtReset, pace.exhaustsAt];
    },
    expect: [70, null],
  },
  {
    // A quota with nothing left has no pace to carry and nothing to add: the
    // card prints the 100% itself and the chart stops at the top of the plot.
    // Answered here, the reading came out differently depending on the history
    // behind it - twice, in two different ways - which a reading that says the
    // quota is gone has no business depending on. The third entry is the one
    // that got past both earlier attempts: spent, with no baseline in frame.
    name: 'a spent window is not read',
    run: () =>
      [
        [[24, 100], [0, 100]],
        [[24, 90], [0, 100]],
        [[12, 90], [0, 100]],
      ].map((entries) => windowPace(week(100), series(entries), NOW)),
    expect: [null, null, null],
  },
  {
    // Nothing spent is no pace, and the reset such a window reports still
    // slides, so there is no point on the axis to run a line to either. The
    // frame may still hold the last window's spending, which without this
    // would have an untouched quota naming a moment hours away - on a chart
    // whose axis stops at now.
    name: 'an untouched window is not read',
    run: () =>
      [
        [[24, 0], [0, 0]],
        [[24, 50, OLD_END], [12, 80, OLD_END], [1, 0], [0, 0]],
      ].map((entries) => windowPace(week(0), series(entries), NOW)),
    expect: [null, null],
  },
  {
    // Seconds past its reset the window is pinned to it, so the pace that
    // emptied the last one can be carried into this one and drawn: 30 points
    // over the frame's day, with 48 hours to run, is 60.
    name: 'a window that has just reset carries the last pace forward',
    run: () => {
      const pace = windowPace(
        week(0),
        series([[24, 50, OLD_END], [12, 80, OLD_END], [0.1, 80, OLD_END], [0, 0]]),
        NOW
      );
      return Math.round(pace.valueAtReset);
    },
    expect: 60,
  },
  {
    // 30 points a day with 48 hours to run lands exactly on 100, and a reset
    // is not an exhaustion: the quota lasted.
    name: 'a pace landing on 100 at the reset names no exhaustion',
    run: () => {
      const pace = windowPace(week(40), series([[24, 10], [0, 40]]), NOW);
      return [Math.round(pace.valueAtReset), pace.exhaustsAt];
    },
    expect: [100, null],
  },
  {
    name: 'a window whose samples do not reach back over the frame is not read',
    run: () => windowPace(week(70), series([[12, 60], [0, 70]]), NOW),
    expect: null,
  },
  {
    name: 'a window already past its reset is not read',
    run: () =>
      windowPace(
        { usedPercent: 70, resetsAt: NOW - HOUR_MS, windowSeconds: WEEK_SECONDS },
        series([[24, 60], [0, 70]]),
        NOW
      ),
    expect: null,
  },
  {
    name: 'a window with no reset time is not read',
    run: () =>
      windowPace(
        { usedPercent: 70, resetsAt: Number.NaN, windowSeconds: WEEK_SECONDS },
        series([[24, 60], [0, 70]]),
        NOW
      ),
    expect: null,
  },
];

let failures = 0;
for (const testCase of cases) {
  let got;
  try {
    got = testCase.run();
  } catch (error) {
    console.log(`not ok - ${testCase.name}`);
    console.log(`    threw    ${error}`);
    failures += 1;
    continue;
  }
  const ok = JSON.stringify(got) === JSON.stringify(testCase.expect);
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok' : 'not ok'} - ${testCase.name}`);
  if (!ok) {
    console.log(`    got      ${JSON.stringify(got)}`);
    console.log(`    expected ${JSON.stringify(testCase.expect)}`);
  }
}

console.log(
  failures
    ? `\n${failures} of ${cases.length} cases failed`
    : `\nall ${cases.length} cases pass`
);
process.exit(failures ? 1 : 0);
