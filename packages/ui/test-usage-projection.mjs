// Checks when a window's pace is allowed to name an exhaustion, and when it is
// not.
//
// The projection is the part of the panel with no wrong answer visible on the
// screen: a moment stated confidently from two samples looks exactly like one
// stated from a fortnight. The rules that keep it quiet - too young a window,
// a pace that never reaches 100 - only exist here, so this is where they can
// fail.
//
// Runs against the built output, which the test script compiles first:
//
//   CI=1 corepack pnpm --filter @overline-zebar/ui test

import {
  projectWindowUsage,
  windowExhaustionAt,
} from './dist/utils/usageProjection.js';

const HOUR = 60 * 60 * 1000;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const NOW = 1_600_000_000_000;

/** A weekly window `elapsedHours` old, reporting `usedPercent`. */
function week(elapsedHours, usedPercent) {
  return {
    usedPercent,
    resetsAt: NOW + (WEEK_SECONDS * 1000 - elapsedHours * HOUR),
    windowSeconds: WEEK_SECONDS,
  };
}

/** Hours from now until the window is spent, to one decimal place. */
function hoursUntilExhausted(window) {
  const at = windowExhaustionAt(window, NOW);
  return at === null ? null : Math.round(((at - NOW) / HOUR) * 10) / 10;
}

const cases = [
  {
    // Half the window gone at half the quota reaches 100 exactly at the reset,
    // and a reset is not an exhaustion: the quota lasted.
    name: 'a pace that lands on 100 at the reset names no exhaustion',
    run: () => hoursUntilExhausted(week(84, 50)),
    expect: null,
  },
  {
    name: 'a pace inside the quota names no exhaustion',
    run: () => hoursUntilExhausted(week(84, 40)),
    expect: null,
  },
  {
    // 84 hours for 70% is 1.2 hours per percent, so the last 30 take 36.
    name: 'a pace past 100 names when the quota runs out',
    run: () => hoursUntilExhausted(week(84, 70)),
    expect: 36,
  },
  {
    // The window is 168 hours, so a tenth of it is 16.8.
    name: 'a window too young to extrapolate from names nothing',
    run: () => [
      hoursUntilExhausted(week(16, 90)),
      hoursUntilExhausted(week(17, 90)),
    ],
    expect: [null, 1.9],
  },
  {
    name: 'an unused window names nothing',
    run: () => hoursUntilExhausted(week(84, 0)),
    expect: null,
  },
  {
    name: 'a window with no reset time names nothing',
    run: () =>
      hoursUntilExhausted({
        usedPercent: 90,
        resetsAt: Number.NaN,
        windowSeconds: WEEK_SECONDS,
      }),
    expect: null,
  },
  {
    // What keeps the card and the chip from telling two stories: the moment
    // exists exactly when the level the chip draws passes 100.
    name: 'an exhaustion exists exactly where the chip projects past 100',
    run: () =>
      [50, 70, 100].map((usedPercent) => {
        const window = week(84, usedPercent);
        return [
          projectWindowUsage(window, NOW) > 100,
          windowExhaustionAt(window, NOW) !== null,
        ];
      }),
    expect: [
      [false, false],
      [true, true],
      [true, true],
    ],
  },
  {
    // A quota reported spent ran out at the reading, not at some point still
    // to come: the pace that spent it reaches 100 exactly where it now is.
    name: 'a spent window names the reading itself',
    run: () => hoursUntilExhausted(week(84, 100)),
    expect: 0,
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
