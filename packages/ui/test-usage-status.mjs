// Checks when a reading is called current and when it is called old.
//
// The panel has two sources of staleness that do not agree: the age of the
// reading, and Claude's own report that it served a last-known value. A cache
// written a minute ago can be carrying an answer from hours before, so age
// alone reads it as fresh. The two panels this replaced each had their own
// copy of the rule, which is how they came to disagree about a reading whose
// timestamp could not be parsed.
//
// Runs against the built output, so build packages/ui first:
//
//   CI=1 corepack pnpm --filter @overline-zebar/ui build
//   node packages/ui/test-usage-status.mjs

import { formatRemaining, readUsageStatus } from './dist/utils/usageStatus.js';

const NOW = Date.parse('2026-01-02T12:00:00Z');

/** A reading generated `minutes` before `NOW`. */
function generatedAgo(minutes) {
  return new Date(NOW - minutes * 60_000).toISOString();
}

const cases = [
  {
    name: 'a reading from a minute ago is current',
    run: () => readUsageStatus(generatedAgo(1), NOW),
    expect: { isStale: false, label: 'Fresh' },
  },
  {
    name: 'the threshold itself is already old',
    run: () => readUsageStatus(generatedAgo(8), NOW),
    expect: { isStale: true, label: '8m old' },
  },
  {
    name: 'a minute short of it is not',
    run: () => readUsageStatus(generatedAgo(7), NOW),
    expect: { isStale: false, label: 'Fresh' },
  },
  {
    name: 'last-known is old however recently it was written',
    run: () => readUsageStatus(generatedAgo(0), NOW, { age: '3h' }),
    expect: { isStale: true, label: 'Last known · 3h old' },
  },
  {
    name: 'last-known with no age still says so',
    run: () => readUsageStatus(generatedAgo(0), NOW, {}),
    expect: { isStale: true, label: 'Last known' },
  },
  {
    // Nothing is left to say the value is current, so it is not called current.
    name: 'an unreadable timestamp is old, not fresh',
    run: () => readUsageStatus('not a date', NOW),
    expect: { isStale: true, label: 'Unknown' },
  },
  {
    // A cache written by a host whose clock runs ahead. Counting the age
    // backwards would print a negative age or wrap into a large one.
    name: 'a reading from the future is current, not aged',
    run: () => readUsageStatus(generatedAgo(-30), NOW),
    expect: { isStale: false, label: 'Fresh' },
  },
  {
    name: 'the remaining time carries the hour when there is one',
    run: () => [
      formatRemaining(NOW + 125 * 60_000, NOW),
      formatRemaining(NOW + 120 * 60_000, NOW),
      formatRemaining(NOW + 5 * 60_000, NOW),
      formatRemaining(NOW - 60 * 60_000, NOW),
    ],
    expect: ['2h 5m', '2h', '5m', '0m'],
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
