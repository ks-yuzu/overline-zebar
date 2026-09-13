// Checks that theme tokens survive into the generated CSS as usable colors.
//
// The tokens are Tailwind colors defined as functions, and Tailwind calls them
// with an opacity only for utilities that carry an opacity variable. `stroke-*`
// carries none, so the function is called with nothing and used to interpolate
// `undefined` into the value. An invalid value takes the whole declaration with
// it, and an element that paints nothing looks like an element painted in the
// colour behind it - which is how the ring's track went unnoticed while it was
// drawing no track at all.
//
// Runs against the built output, so build packages/ui first:
//
//   CI=1 corepack pnpm --filter @overline-zebar/ui build
//   node packages/ui/test-theme-colors.mjs

import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./dist/index.css', import.meta.url), 'utf8');

/** The declarations of one class, or null when the class was never emitted. */
function ruleFor(selector) {
  const match = css.match(new RegExp(`^\\${selector} \\{\\n([^}]*)\\}`, 'm'));
  return match ? match[1].trim() : null;
}

const cases = [
  {
    name: 'no declaration interpolates an undefined opacity',
    run: () =>
      css
        .split('\n')
        .filter((line) => line.includes('undefined'))
        .slice(0, 3),
    expect: [],
  },
  {
    // The ring draws its track with this class. Without it the track is not
    // dimmed, it is absent, and a low percentage reads as a floating tick
    // rather than a slice of a circle.
    name: 'the ring track paints in the theme border colour',
    run: () => ruleFor('.stroke-border'),
    expect: 'stroke: var(--border);',
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
