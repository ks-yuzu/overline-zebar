import { useWidgetSetting } from '@overline-zebar/config';
import type { Threshold } from '@overline-zebar/config';
import {
  Card,
  Progress,
  UsageHistory,
  UsageTrend,
  buildDailyUsage,
  buildWindowPeaks,
  clampPercentage,
  getThresholdColor,
} from '@overline-zebar/ui';
import type { TrendPoint, UsageHistorySample } from '@overline-zebar/ui';
import { Bot, Clock3, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as zebar from 'zebar';
import { useClaudeUsage } from './useClaudeUsage';
import type {
  ClaudeUsageHistorySample,
  ClaudeUsagePeriod,
} from './useClaudeUsage';

const SESSION_WINDOW_SECONDS = 5 * 60 * 60;
const WEEK_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const HISTORY_WINDOW_SECONDS = 14 * 24 * 60 * 60;

function formatRemaining(resetsAt: string | undefined, now: number) {
  if (!resetsAt) return 'Unknown';
  const resetTime = Date.parse(resetsAt);
  if (Number.isNaN(resetTime)) return 'Unknown';

  const remainingMinutes = Math.max(0, Math.ceil((resetTime - now) / 60_000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatResetDate(period: ClaudeUsagePeriod) {
  if (!period.resets_at) return period.resets_at_display;
  const resetTime = new Date(period.resets_at);
  if (Number.isNaN(resetTime.getTime())) return period.resets_at_display;

  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: period.timezone,
  }).format(resetTime);
}

function formatUpdatedAt(generatedAt: string) {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return generatedAt;
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function selectHistory(
  history: ClaudeUsageHistorySample[],
  resetAt: string | undefined,
  resetKey: 'session_resets_at' | 'week_resets_at',
  valueKey: 'session_used_percent' | 'week_used_percent',
  startAt: number,
  endAt: number
): TrendPoint[] {
  return history
    .filter(
      (sample) =>
        sample.recorded_at >= startAt &&
        sample.recorded_at <= endAt &&
        (!resetAt || sample[resetKey] === resetAt)
    )
    .sort((a, b) => a.recorded_at - b.recorded_at)
    .map((sample) => ({
      recordedAt: sample.recorded_at,
      value: sample[valueKey],
    }));
}

function getTrendRange(
  resetAt: string | undefined,
  windowSeconds: number,
  now: number
) {
  const parsedResetAt = resetAt ? Date.parse(resetAt) / 1000 : Number.NaN;
  const endAt = Number.isFinite(parsedResetAt) ? parsedResetAt : now / 1000;
  return { startAt: endAt - windowSeconds, endAt };
}

function selectSessionSamples(
  history: ClaudeUsageHistorySample[]
): UsageHistorySample[] {
  return history
    .slice()
    .sort((a, b) => a.recorded_at - b.recorded_at)
    .map((sample) => ({
      recordedAt: sample.recorded_at,
      value: sample.session_used_percent,
      windowKey: sample.session_resets_at,
    }));
}

function selectWeekSamples(
  history: ClaudeUsageHistorySample[]
): UsageHistorySample[] {
  return history
    .slice()
    .sort((a, b) => a.recorded_at - b.recorded_at)
    .map((sample) => ({
      recordedAt: sample.recorded_at,
      value: sample.week_used_percent,
      windowKey: sample.week_resets_at,
    }));
}

function UsageCard({
  label,
  period,
  reset,
  thresholds,
}: {
  label: string;
  period: ClaudeUsagePeriod;
  reset: string;
  thresholds: Threshold[];
}) {
  const usage = Math.round(clampPercentage(period.used_percent));
  const thresholdColor = getThresholdColor(usage, thresholds);
  const textColor = `var(${thresholdColor})`;
  const indicatorColor =
    thresholdColor === '--text' ? 'var(--success)' : textColor;
  return (
    <Card className="gap-2 bg-background-deeper/60 p-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-text-muted">{label}</p>
          <p
            className="text-2xl font-semibold tabular-nums"
            style={{ color: textColor }}
          >
            {usage}%
          </p>
        </div>
        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-text-muted">
          used
        </span>
      </div>
      <Progress
        aria-label={`${label} usage`}
        indicatorColor={indicatorColor}
        value={usage}
      />
      <div className="flex items-center gap-1.5 text-xs text-text-muted">
        <Clock3 className="h-3 w-3" />
        <span>{reset}</span>
      </div>
    </Card>
  );
}

export default function App() {
  const { data, error, isPending } = useClaudeUsage();
  const [now, setNow] = useState(() => Date.now());
  const [systemStatThresholds] = useWidgetSetting(
    'main',
    'systemStatThresholds'
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    let unlisten: (() => void) | undefined;
    void zebar
      .currentWidget()
      .tauriWindow.listen('tauri://blur', () => {
        void zebar.currentWidget().close();
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });

    return () => {
      window.clearInterval(interval);
      unlisten?.();
    };
  }, []);

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center rounded-lg border border-button-border/80 bg-background p-4 font-mono text-sm text-text shadow-sm backdrop-blur-xl">
        {isPending
          ? 'Loading Claude usage…'
          : error?.message || 'Usage unavailable'}
      </div>
    );
  }

  const generatedAt = Date.parse(data.generated_at);
  const ageMinutes = Number.isNaN(generatedAt)
    ? null
    : Math.max(0, Math.floor((now - generatedAt) / 60_000));
  const isStale =
    data.refresh_status === 'last_known' || (ageMinutes ?? 9) >= 8;
  const statusLabel =
    data.refresh_status === 'last_known'
      ? `Last known${data.last_known_age ? ` · ${data.last_known_age} old` : ''}`
      : ageMinutes === null
        ? 'Unknown'
        : ageMinutes >= 8
          ? `${ageMinutes}m old`
          : 'Fresh';
  const sessionRange = getTrendRange(
    data.current_session.resets_at,
    SESSION_WINDOW_SECONDS,
    now
  );
  const weekRange = getTrendRange(
    data.current_week.resets_at,
    WEEK_WINDOW_SECONDS,
    now
  );
  const sessionHistory = selectHistory(
    data.history,
    data.current_session.resets_at,
    'session_resets_at',
    'session_used_percent',
    sessionRange.startAt,
    sessionRange.endAt
  );
  const weekHistory = selectHistory(
    data.history,
    data.current_week.resets_at,
    'week_resets_at',
    'week_used_percent',
    weekRange.startAt,
    weekRange.endAt
  );
  const historyRange = {
    startAt: now / 1000 - HISTORY_WINDOW_SECONDS,
    endAt: now / 1000,
  };
  const dailyUsage = buildDailyUsage(
    selectWeekSamples(data.history),
    historyRange
  );
  const sessionPeaks = buildWindowPeaks(selectSessionSamples(data.history), {
    ...historyRange,
    now: now / 1000,
    windowSeconds: SESSION_WINDOW_SECONDS,
  });

  return (
    <div className="flex h-screen flex-col gap-3 overflow-y-auto rounded-lg border border-button-border/80 bg-background p-3 font-mono text-text shadow-sm backdrop-blur-xl">
      <header className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-icon" />
          <div>
            <h1 className="text-sm font-semibold">Claude usage</h1>
            <p className="text-[10px] text-text-muted">Current plan windows</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 text-xs ${isStale ? 'text-warning' : 'text-success'}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {statusLabel}
          </span>
          <button
            aria-label="Close Claude usage details"
            className="rounded p-1 text-text-muted transition-colors hover:bg-background-deeper hover:text-text"
            onClick={() => void zebar.currentWidget().close()}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <section className="grid shrink-0 grid-cols-2 gap-2">
        <UsageCard
          label="5H session"
          period={data.current_session}
          reset={`Resets in ${formatRemaining(data.current_session.resets_at, now)}`}
          thresholds={systemStatThresholds}
        />
        <UsageCard
          label="7D week"
          period={data.current_week}
          reset={`Resets ${formatResetDate(data.current_week)}`}
          thresholds={systemStatThresholds}
        />
      </section>

      <section className="grid shrink-0 grid-cols-2 gap-2">
        <Card className="shrink-0 p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-muted">5H trend</p>
            <p className="text-[10px] text-text-muted">Current session</p>
          </div>
          <UsageTrend
            endAt={sessionRange.endAt}
            label="5H"
            points={sessionHistory}
            startAt={sessionRange.startAt}
            viewWidth={420}
          />
        </Card>
        <Card className="shrink-0 p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-muted">7D trend</p>
            <p className="text-[10px] text-text-muted">Current week</p>
          </div>
          <UsageTrend
            endAt={weekRange.endAt}
            label="7D"
            points={weekHistory}
            startAt={weekRange.startAt}
            viewWidth={420}
          />
        </Card>
      </section>

      <section className="grid shrink-0 grid-cols-2 gap-2">
        <Card className="shrink-0 p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-muted">14D 5H peaks</p>
            <p className="text-[10px] text-text-muted">Per session window</p>
          </div>
          <UsageHistory
            barLabel="session peak"
            bars={sessionPeaks}
            endAt={historyRange.endAt}
            label="14D 5H"
            startAt={historyRange.startAt}
          />
        </Card>
        <Card className="shrink-0 p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-muted">14D weekly</p>
            <p className="text-[10px] text-text-muted">Per day</p>
          </div>
          <UsageHistory
            barLabel="daily"
            bars={dailyUsage.bars}
            endAt={historyRange.endAt}
            label="14D weekly"
            lineLabel="cumulative"
            segments={dailyUsage.segments}
            startAt={historyRange.startAt}
          />
        </Card>
      </section>

      <footer className="flex shrink-0 items-center justify-between text-[10px] text-text-muted">
        <span>Updated {formatUpdatedAt(data.generated_at)}</span>
        <span>{data.history.length} retained samples · 14 days</span>
      </footer>
    </div>
  );
}
