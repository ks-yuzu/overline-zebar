import type { CostSession } from '@overline-zebar/ui';
import { useQuery } from '@tanstack/react-query';
import { CLAUDE_COST_COMMAND } from './config';
import { fetchUsageJson } from './usageCommand';

/** Spend inside one window, and what could not be attributed to a session. */
export type ClaudeCostWindow = {
  starts_at: string;
  resets_at?: string;
  source: string;
  total: number;
  sessions: CostSession[];
  /** Sessions the helper could not name. Their spend still counts. */
  unresolved: { cost: number; sessions: number; quota?: number };
  /**
   * The quota gauge this window's `quota` figures were apportioned from, and
   * the part of it that reached no session. Null when the helper could not
   * read the gauge - the spend columns are fetched separately and stand on
   * their own - and absent from caches written before it read one at all.
   */
  quota?: { used_percent: number; unattributed: number } | null;
};

export type ClaudeCostData = {
  generated_at: string;
  currency: string;
  windows: {
    session?: ClaudeCostWindow;
    week?: ClaudeCostWindow;
  };
};

/**
 * Only `session_id` and `cost` are required, matching the metric: every other
 * label is optional there, and a session started in `/` carries none of them.
 */
function isCostSession(value: unknown): value is CostSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<CostSession>;
  const optional = [
    session.session_name,
    session.custom_title,
    session.ai_title,
    session.task_id,
    session.project,
    session.cwd,
  ];
  return (
    typeof session.session_id === 'string' &&
    session.session_id.length > 0 &&
    typeof session.cost === 'number' &&
    Number.isFinite(session.cost) &&
    isOptionalNumber(session.quota) &&
    optional.every((label) => label === undefined || typeof label === 'string')
  );
}

/**
 * A field the helper may not report at all.
 *
 * The quota figures arrived after the cost ones, so a cache written by an
 * older helper - or by this one when Grafana would not answer the gauge -
 * carries the cost fields and nothing else. Rejecting those windows would
 * blank the spend columns to withhold a column that was never there.
 */
function isOptionalNumber(value: unknown): boolean {
  return (
    value === undefined || (typeof value === 'number' && Number.isFinite(value))
  );
}

/**
 * A window is taken whole or not at all. Its total is what the rows are read
 * against - a share of it is how a row is drawn - so a total that is not a
 * number would put every bar in that window at an arbitrary length rather
 * than leave one row out.
 */
function isCostWindow(value: unknown): value is ClaudeCostWindow {
  if (!value || typeof value !== 'object') return false;
  const window = value as Partial<ClaudeCostWindow>;
  return (
    typeof window.starts_at === 'string' &&
    (window.resets_at === undefined ||
      window.resets_at === null ||
      typeof window.resets_at === 'string') &&
    typeof window.source === 'string' &&
    typeof window.total === 'number' &&
    Number.isFinite(window.total) &&
    Array.isArray(window.sessions) &&
    window.sessions.every(isCostSession) &&
    !!window.unresolved &&
    typeof window.unresolved === 'object' &&
    typeof window.unresolved.cost === 'number' &&
    Number.isFinite(window.unresolved.cost) &&
    typeof window.unresolved.sessions === 'number' &&
    Number.isFinite(window.unresolved.sessions) &&
    isOptionalNumber(window.unresolved.quota) &&
    isQuotaReading(window.quota)
  );
}

/**
 * The gauge the rows were apportioned from.
 *
 * Both numbers or neither: `used_percent` is what the rows are read against
 * and `unattributed` is the part of it no row holds, so a reading missing one
 * of them would show rows that add up to nothing stated.
 */
function isQuotaReading(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object') return false;
  const quota = value as Partial<{
    used_percent: number;
    unattributed: number;
  }>;
  return (
    typeof quota.used_percent === 'number' &&
    Number.isFinite(quota.used_percent) &&
    typeof quota.unattributed === 'number' &&
    Number.isFinite(quota.unattributed)
  );
}

function parseClaudeCost(value: string): ClaudeCostData {
  const parsed = JSON.parse(value) as Partial<ClaudeCostData>;

  if (typeof parsed.generated_at !== 'string' || !parsed.windows) {
    throw new Error('Claude cost command returned an unexpected JSON shape.');
  }

  return {
    generated_at: parsed.generated_at,
    currency: typeof parsed.currency === 'string' ? parsed.currency : 'USD',
    windows: {
      session: isCostWindow(parsed.windows.session)
        ? parsed.windows.session
        : undefined,
      week: isCostWindow(parsed.windows.week) ? parsed.windows.week : undefined,
    },
  };
}

async function fetchClaudeCost(): Promise<ClaudeCostData> {
  return fetchUsageJson('Claude cost', CLAUDE_COST_COMMAND, parseClaudeCost);
}

export function useClaudeCost() {
  return useQuery({
    queryKey: ['claude-cost-details'],
    queryFn: fetchClaudeCost,
    refetchInterval: 60_000,
    staleTime: 55_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
