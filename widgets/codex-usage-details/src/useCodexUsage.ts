import { useQuery } from '@tanstack/react-query';
import { CODEX_USAGE_COMMAND } from './config';
import { fetchUsageJson } from './usageCommand';

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
  // Optional as well as nullable: Codex omits the key rather than sending
  // null, and the helper's jq validator treats the two alike. Declaring it
  // non-optional would let `primary === null ? … : primary.usedPercent` past
  // the compiler and throw on exactly the payload this accepts.
  primary?: CodexUsageWindow | null;
  secondary?: CodexUsageWindow | null;
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

/**
 * A window Codex does not report is null in the payload - and absent from it
 * when the key is missing, which the helper's jq validator also treats as
 * null. Rejecting the payload the helper considered valid would leave the chip
 * at `--` on every poll with the reason only in devtools.
 */
function isReportedWindow(value: unknown): boolean {
  return value === null || value === undefined || isUsageWindow(value);
}

function parseCodexUsage(value: string): CodexUsageData {
  const parsed = JSON.parse(value) as Partial<CodexUsageData>;
  const limits = parsed.rate_limits;

  if (
    typeof parsed.generated_at !== 'string' ||
    !limits ||
    typeof limits !== 'object' ||
    // Without this an array, whose keys are both absent, reads as two
    // unreported windows and reaches the UI as "unavailable" rather than as
    // the shape error it is.
    Array.isArray(limits) ||
    !isReportedWindow(limits.primary) ||
    !isReportedWindow(limits.secondary)
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
  return fetchUsageJson('Codex usage', CODEX_USAGE_COMMAND, parseCodexUsage);
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
