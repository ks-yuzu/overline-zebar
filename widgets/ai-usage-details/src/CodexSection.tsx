import type { Threshold } from '@overline-zebar/config';
import {
  Card,
  UsageHistory,
  UsageTrend,
  buildDailyUsage,
  buildWindowPeaks,
  formatRemaining,
  formatUpdatedAt,
  hasJustReset,
  readUsageStatus,
  selectCurrentWindow,
  windowTrendRange,
} from '@overline-zebar/ui';
import type {
  TrendPoint,
  UsageHistorySample,
  UsageStatus,
} from '@overline-zebar/ui';
import SectionHeader from './SectionHeader';
import UsageCard from './UsageCard';
import {
  CHART_WIDTH_FULL,
  CHART_WIDTH_HALF,
  SECTION_GRID_ROWS,
} from './panelLayout';
import { usageProjection } from './usageProjection';
import { useCodexUsage } from './useCodexUsage';
import type {
  CodexUsageHistorySample,
  CodexUsageWindow,
} from './useCodexUsage';

/**
 * A window that resets several times a day is read one window at a time; one
 * that spans days would leave only a handful of bars over the retained
 * history, so the day becomes the unit instead.
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

function formatReset(window: CodexUsageWindow, now: number) {
  if (window.windowDurationMins < 24 * 60) {
    return `Resets in ${formatRemaining(window.resetsAt * 1000, now)}`;
  }

  return `Resets ${new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(window.resetsAt * 1000))}`;
}

/** Reads Codex's window shape into the shared range. */
function getTrendRange(
  window: CodexUsageWindow,
  now: number,
  justReset: boolean
) {
  return windowTrendRange({
    resetsAt: window.resetsAt,
    windowSeconds: window.windowDurationMins * 60,
    usedPercent: window.usedPercent,
    justReset,
    now: now / 1000,
  });
}

/** Reads Codex's window shape into the shared projection. */
function getProjection(
  window: CodexUsageWindow,
  samples: UsageHistorySample[],
  now: number
) {
  return usageProjection(
    {
      usedPercent: window.usedPercent,
      resetsAt: window.resetsAt * 1000,
      windowSeconds: window.windowDurationMins * 60,
    },
    samples,
    now
  );
}

/**
 * Matches on the window's length rather than its current reset time, so that
 * every window the retention holds is kept, not just the one in progress.
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
        ? [
            {
              recordedAt: sample.recorded_at,
              value: match.usedPercent,
              windowEndsAt: match.resetsAt,
            },
          ]
        : [];
    });
}

function HistoryCard({
  historyRange,
  now,
  samples,
  viewWidth,
  window,
}: {
  historyRange: { startAt: number; endAt: number };
  now: number;
  samples: UsageHistorySample[];
  viewWidth: number;
  window: CodexUsageWindow;
}) {
  const label = formatWindowDuration(window.windowDurationMins);
  const perDay = window.windowDurationMins >= DAILY_VIEW_MIN_MINUTES;

  if (perDay) {
    const daily = buildDailyUsage(samples, historyRange);
    return (
      <Card className="p-2.5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-text-muted">
            [14D] {label} usage trend and daily usage
          </p>
          <p className="text-[10px] text-text-muted">
            {samples.length} samples
          </p>
        </div>
        <UsageHistory
          barLabel="daily"
          barUnit="day"
          bars={daily.bars}
          endAt={historyRange.endAt}
          label={label}
          lineLabel="cumulative"
          primarySeries="line"
          segments={daily.segments}
          startAt={historyRange.startAt}
          viewWidth={viewWidth}
        />
      </Card>
    );
  }

  const peaks = buildWindowPeaks(samples, {
    ...historyRange,
    now: now / 1000,
    windowSeconds: window.windowDurationMins * 60,
  });
  return (
    <Card className="p-2.5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-muted">
          [14D] {label} usage peak per window
        </p>
        <p className="text-[10px] text-text-muted">{samples.length} samples</p>
      </div>
      <UsageHistory
        barLabel="window peak"
        barUnit="window"
        bars={peaks}
        endAt={historyRange.endAt}
        label={label}
        startAt={historyRange.startAt}
        viewWidth={viewWidth}
      />
    </Card>
  );
}

type Props = {
  className?: string;
  historyRange: { startAt: number; endAt: number };
  now: number;
  thresholds: Threshold[];
};

function Placeholder({
  className,
  message,
  status,
  subtitle,
  updatedAt,
}: {
  className?: string;
  message: string;
  status?: UsageStatus;
  subtitle: string;
  updatedAt?: string;
}) {
  return (
    <section
      className={`grid min-w-0 gap-2 ${className ?? ''}`}
      style={{ gridTemplateRows: SECTION_GRID_ROWS }}
    >
      <SectionHeader
        className="pr-7"
        service="codex"
        status={status}
        subtitle={subtitle}
        title="Codex usage"
        updatedAt={updatedAt}
      />
      {/* Spans what the three rows of cards would have filled, so the block
          beside it keeps its own rows where they were. */}
      <Card className="row-span-3 items-center justify-center text-sm text-text-muted">
        {message}
      </Card>
    </section>
  );
}

export default function CodexSection({
  className,
  historyRange,
  now,
  thresholds,
}: Props) {
  const { data, error, isPending } = useCodexUsage();

  if (!data) {
    return (
      <Placeholder
        className={className}
        message={
          isPending
            ? 'Loading Codex usage…'
            : error?.message || 'Usage unavailable'
        }
        subtitle="Current plan windows"
      />
    );
  }

  const status = readUsageStatus(data.generated_at, now);
  const subtitle = data.rate_limits.planType ?? 'Current plan windows';
  const updatedAt = formatUpdatedAt(data.generated_at);
  const windows = [data.rate_limits.primary, data.rate_limits.secondary]
    .filter((window): window is CodexUsageWindow => window != null)
    .sort((a, b) => a.windowDurationMins - b.windowDurationMins);

  if (windows.length === 0) {
    return (
      <Placeholder
        className={className}
        message="Codex usage windows are unavailable"
        status={status}
        subtitle={subtitle}
        updatedAt={updatedAt}
      />
    );
  }

  // One window fills the row, so the plots need a viewBox matching the wider
  // card or they letterbox away from their own axis labels.
  const plotWidth = windows.length === 1 ? CHART_WIDTH_FULL : CHART_WIDTH_HALF;
  const columns = windows.length === 1 ? 'grid-cols-1' : 'grid-cols-2';

  return (
    <section
      className={`grid min-w-0 gap-2 ${className ?? ''}`}
      style={{ gridTemplateRows: SECTION_GRID_ROWS }}
    >
      <SectionHeader
        className="pr-7"
        service="codex"
        status={status}
        subtitle={subtitle}
        title="Codex usage"
        updatedAt={updatedAt}
      />

      <div className={`grid min-h-0 gap-2 ${columns}`}>
        {windows.map((window) => (
          <UsageCard
            key={`${window.windowDurationMins}-${window.resetsAt}`}
            label={`${formatWindowDuration(window.windowDurationMins)} window`}
            projection={
              getProjection(
                window,
                selectWindowSamples(data.history, window.windowDurationMins),
                now
              )?.text
            }
            reset={formatReset(window, now)}
            thresholds={thresholds}
            usedPercent={window.usedPercent}
          />
        ))}
      </div>

      <div className={`grid min-h-0 gap-2 ${columns}`}>
        {windows.map((window) => {
          const label = formatWindowDuration(window.windowDurationMins);
          const samples = selectWindowSamples(
            data.history,
            window.windowDurationMins
          );
          const range = getTrendRange(
            window,
            now,
            hasJustReset(samples, now / 1000)
          );
          const history: TrendPoint[] = selectCurrentWindow(samples, {
            endAt: range.endAt,
            endsAt: window.resetsAt,
            startAt: range.startAt,
            started: range.started,
          });
          return (
            <Card
              className="p-2.5"
              key={`${window.windowDurationMins}-${window.resetsAt}`}
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-text-muted">
                  [{label}] usage trend
                </p>
                <p className="text-[10px] text-text-muted">
                  {history.length} samples
                </p>
              </div>
              <UsageTrend
                endAt={range.endAt}
                label={label}
                paceGuide={range.started}
                points={history}
                projection={getProjection(window, samples, now)?.point}
                startAt={range.startAt}
                viewWidth={plotWidth}
              />
            </Card>
          );
        })}
      </div>

      <div className={`grid min-h-0 gap-2 ${columns}`}>
        {windows.map((window) => (
          <HistoryCard
            historyRange={historyRange}
            key={`${window.windowDurationMins}-${window.resetsAt}`}
            now={now}
            samples={selectWindowSamples(
              data.history,
              window.windowDurationMins
            )}
            viewWidth={plotWidth}
            window={window}
          />
        ))}
      </div>
    </section>
  );
}
