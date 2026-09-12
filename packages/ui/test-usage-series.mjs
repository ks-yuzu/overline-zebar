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
  buildDailyUsage,
  buildWindowPeaks,
  selectCurrentWindow,
  selectScopedSamples,
  windowTrendRange,
} from './dist/utils/usageSeries.js';
import { usableTimeZone } from './dist/utils/timeZone.js';

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
    // Claude counts a fixed boundary down while the quota sits unused, so an
    // idle window is one already part-way through - not one waiting to begin.
    // Anchoring anywhere else puts the axis where the card's reset is not.
    name: 'axis: an idle window spans the window its reset belongs to',
    run: () =>
      windowTrendRange({
        resetsAt: NOW + 3600,
        windowSeconds: WINDOW,
        now: NOW,
      }),
    expect: { startAt: NOW + 3600 - WINDOW, endAt: NOW + 3600, anchored: true },
  },
  {
    // Codex slides its reset to now plus the window while nothing is spent,
    // which places the reading at the axis' own origin.
    name: 'axis: a window whose reset is a full window away begins at now',
    run: () =>
      windowTrendRange({
        resetsAt: NOW + WINDOW,
        windowSeconds: WINDOW,
        now: NOW,
      }),
    expect: { startAt: NOW, endAt: NOW + WINDOW, anchored: true },
  },
  {
    // An unreadable reset leaves nothing to anchor to.
    name: 'axis: no reset time falls back to the hours just gone',
    run: () =>
      windowTrendRange({
        resetsAt: Number.NaN,
        windowSeconds: WINDOW,
        now: NOW,
      }),
    expect: { startAt: NOW - WINDOW, endAt: NOW, anchored: false },
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
          anchored: true,
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
          anchored: true,
          startAt: NOW,
          endAt: NOW + WINDOW,
        }
      ).length,
    expect: 1,
  },
  {
    // isSameWindow treats an undefined end as matching anything, so without
    // the guard a window with no end of its own takes every sample it is
    // handed - 14 days of them onto a five-hour axis. With it, the selection
    // falls back to the range, which keeps the one sample inside it.
    name: 'window: an anchored axis with no end of its own falls back to the range',
    run: () =>
      selectCurrentWindow(
        [
          { recordedAt: NOW - 600, value: 40, windowEndsAt: NOW - 300 },
          { recordedAt: NOW, value: 3, windowEndsAt: NOW + WINDOW },
        ],
        { endsAt: undefined, anchored: true, startAt: NOW, endAt: NOW + WINDOW }
      ).length,
    expect: 1,
  },
  {
    // Retention reaches back 14 days; collection started later than that. The
    // stretch before the first sample is not a stretch anything failed to
    // record, and marking it as missing paints most of a young axis.
    name: 'gaps: the stretch before the first sample is not missing data',
    run: () => {
      const start = NOW - 14 * 24 * 3600;
      const samples = [];
      // Two days of samples at the recent end, five minutes apart.
      for (let t = NOW - 2 * 24 * 3600; t <= NOW; t += 300) {
        samples.push({
          recordedAt: t,
          value: 50,
          windowEndsAt: Math.ceil(t / WINDOW) * WINDOW,
        });
      }
      const bars = buildWindowPeaks(samples, {
        startAt: start,
        endAt: NOW,
        now: NOW,
        windowSeconds: WINDOW,
      });
      return bars.filter((bar) => !bar.hasSamples).length;
    },
    expect: 0,
  },
  {
    // A gap inside the collected stretch still is missing data.
    name: 'gaps: a gap after collection began is still missing data',
    run: () => {
      const start = NOW - 14 * 24 * 3600;
      const samples = [];
      const holeStart = NOW - 24 * 3600;
      for (let t = NOW - 2 * 24 * 3600; t <= NOW; t += 300) {
        if (t >= holeStart && t < holeStart + 4 * 3600) continue;
        samples.push({
          recordedAt: t,
          value: 50,
          windowEndsAt: Math.ceil(t / WINDOW) * WINDOW,
        });
      }
      const bars = buildWindowPeaks(samples, {
        startAt: start,
        endAt: NOW,
        now: NOW,
        windowSeconds: WINDOW,
      });
      return bars.filter((bar) => !bar.hasSamples).length;
    },
    expect: 1,
  },
  {
    // The daily chart says the same thing through hasSamples rather than a
    // span, so it needs the same rule or it paints the days before collection.
    name: 'gaps: daily bars start where collection did',
    run: () => {
      const start = NOW - 14 * 24 * 3600;
      const samples = [];
      for (let t = NOW - 2 * 24 * 3600; t <= NOW; t += 3600) {
        samples.push({ recordedAt: t, value: 50, windowEndsAt: NOW + WINDOW });
      }
      const { bars } = buildDailyUsage(samples, { startAt: start, endAt: NOW });
      return bars.filter((bar) => !bar.hasSamples).length;
    },
    expect: 0,
  },
  {
    // The only place the series is cut on a rename; without it two quotas
    // read as one climbing line.
    name: "scoped series: another model's samples are left out",
    run: () =>
      selectScopedSamples(
        [
          { recordedAt: 1, week_model_label: 'Fable' },
          { recordedAt: 2, week_model_label: 'Fable 5.1' },
          { recordedAt: 3, week_model_label: 'Fable' },
        ],
        (sample) => sample.week_model_label,
        'Fable'
      ).map((sample) => sample.recordedAt),
    expect: [1, 3],
  },
  {
    // The shape of the failure, not a list of bad names: handing an
    // unusable one on throws inside render and blanks the panel.
    name: 'time zone: a name Intl refuses is dropped, not passed on',
    run: () => [
      usableTimeZone('Asia/Tokyo'),
      usableTimeZone('Not/AZone') ?? '(local)',
    ],
    expect: ['Asia/Tokyo', '(local)'],
  },
  {
    // `anchored` chooses between matching on the window's end and taking a
    // run by time. The wrong one reads a spent window with the other's rule.
    name: 'window selection: an anchored axis reads by window end, otherwise by time',
    run: () => {
      const mine = NOW + 3 * 24 * 3600;
      const other = NOW + 9 * 24 * 3600;
      // The other window's reading is below the two that follow it, so the
      // unanchored branch finds no fall to trim at and keeps all three.
      const samples = [
        { recordedAt: NOW - 2 * 3600, value: 2, windowEndsAt: other },
        { recordedAt: NOW - 3600, value: 4, windowEndsAt: mine },
        { recordedAt: NOW, value: 5, windowEndsAt: mine },
      ];
      const range = { startAt: NOW - 7 * 24 * 3600, endAt: NOW };
      return [
        selectCurrentWindow(samples, {
          ...range,
          endsAt: mine,
          anchored: true,
        }).map((point) => point.value),
        selectCurrentWindow(samples, {
          ...range,
          endsAt: mine,
          anchored: false,
        }).map((point) => point.value),
      ];
    },
    expect: [
      [4, 5],
      [2, 4, 5],
    ],
  },
];

let failures = 0;
for (const testCase of cases) {
  // A throw used to take the whole run down, unreported.
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
