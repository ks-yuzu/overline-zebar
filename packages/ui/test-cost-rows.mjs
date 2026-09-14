// Checks what a session in the cost breakdown is called, and how its amount
// reads.
//
// The helper passes both titles through rather than picking one, because the
// pick is a display decision and this is where it is made. The case that
// forces the rule is a title that is only a reference: six of the local
// transcripts are named just `#102`, and a row saying `#102` and nothing else
// does not say where the money went.
//
// Runs against the built output, which the test script compiles first:
//
//   CI=1 corepack pnpm --filter @overline-zebar/ui test

import { formatCost, formatQuota, sessionDisplayName } from './dist/utils/costRows.js';

/** A row as the helper writes it; every label but the id is optional. */
function session(fields) {
  return { session_id: 'a432d27c-b8fe-4a1a-a7d5-916f5e1257a9', cost: 1, ...fields };
}

const cases = [
  {
    name: 'a custom title with text of its own stands alone',
    run: () =>
      sessionDisplayName(
        session({
          custom_title: '#96 クォータの枯渇予測を card と graph に出す',
          ai_title: 'ポップアップパネル情報追加の検討',
        })
      ),
    expect: '#96 クォータの枯渇予測を card と graph に出す',
  },
  {
    name: 'a title that is only a reference takes the generated one as a subtitle',
    run: () =>
      sessionDisplayName(
        session({
          custom_title: '#102',
          ai_title: 'AI usage ポップアップパネル統合',
        })
      ),
    expect: '#102 AI usage ポップアップパネル統合',
  },
  {
    name: 'a reference with nothing to add stays as it is',
    run: () => sessionDisplayName(session({ custom_title: '#51' })),
    expect: '#51',
  },
  {
    name: 'a custom title that merely starts with a number is not a bare reference',
    run: () =>
      sessionDisplayName(
        session({ custom_title: '#3 things', ai_title: '生成された題' })
      ),
    expect: '#3 things',
  },
  {
    name: 'without a custom title the generated one is the name',
    run: () => sessionDisplayName(session({ ai_title: 'ツール仕様まとめ' })),
    expect: 'ツール仕様まとめ',
  },
  {
    name: 'a session with no title at all is named by its project',
    run: () => sessionDisplayName(session({ project: 'overline-zebar' })),
    expect: 'overline-zebar',
  },
  {
    // Every label but session_id is optional in the metric: a session started
    // in `/` has an empty project and arrives carrying nothing else.
    name: 'a session carrying no labels is named by the head of its id',
    run: () => sessionDisplayName(session({})),
    expect: 'a432d27c',
  },
  {
    name: 'blank labels are treated as absent, not as a name',
    run: () =>
      sessionDisplayName(
        session({ custom_title: '  ', ai_title: '', project: 'p' })
      ),
    expect: 'p',
  },
  {
    name: 'amounts read with two decimals and thousands separated',
    run: () => [formatCost(1294.871271), formatCost(94.6), formatCost(0)],
    expect: ['$1,294.87', '$94.60', '$0.00'],
  },
  {
    // Rounding these up would put a cent on each row under a total of one
    // cent. A row being present is already what says the spend was not zero:
    // the helper leaves out only what is exactly that.
    name: 'sub-cent rows do not add up to more than their total',
    run: () => [formatCost(0.004), formatCost(0.004), formatCost(0.008)],
    expect: ['$0.00', '$0.00', '$0.01'],
  },
  {
    // One decimal, because the gauge these are apportioned from reports whole
    // percent only. A second would be place value the reading does not carry.
    name: 'quota reads to one decimal',
    run: () => [formatQuota(26.98), formatQuota(4), formatQuota(0.0412)],
    expect: ['27.0%', '4.0%', '0.0%'],
  },
  {
    // The rows are read against the window's own reading, not against each
    // other, so a row can be a third of a window that is itself at 80.
    name: 'quota is a share of the limit, so rows do not run to 100',
    run: () => [formatQuota(80), formatQuota(100)],
    expect: ['80.0%', '100.0%'],
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
