import { useWidgetSetting } from '@overline-zebar/config';
import type { Threshold } from '@overline-zebar/config';
import {
  Card,
  Progress,
  UsageHistory,
  UsageTrend,
  buildDailyPeaks,
  buildDailyUsage,
  clampPercentage,
  getThresholdColor,
} from '@overline-zebar/ui';
import type { TrendPoint, UsageHistorySample } from '@overline-zebar/ui';
import { Clock3, Code2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as zebar from 'zebar';
import { useCodexUsage } from './useCodexUsage';
import type {
  CodexUsageHistorySample,
  CodexUsageWindow,
} from './useCodexUsage';

const HISTORY_WINDOW_SECONDS = 14 * 24 * 60 * 60;
/**
 * A window shorter than a day is asked "how close to the cap did today get";
 * a longer one is asked "how much of it did today consume". Below a day a
 * rolling window is routinely consumed more than once over, which a 0-100%
 * quota axis cannot show.
 */
const DAILY_VIEW_MIN_MINUTES = 24 * 60;

function formatWindowDuration(minutes: number) {
  if (minutes % (7 * 24 * 60) === 0) {
    return `${(minutes / (7 * 24 * 60)) * 7}D`;
  }
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)}D`;
  if (minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes}M`;
}

function formatRemaining(resetsAt: number, now: number) {
  const remainingMinutes = Math.max(
    0,
    Math.ceil((resetsAt * 1000 - now) / 60_000)
  );
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatReset(window: CodexUsageWindow, now: number) {
  if (window.windowDurationMins < 24 * 60) {
    return `Resets in ${formatRemaining(window.resetsAt, now)}`;
  }

  return `Resets ${new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(window.resetsAt * 1000))}`;
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

/**
 * The window rolls, so it ends now rather than at `resetsAt` - that is only
 * when the oldest usage currently held will age out.
 */
function getTrendRange(window: CodexUsageWindow, now: number) {
  const endAt = now / 1000;
  return { startAt: endAt - window.windowDurationMins * 60, endAt };
}

function selectHistory(
  history: CodexUsageHistorySample[],
  window: CodexUsageWindow,
  startAt: number,
  endAt: number
): TrendPoint[] {
  return history
    .filter(
      (sample) => sample.recorded_at >= startAt && sample.recorded_at <= endAt
    )
    .flatMap((sample) => {
      // Matching the reset time too would keep only the newest sample: a
      // rolling window reports a different `resetsAt` almost every time.
      const matchingWindow = sample.windows.find(
        (candidate) =>
          candidate.windowDurationMins === window.windowDurationMins
      );
      return matchingWindow
        ? [
            {
              recordedAt: sample.recorded_at,
              value: matchingWindow.usedPercent,
            },
          ]
        : [];
    })
    .sort((a, b) => a.recordedAt - b.recordedAt);
}

/**
 * Codex windows roll rather than reset: `resetsAt` is when the oldest usage
 * ages out, so it slides with almost every sample and marks no boundary. The
 * series is left unsegmented for that reason, and matched on the window's
 * length rather than its reset time.
 */
function selectWindowSamples(
  history: CodexUsageHistorySample[],
  windowDurationMins: number
): UsageHistorySample[] {
  return history
    .slice()
    .sort((a, b) => a.recorded_at - b.recorded_at)
    .flatMap((sample) => {
      const match = sample.windows.find(
        (candidate) => candidate.windowDurationMins === windowDurationMins
      );
      return match
        ? [{ recordedAt: sample.recorded_at, value: match.usedPercent }]
        : [];
    });
}

function HistoryCard({
  historyRange,
  samples,
  window,
}: {
  historyRange: { startAt: number; endAt: number };
  samples: UsageHistorySample[];
  window: CodexUsageWindow;
}) {
  const label = formatWindowDuration(window.windowDurationMins);
  const perDay = window.windowDurationMins >= DAILY_VIEW_MIN_MINUTES;

  if (perDay) {
    const daily = buildDailyUsage(samples, historyRange);
    return (
      <Card className="shrink-0 p-2.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-text-muted">14D {label}</p>
          <p className="text-[10px] text-text-muted">Per day</p>
        </div>
        <UsageHistory
          barLabel="daily"
          bars={daily.bars}
          endAt={historyRange.endAt}
          label={`14D ${label}`}
          lineLabel="in window"
          primarySeries="line"
          segments={daily.segments}
          startAt={historyRange.startAt}
        />
      </Card>
    );
  }

  const peaks = buildDailyPeaks(samples, historyRange);
  return (
    <Card className="shrink-0 p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-muted">14D {label} peaks</p>
        <p className="text-[10px] text-text-muted">Highest each day</p>
      </div>
      <UsageHistory
        barLabel="daily peak"
        bars={peaks}
        endAt={historyRange.endAt}
        label={`14D ${label}`}
        startAt={historyRange.startAt}
      />
    </Card>
  );
}

function UsageCard({
  now,
  thresholds,
  window,
}: {
  now: number;
  thresholds: Threshold[];
  window: CodexUsageWindow;
}) {
  const label = formatWindowDuration(window.windowDurationMins);
  const usage = Math.round(clampPercentage(window.usedPercent));
  const thresholdColor = getThresholdColor(usage, thresholds);
  const textColor = `var(${thresholdColor})`;
  const indicatorColor =
    thresholdColor === '--text' ? 'var(--success)' : textColor;
  return (
    <Card className="gap-2 bg-background-deeper/60 p-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-text-muted">{label} window</p>
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
        <span>{formatReset(window, now)}</span>
      </div>
    </Card>
  );
}

export default function App() {
  const { data, error, isPending } = useCodexUsage();
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
          ? 'Loading Codex usage…'
          : error?.message || 'Usage unavailable'}
      </div>
    );
  }

  const windows = [data.rate_limits.primary, data.rate_limits.secondary]
    .filter((window): window is CodexUsageWindow => window != null)
    .sort((a, b) => a.windowDurationMins - b.windowDurationMins);

  if (windows.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center rounded-lg border border-button-border/80 bg-background p-4 font-mono text-sm text-text shadow-sm backdrop-blur-xl">
        Codex usage windows are unavailable
      </div>
    );
  }

  const historyRange = {
    startAt: now / 1000 - HISTORY_WINDOW_SECONDS,
    endAt: now / 1000,
  };
  const generatedAt = Date.parse(data.generated_at);
  const ageMinutes = Number.isNaN(generatedAt)
    ? null
    : Math.max(0, Math.floor((now - generatedAt) / 60_000));
  const isStale = (ageMinutes ?? 9) >= 8;
  const statusLabel =
    ageMinutes === null
      ? 'Unknown'
      : ageMinutes >= 8
        ? `${ageMinutes}m old`
        : 'Fresh';

  return (
    <div className="flex h-screen flex-col gap-3 overflow-y-auto rounded-lg border border-button-border/80 bg-background p-3 font-mono text-text shadow-sm backdrop-blur-xl">
      <header className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-icon" />
          <div>
            <h1 className="text-sm font-semibold">Codex usage</h1>
            <p className="text-[10px] text-text-muted">
              {data.rate_limits.planType ?? 'Current plan windows'}
            </p>
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
            aria-label="Close Codex usage details"
            className="rounded p-1 text-text-muted transition-colors hover:bg-background-deeper hover:text-text"
            onClick={() => void zebar.currentWidget().close()}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <section
        className={`grid shrink-0 gap-2 ${windows.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
      >
        {windows.map((window) => (
          <UsageCard
            key={`${window.windowDurationMins}-${window.resetsAt}`}
            now={now}
            thresholds={systemStatThresholds}
            window={window}
          />
        ))}
      </section>

      <section
        className={`grid shrink-0 gap-2 ${windows.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
      >
        {windows.map((window) => {
          const label = formatWindowDuration(window.windowDurationMins);
          const range = getTrendRange(window, now);
          const history = selectHistory(
            data.history,
            window,
            range.startAt,
            range.endAt
          );
          return (
            <Card
              className="shrink-0 p-2.5"
              key={`${window.windowDurationMins}-${window.resetsAt}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-text-muted">
                  {label} trend
                </p>
                <p className="text-[10px] text-text-muted">Rolling window</p>
              </div>
              <UsageTrend
                endAt={range.endAt}
                label={label}
                paceGuide={false}
                points={history}
                startAt={range.startAt}
                viewWidth={420}
              />
            </Card>
          );
        })}
      </section>

      <section
        className={`grid shrink-0 gap-2 ${windows.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}
      >
        {windows.map((window) => (
          <HistoryCard
            historyRange={historyRange}
            key={`${window.windowDurationMins}-${window.resetsAt}`}
            samples={selectWindowSamples(
              data.history,
              window.windowDurationMins
            )}
            window={window}
          />
        ))}
      </section>

      <footer className="flex shrink-0 items-center justify-between text-[10px] text-text-muted">
        <span>Updated {formatUpdatedAt(data.generated_at)}</span>
        <span>{data.history.length} retained samples · 14 days</span>
      </footer>
    </div>
  );
}
