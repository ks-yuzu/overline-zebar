import { useQuery } from '@tanstack/react-query';
import * as zebar from 'zebar';
import { CODEX_USAGE_COMMAND } from './config';

export type CodexUsageWindow = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
};

export type CodexUsageHistorySample = {
  recorded_at: number;
  windows: CodexUsageWindow[];
};

type CodexRateLimits = {
  limitId: string;
  limitName: string | null;
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | number | null;
  } | null;
  individualLimit: {
    limit: string;
    used: string;
    remainingPercent: number;
    resetsAt: number;
  } | null;
  spendControlReached: boolean;
  planType: string | null;
  rateLimitReachedType: string | null;
};

export type CodexUsageData = {
  source: string;
  generated_at: string;
  rate_limits: CodexRateLimits;
  history: CodexUsageHistorySample[];
};

function isUsageWindow(value: unknown): value is CodexUsageWindow {
  if (!value || typeof value !== 'object') return false;
  const window = value as Partial<CodexUsageWindow>;
  return (
    typeof window.usedPercent === 'number' &&
    Number.isFinite(window.usedPercent) &&
    typeof window.windowDurationMins === 'number' &&
    Number.isFinite(window.windowDurationMins) &&
    typeof window.resetsAt === 'number' &&
    Number.isFinite(window.resetsAt)
  );
}

function isHistorySample(value: unknown): value is CodexUsageHistorySample {
  if (!value || typeof value !== 'object') return false;
  const sample = value as Partial<CodexUsageHistorySample>;
  return (
    typeof sample.recorded_at === 'number' &&
    Number.isFinite(sample.recorded_at) &&
    Array.isArray(sample.windows) &&
    sample.windows.every(isUsageWindow)
  );
}

function parseCodexUsage(value: string): CodexUsageData {
  const parsed = JSON.parse(value) as Partial<CodexUsageData>;
  const limits = parsed.rate_limits;

  if (
    typeof parsed.generated_at !== 'string' ||
    !limits ||
    typeof limits !== 'object' ||
    (limits.primary !== null && !isUsageWindow(limits.primary)) ||
    (limits.secondary !== null && !isUsageWindow(limits.secondary))
  ) {
    throw new Error('Codex usage command returned an unexpected JSON shape.');
  }

  return {
    source:
      typeof parsed.source === 'string'
        ? parsed.source
        : 'codex app-server account/rateLimits/read',
    generated_at: parsed.generated_at,
    rate_limits: limits,
    history: Array.isArray(parsed.history)
      ? parsed.history.filter(isHistorySample)
      : [],
  };
}

async function fetchCodexUsage(): Promise<CodexUsageData> {
  try {
    const result = await zebar.shellExec(
      CODEX_USAGE_COMMAND.program,
      CODEX_USAGE_COMMAND.args
    );

    if (result.code !== 0) {
      throw new Error(
        result.stderr.trim() ||
          `Codex usage command exited with ${result.code}.`
      );
    }

    return parseCodexUsage(result.stdout);
  } catch (error) {
    // A failure renders as a bare `--`, so log the command and the cause where
    // the widget devtools (Ctrl+Shift+I) can show them.
    console.error(
      'Codex usage fetch failed:',
      [CODEX_USAGE_COMMAND.program, ...CODEX_USAGE_COMMAND.args].join(' '),
      error
    );
    throw error;
  }
}

export function useCodexUsage() {
  return useQuery({
    queryKey: ['codex-usage-details'],
    queryFn: fetchCodexUsage,
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
