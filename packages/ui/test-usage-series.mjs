// Checks how a window's trend axis is chosen, and how a reset is recognised.
//
// The axis is the part of the usage panel with no obvious wrong answer to
// point at: it is drawn from whichever end the code believes in, and a wrong
// belief still produces a plausible chart. The case this exists for was found
// by eye on a real bar - the first reading after a reset was drawn at the right
// edge of the window that had just ended, so a window with five hours to run
// read as one that had ended empty.
//
// Runs against the built output, so build packages/ui first:
//
//   CI=1 corepack pnpm --filter @overline-zebar/ui build
//   node packages/ui/test-usage-series.mjs

import {
  hasJustReset,
  selectCurrentWindow,
  windowTrendRange,
} from './dist/utils/usageSeries.js';

const WINDOW = 5 * 3600;
const NOW = 1_600_000_000;

/** A run of samples every five minutes, ending at `NOW`. */
function series(entries) {
  return entries.map(([minutesAgo, value, windowEndsAt]) => ({
    recordedAt: NOW - minutesAgo * 60,
    value,
    windowEndsAt,
  }));
}

const cases = [
  {
    name: 'a reset the newest sample has just recorded',
    run: () =>
      hasJustReset(
        series([
          [10, 21, NOW + 300],
          [5, 22, NOW + 300],
          [0, 0, NOW + WINDOW],
        ]),
        NOW
      ),
    expect: true,
  },
  {
    name: 'a quota that has been idle at zero',
    run: () =>
      hasJustReset(
        series([
          [10, 0, NOW + WINDOW - 600],
          [5, 0, NOW + WINDOW - 300],
          [0, 0, NOW + WINDOW],
        ]),
        NOW
      ),
    expect: false,
  },
  {
    // While idle the reported reset slides with the clock, and a sampling gap
    // makes consecutive readings name ends far enough apart to look like
    // different windows. Nothing fell, so nothing reset.
    name: 'a sampling gap in an idle run',
    run: () =>
      hasJustReset(
        series([
          [30, 0, NOW + WINDOW - 1800],
          [0, 0, NOW + WINDOW],
        ]),
        NOW
      ),
    expect: false,
  },
  {
    // The helper records nothing while Claude shows last-known values, and
    // cron stops with the machine, so a fall can straddle hours of silence.
    // The window may have reset and then sat unused, sliding its reset again.
    name: 'a fall read across a gap in sampling',
    run: () =>
      hasJustReset(
        series([
          [140, 45, NOW - 3600],
          [0, 0, NOW + WINDOW],
        ]),
        NOW
      ),
    expect: false,
  },
  {
    // The reading is the one after a reset, but it is an hour old: whatever it
    // says about the window ahead, "just" is no longer true.
    name: 'a post-reset reading that has since gone stale',
    run: () =>
      hasJustReset(
        series([
          [65, 45, NOW - 3600],
          [60, 0, NOW + WINDOW],
        ]),
        NOW
      ),
    expect: false,
  },
  {
    name: 'a window being spent',
    run: () =>
      hasJustReset(
        series([
          [5, 20, NOW + 3600],
          [0, 22, NOW + 3600],
        ]),
        NOW
      ),
    expect: false,
  },
  {
    // A fall inside one window is a provider correction, not a reset. Reading
    // it as one would move the axis onto a window that has not started.
    name: 'a fall to zero reported for the same window',
    run: () =>
      hasJustReset(
        series([
          [5, 22, NOW + 3600],
          [0, 0, NOW + 3600 + 60],
        ]),
        NOW
      ),
    expect: false,
  },
  {
    name: 'a history too short to compare',
    run: () => hasJustReset(series([[0, 0, NOW + WINDOW]]), NOW),
    expect: false,
  },

  {
    name: 'axis: the reading just after a reset spans the new window',
    run: () =>
      windowTrendRange({
        resetsAt: NOW + WINDOW,
        windowSeconds: WINDOW,
        usedPercent: 0,
        justReset: true,
        now: NOW,
      }),
    // The zero sits at the left edge: the window has just begun.
    expect: { startAt: NOW, endAt: NOW + WINDOW, started: true },
  },
  {
    name: 'axis: a window being spent spans the window',
    run: () =>
      windowTrendRange({
        resetsAt: NOW + 3600,
        windowSeconds: WINDOW,
        usedPercent: 22,
        justReset: false,
        now: NOW,
      }),
    expect: { startAt: NOW + 3600 - WINDOW, endAt: NOW + 3600, started: true },
  },
  {
    // Nothing spent and no reset in sight: the reported reset slides, so the
    // axis would be all future. The hours just gone are what there is.
    name: 'axis: an idle quota falls back to the hours just gone',
    run: () =>
      windowTrendRange({
        resetsAt: NOW + WINDOW,
        windowSeconds: WINDOW,
        usedPercent: 0,
        justReset: false,
        now: NOW,
      }),
    expect: { startAt: NOW - WINDOW, endAt: NOW, started: false },
  },
  {
    // An unreadable reset leaves nothing to anchor to.
    name: 'axis: no reset time falls back to the hours just gone',
    run: () =>
      windowTrendRange({
        resetsAt: Number.NaN,
        windowSeconds: WINDOW,
        usedPercent: 22,
        justReset: false,
        now: NOW,
      }),
    expect: { startAt: NOW - WINDOW, endAt: NOW, started: false },
  },
  {
    // Providers derive the window end from a moment after the reading, so the
    // sample that opens a window can sit a second before the axis that window
    // defines. Keeping it is the difference between a chart with the reading
    // on it and one that says there is nothing to show.
    name: 'window: the sample that opens it, taken a second early',
    run: () =>
      selectCurrentWindow(
        [
          { recordedAt: NOW - 300, value: 42, windowEndsAt: NOW - 300 },
          { recordedAt: NOW - 1, value: 0, windowEndsAt: NOW + WINDOW },
        ],
        {
          endsAt: NOW + WINDOW,
          started: true,
          startAt: NOW,
          endAt: NOW + WINDOW,
        }
      ).length,
    expect: 1,
  },
  {
    // The previous window's samples report their own end, so no time range is
    // needed to keep them out.
    name: 'window: samples from the window before are left out',
    run: () =>
      selectCurrentWindow(
        [
          { recordedAt: NOW - 600, value: 40, windowEndsAt: NOW - 300 },
          { recordedAt: NOW - 300, value: 42, windowEndsAt: NOW - 300 },
          { recordedAt: NOW, value: 3, windowEndsAt: NOW + WINDOW },
        ],
        {
          endsAt: NOW + WINDOW,
          started: true,
          startAt: NOW,
          endAt: NOW + WINDOW,
        }
      ).length,
    expect: 1,
  },
];

let failures = 0;
for (const testCase of cases) {
  const got = testCase.run();
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
