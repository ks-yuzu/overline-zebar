import { useQuery } from '@tanstack/react-query';
import * as zebar from 'zebar';
import { CLAUDE_USAGE_COMMAND } from './config';

export type ClaudeUsagePeriod = {
  used_percent: number;
  resets_at?: string;
  resets_at_display: string;
  timezone: string;
};

export type ClaudeUsageHistorySample = {
  recorded_at: number;
  session_used_percent: number;
  week_used_percent: number;
  session_resets_at?: string;
  week_resets_at?: string;
};

export type ClaudeUsageData = {
  source: string;
  generated_at: string;
  refresh_status: 'last_known' | 'not_reported';
  last_known_age?: string;
  current_session: ClaudeUsagePeriod;
  current_week: ClaudeUsagePeriod;
  history: ClaudeUsageHistorySample[];
};

function isUsagePeriod(value: unknown): value is ClaudeUsagePeriod {
  if (!value || typeof value !== 'object') return false;
  const period = value as Partial<ClaudeUsagePeriod>;
  return (
    typeof period.used_percent === 'number' &&
    Number.isFinite(period.used_percent) &&
    typeof period.resets_at_display === 'string' &&
    typeof period.timezone === 'string' &&
    (period.resets_at === undefined || typeof period.resets_at === 'string')
  );
}

function isHistorySample(value: unknown): value is ClaudeUsageHistorySample {
  if (!value || typeof value !== 'object') return false;
  const sample = value as Partial<ClaudeUsageHistorySample>;
  return (
    typeof sample.recorded_at === 'number' &&
    Number.isFinite(sample.recorded_at) &&
    typeof sample.session_used_percent === 'number' &&
    Number.isFinite(sample.session_used_percent) &&
    typeof sample.week_used_percent === 'number' &&
    Number.isFinite(sample.week_used_percent) &&
    (sample.session_resets_at === undefined ||
      typeof sample.session_resets_at === 'string') &&
    (sample.week_resets_at === undefined ||
      typeof sample.week_resets_at === 'string')
  );
}

function parseClaudeUsage(value: string): ClaudeUsageData {
  const parsed = JSON.parse(value) as Partial<ClaudeUsageData>;

  if (
    typeof parsed.generated_at !== 'string' ||
    !isUsagePeriod(parsed.current_session) ||
    !isUsagePeriod(parsed.current_week)
  ) {
    throw new Error('Claude usage command returned an unexpected JSON shape.');
  }

  return {
    source: typeof parsed.source === 'string' ? parsed.source : 'claude /usage',
    generated_at: parsed.generated_at,
    refresh_status:
      parsed.refresh_status === 'last_known' ? 'last_known' : 'not_reported',
    last_known_age: parsed.last_known_age,
    current_session: parsed.current_session,
    current_week: parsed.current_week,
    history: Array.isArray(parsed.history)
      ? parsed.history.filter(isHistorySample)
      : [],
  };
}

async function fetchClaudeUsage(): Promise<ClaudeUsageData> {
  try {
    const result = await zebar.shellExec(
      CLAUDE_USAGE_COMMAND.program,
      CLAUDE_USAGE_COMMAND.args
    );

    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim() ||
          `Claude usage command exited with ${result.code}.`
      );
    }

    return parseClaudeUsage(result.stdout);
  } catch (error) {
    // A failure renders as a bare `--`, so log the command and the cause where
    // the widget devtools (Ctrl+Shift+I) can show them.
    console.error(
      'Claude usage fetch failed:',
      [CLAUDE_USAGE_COMMAND.program, ...CLAUDE_USAGE_COMMAND.args].join(' '),
      error
    );
    throw error;
  }
}

export function useClaudeUsage() {
  return useQuery({
    queryKey: ['claude-usage-details'],
    queryFn: fetchClaudeUsage,
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
