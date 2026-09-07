import { useQuery } from '@tanstack/react-query';
import { CLAUDE_USAGE_COMMAND } from './config';
import { fetchUsageJson } from './usageCommand';

export type ClaudeUsagePeriod = {
  used_percent: number;
  resets_at?: string;
  resets_at_display: string;
  timezone: string;
};

/** A weekly window Claude scopes to one model. `label` names that model. */
export type ClaudeUsageModelPeriod = ClaudeUsagePeriod & {
  label: string;
};

export type ClaudeUsageHistorySample = {
  recorded_at: number;
  session_used_percent: number;
  week_used_percent: number;
  session_resets_at?: string;
  week_resets_at?: string;
  week_model_used_percent?: number;
  week_model_resets_at?: string;
  week_model_label?: string;
};

export type ClaudeUsageData = {
  source: string;
  generated_at: string;
  refresh_status: 'last_known' | 'not_reported';
  last_known_age?: string;
  current_session: ClaudeUsagePeriod;
  current_week: ClaudeUsagePeriod;
  /** Absent on a plan with no per-model weekly quota. */
  current_week_model?: ClaudeUsageModelPeriod;
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

/**
 * A name is required and a reset is not: the series is plotted by time, and
 * the name is what tells this window's history from the next model's.
 */
function isModelPeriod(value: unknown): value is ClaudeUsageModelPeriod {
  if (!isUsagePeriod(value)) return false;
  const period = value as Partial<ClaudeUsageModelPeriod>;
  return typeof period.label === 'string' && period.label.length > 0;
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

/** The per-model window is carried as a complete triple or not at all. */
export type ClaudeUsageModelSample = ClaudeUsageHistorySample & {
  week_model_used_percent: number;
  week_model_resets_at: string;
  week_model_label: string;
};

export function hasModelWindow(
  sample: ClaudeUsageHistorySample
): sample is ClaudeUsageModelSample {
  return (
    typeof sample.week_model_used_percent === 'number' &&
    Number.isFinite(sample.week_model_used_percent) &&
    typeof sample.week_model_resets_at === 'string' &&
    typeof sample.week_model_label === 'string'
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
    current_week_model: isModelPeriod(parsed.current_week_model)
      ? parsed.current_week_model
      : undefined,
    history: Array.isArray(parsed.history)
      ? parsed.history.filter(isHistorySample)
      : [],
  };
}

async function fetchClaudeUsage(): Promise<ClaudeUsageData> {
  return fetchUsageJson('Claude usage', CLAUDE_USAGE_COMMAND, parseClaudeUsage);
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
