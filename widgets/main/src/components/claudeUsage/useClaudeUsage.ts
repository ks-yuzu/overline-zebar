import { useQuery } from '@tanstack/react-query';
import * as zebar from 'zebar';
import { CLAUDE_USAGE_COMMAND } from './config';

export type ClaudeUsagePeriod = {
  used_percent: number;
  resets_at?: string;
  resets_at_display: string;
  timezone: string;
};

export type ClaudeUsageData = {
  source: string;
  generated_at: string;
  refresh_status: 'last_known' | 'not_reported';
  last_known_age?: string;
  current_session: ClaudeUsagePeriod;
  current_week: ClaudeUsagePeriod;
};

function isUsagePeriod(value: unknown): value is ClaudeUsagePeriod {
  if (!value || typeof value !== 'object') return false;
  const period = value as Partial<ClaudeUsagePeriod>;
  return (
    typeof period.used_percent === 'number' &&
    Number.isFinite(period.used_percent) &&
    typeof period.resets_at_display === 'string' &&
    typeof period.timezone === 'string'
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

  return parsed as ClaudeUsageData;
}

async function fetchClaudeUsage(): Promise<ClaudeUsageData> {
  const result = await zebar.shellExec(
    CLAUDE_USAGE_COMMAND.program,
    CLAUDE_USAGE_COMMAND.args
  );

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `Claude usage command exited with ${result.code}.`
    );
  }

  return parseClaudeUsage(result.stdout);
}

export function useClaudeUsage() {
  return useQuery({
    queryKey: ['claude-usage'],
    queryFn: fetchClaudeUsage,
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
