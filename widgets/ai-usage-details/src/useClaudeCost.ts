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
  unresolved: { cost: number; sessions: number };
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
    optional.every((label) => label === undefined || typeof label === 'string')
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
    Number.isFinite(window.unresolved.sessions)
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
