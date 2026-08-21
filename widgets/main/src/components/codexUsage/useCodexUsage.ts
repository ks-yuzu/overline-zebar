import { useQuery } from '@tanstack/react-query';
import * as zebar from 'zebar';
import { CODEX_USAGE_COMMAND } from './config';

export type CodexUsageWindow = {
  usedPercent: number;
  windowDurationMins: number;
  resetsAt: number;
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

  return parsed as CodexUsageData;
}

async function fetchCodexUsage(): Promise<CodexUsageData> {
  const result = await zebar.shellExec(
    CODEX_USAGE_COMMAND.program,
    CODEX_USAGE_COMMAND.args
  );

  if (result.code !== 0) {
    throw new Error(
      result.stderr.trim() || `Codex usage command exited with ${result.code}.`
    );
  }

  return parseCodexUsage(result.stdout);
}

export function useCodexUsage() {
  return useQuery({
    queryKey: ['codex-usage'],
    queryFn: fetchCodexUsage,
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
