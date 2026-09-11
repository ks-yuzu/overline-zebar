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
  selectScopedSamples,
  usableTimeZone,
  windowTrendRange,
} from '@overline-zebar/ui';
import type { TrendPoint, UsageHistorySample } from '@overline-zebar/ui';
import SectionHeader from './SectionHeader';
import UsageCard from './UsageCard';
import { usageProjection } from './usageProjection';
import { CHART_WIDTH_HALF, SECTION_GRID_ROWS } from './panelLayout';
import { hasModelWindow, useClaudeUsage } from './useClaudeUsage';
import type {
  ClaudeUsageHistorySample,
  ClaudeUsagePeriod,
} from './useClaudeUsage';

const SESSION_WINDOW_SECONDS = 5 * 60 * 60;
const WEEK_WINDOW_SECONDS = 7 * 24 * 60 * 60;

function formatSessionReset(resetsAt: string | undefined, now: number) {
  if (!resetsAt) return 'Unknown';
  const resetTime = Date.parse(resetsAt);
  if (Number.isNaN(resetTime)) return 'Unknown';
  return formatRemaining(resetTime, now);
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
    timeZone: usableTimeZone(period.timezone),
  }).format(resetTime);
}

/** Reads Claude's period shape into the shared range. */
function getTrendRange(
  period: ClaudeUsagePeriod,
  windowSeconds: number,
  now: number,
  justReset: boolean
) {
  return windowTrendRange({
    resetsAt: period.resets_at
      ? Date.parse(period.resets_at) / 1000
      : Number.NaN,
    windowSeconds,
    usedPercent: period.used_percent,
    justReset,
    now: now / 1000,
  });
}

function windowEndFor(resetsAt: string | undefined) {
  if (!resetsAt) return undefined;
  const parsed = Date.parse(resetsAt);
  return Number.isNaN(parsed) ? undefined : parsed / 1000;
}

/**
 * A sample whose reset time is missing cannot be placed in a window, and
 * consumption is derived per window: without it the reading joins the current
 * window as a fall to 0 and everything before it is counted a second time as
 * the line climbs back. The helper refuses to record such a reading, but the
 * cache outlives any one version of it - this is what a cache written before
 * that rule looks like - so the chart drops them rather than trusting the file.
 */
function selectPeriodSamples<Sample extends ClaudeUsageHistorySample>(
  history: Sample[],
  valueOf: (sample: Sample) => number,
  resetOf: (sample: Sample) => string | undefined
): UsageHistorySample[] {
  return history
    .slice()
    .sort((a, b) => a.recorded_at - b.recorded_at)
    .flatMap((sample) => {
      const windowEndsAt = windowEndFor(resetOf(sample));
      return windowEndsAt === undefined
        ? []
        : [
            {
              recordedAt: sample.recorded_at,
              value: valueOf(sample),
              windowEndsAt,
            },
          ];
    });
}

function selectSessionSamples(
  history: ClaudeUsageHistorySample[]
): UsageHistorySample[] {
  return selectPeriodSamples(
    history,
    (sample) => sample.session_used_percent,
    (sample) => sample.session_resets_at
  );
}

function selectWeekSamples(
  history: ClaudeUsageHistorySample[]
): UsageHistorySample[] {
  return selectPeriodSamples(
    history,
    (sample) => sample.week_used_percent,
    (sample) => sample.week_resets_at
  );
}

/**
 * Only the samples whose label matches the window on show. A model renamed for
 * good takes its history with it; see docs/ai-usage-integration.md.
 */
function selectWeekModelSamples(
  history: ClaudeUsageHistorySample[],
  label: string | undefined
): UsageHistorySample[] {
  return selectPeriodSamples(
    selectScopedSamples(
      history.filter(hasModelWindow),
      (sample) => sample.week_model_label,
      label
    ),
    (sample) => sample.week_model_used_percent,
    (sample) => sample.week_model_resets_at
  );
}

type Props = {
  className?: string;
  historyRange: { startAt: number; endAt: number };
  now: number;
  thresholds: Threshold[];
};

export default function ClaudeSection({
  className,
  historyRange,
  now,
  thresholds,
}: Props) {
  const { data, error, isPending } = useClaudeUsage();

  if (!data) {
    return (
      <section
        className={`grid min-w-0 gap-2 ${className ?? ''}`}
        style={{ gridTemplateRows: SECTION_GRID_ROWS }}
      >
        <SectionHeader
          service="claude"
          subtitle="Current plan windows"
          title="Claude usage"
        />
        {/* Spans what the three rows of cards would have filled, so the block
            beside it keeps its own rows where they were. */}
        <Card className="row-span-3 items-center justify-center text-sm text-text-muted">
          {isPending
            ? 'Loading Claude usage…'
            : error?.message || 'Usage unavailable'}
        </Card>
      </section>
    );
  }

  const status = readUsageStatus(
    data.generated_at,
    now,
    data.refresh_status === 'last_known'
      ? { age: data.last_known_age }
      : undefined
  );
  const sessionSamples = selectSessionSamples(data.history);
  const weekSamples = selectWeekSamples(data.history);
  const weekModel = data.current_week_model;
  const weekModelSamples = selectWeekModelSamples(
    data.history,
    weekModel?.label
  );
  const sessionRange = getTrendRange(
    data.current_session,
    SESSION_WINDOW_SECONDS,
    now,
    hasJustReset(sessionSamples, now / 1000)
  );
  const weekRange = getTrendRange(
    data.current_week,
    WEEK_WINDOW_SECONDS,
    now,
    hasJustReset(weekSamples, now / 1000)
  );
  const sessionHistory: TrendPoint[] = selectCurrentWindow(sessionSamples, {
    endsAt: windowEndFor(data.current_session.resets_at),
    endAt: sessionRange.endAt,
    startAt: sessionRange.startAt,
    started: sessionRange.started,
  });
  const weekHistory: TrendPoint[] = selectCurrentWindow(weekSamples, {
    endsAt: windowEndFor(data.current_week.resets_at),
    endAt: weekRange.endAt,
    startAt: weekRange.startAt,
    started: weekRange.started,
  });
  /* Plotted on the all-models window's axis by time, with no window identity
     of its own. See docs/ai-usage-integration.md. */
  const weekModelHistory: TrendPoint[] = weekModelSamples
    .filter(
      (sample) =>
        sample.recordedAt >= weekRange.startAt &&
        sample.recordedAt <= weekRange.endAt
    )
    .map(({ recordedAt, value }) => ({ recordedAt, value }));
  const dailyUsage = buildDailyUsage(weekSamples, historyRange);
  const dailyModelUsage = weekModel
    ? buildDailyUsage(weekModelSamples, historyRange)
    : undefined;
  /* All models only. The scoped window is two views of one quantity, and the
     chip leaves it out of its projection for that reason. */
  const weekProjection = usageProjection(
    {
      usedPercent: data.current_week.used_percent,
      resetsAt: data.current_week.resets_at
        ? Date.parse(data.current_week.resets_at)
        : Number.NaN,
      windowSeconds: WEEK_WINDOW_SECONDS,
    },
    now,
    data.current_week.timezone
  );
  const sessionPeaks = buildWindowPeaks(sessionSamples, {
    ...historyRange,
    now: now / 1000,
    windowSeconds: SESSION_WINDOW_SECONDS,
  });

  return (
    <section
      className={`grid min-w-0 gap-2 ${className ?? ''}`}
      style={{ gridTemplateRows: SECTION_GRID_ROWS }}
    >
      <SectionHeader
        service="claude"
        status={status}
        subtitle="Current plan windows"
        title="Claude usage"
        updatedAt={formatUpdatedAt(data.generated_at)}
      />

      <div className="grid min-h-0 grid-cols-2 gap-2">
        <UsageCard
          label="5H session"
          reset={`Resets in ${formatSessionReset(data.current_session.resets_at, now)}`}
          thresholds={thresholds}
          usedPercent={data.current_session.used_percent}
        />
        <UsageCard
          label="7D week"
          projection={weekProjection?.text}
          reset={`Resets ${formatResetDate(data.current_week)}`}
          scoped={
            weekModel && {
              label: weekModel.label,
              usedPercent: weekModel.used_percent,
            }
          }
          thresholds={thresholds}
          usedPercent={data.current_week.used_percent}
        />
      </div>

      <div className="grid min-h-0 grid-cols-2 gap-2">
        <Card className="p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-muted">
              [5H] usage trend
            </p>
            <p className="text-[10px] text-text-muted">
              {sessionHistory.length} samples
            </p>
          </div>
          <UsageTrend
            endAt={sessionRange.endAt}
            label="5H"
            paceGuide={sessionRange.started}
            points={sessionHistory}
            startAt={sessionRange.startAt}
            viewWidth={CHART_WIDTH_HALF}
          />
        </Card>
        <Card className="p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-muted">
              [7D] usage trend
            </p>
            <p className="text-[10px] text-text-muted">
              {weekHistory.length} samples
            </p>
          </div>
          <UsageTrend
            endAt={weekRange.endAt}
            label="7D"
            paceGuide={weekRange.started}
            points={weekHistory}
            pointsLabel="all models"
            projection={weekProjection}
            secondaryLabel={weekModel?.label}
            secondaryPoints={weekModelHistory}
            startAt={weekRange.startAt}
            viewWidth={CHART_WIDTH_HALF}
          />
        </Card>
      </div>

      <div className="grid min-h-0 grid-cols-2 gap-2">
        <Card className="p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-muted">
              [14D] 5H usage peak per window
            </p>
            <p className="text-[10px] text-text-muted">
              {sessionSamples.length} samples
            </p>
          </div>
          <UsageHistory
            barLabel="window peak"
            barUnit="window"
            bars={sessionPeaks}
            endAt={historyRange.endAt}
            label="5H"
            startAt={historyRange.startAt}
            viewWidth={CHART_WIDTH_HALF}
          />
        </Card>
        <Card className="p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-text-muted">
              [14D] 7D usage trend and daily usage
            </p>
            <p className="text-[10px] text-text-muted">
              {weekSamples.length} samples
            </p>
          </div>
          <UsageHistory
            barLabel="daily"
            barUnit="day"
            bars={dailyUsage.bars}
            endAt={historyRange.endAt}
            label="7D"
            lineLabel="all models"
            primarySeries="line"
            secondaryLineLabel={weekModel?.label}
            secondarySegments={dailyModelUsage?.segments}
            segments={dailyUsage.segments}
            startAt={historyRange.startAt}
            viewWidth={CHART_WIDTH_HALF}
          />
        </Card>
      </div>
    </section>
  );
}
