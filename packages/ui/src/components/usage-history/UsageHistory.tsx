import { useId } from 'react';
import {
  CHART_DEFAULT_WIDTH as DEFAULT_WIDTH,
  CHART_HEIGHT as HEIGHT,
  CHART_PADDING_TOP as PADDING_TOP,
  CHART_PADDING_X as PADDING_X,
  CHART_PLOT_HEIGHT,
} from '../../utils/chartGeometry';
import type { UsageBar } from '../../utils/usageSeries';

export type UsageHistorySegment = {
  recordedAt: number;
  value: number;
}[];

type Props = {
  barLabel: string;
  /** What one bar covers: the aria label says so, since the bars aggregate. */
  barUnit: 'window' | 'day';
  bars: UsageBar[];
  endAt: number;
  label: string;
  /**
   * How the line aggregates, as a qualifier of "usage" - "cumulative", say.
   * Not the word usage itself: the aria label reads it as one.
   */
  lineLabel?: string;
  /**
   * Which mark carries the reading. Only that one takes the accent colour, so
   * a chart with two series does not present them as equally important.
   */
  primarySeries?: 'bars' | 'line';
  /**
   * viewBox width. The svg keeps its aspect ratio, so a card much wider than
   * this letterboxes the plot away from the axis labels beneath it.
   */
  viewWidth?: number;
  segments?: UsageHistorySegment[];
  startAt: number;
};

const BAR_GAP = 2;
const MAX_POINTS_PER_SEGMENT = 160;

function downsample(segment: UsageHistorySegment) {
  if (segment.length <= MAX_POINTS_PER_SEGMENT) return segment;

  const step = Math.ceil(segment.length / MAX_POINTS_PER_SEGMENT);
  const sampled = segment.filter((_, index) => index % step === 0);
  const last = segment.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}

function formatDay(epochSeconds: number) {
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epochSeconds * 1000));
}

export default function UsageHistory({
  barLabel,
  barUnit,
  bars,
  endAt,
  label,
  lineLabel,
  primarySeries = 'bars',
  segments = [],
  startAt,
  viewWidth = DEFAULT_WIDTH,
}: Props) {
  const WIDTH = viewWidth;
  const barColor =
    primarySeries === 'bars' ? 'var(--success)' : 'var(--primary)';
  const lineColor =
    primarySeries === 'line' ? 'var(--success)' : 'var(--primary-border)';
  const clipId = `usage-history-${useId().replaceAll(':', '')}`;
  const chartHeight = CHART_PLOT_HEIGHT;
  const chartWidth = WIDTH - PADDING_X * 2;
  const timeRange = Math.max(1, endAt - startAt);
  const baselineY = PADDING_TOP + chartHeight;

  const toX = (epochSeconds: number) =>
    PADDING_X + ((epochSeconds - startAt) / timeRange) * chartWidth;
  const toY = (value: number) =>
    PADDING_TOP +
    ((100 - Math.min(100, Math.max(0, value))) / 100) * chartHeight;

  const linePaths = segments
    .map((segment) =>
      downsample(segment)
        .map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'} ${toX(point.recordedAt)} ${toY(point.value)}`
        )
        .join(' ')
    )
    .filter((path) => path.includes('L'));

  const sampledBars = bars.filter((bar) => bar.hasSamples && !bar.partial);
  const peak = Math.max(0, ...sampledBars.map((bar) => bar.value));
  // Label only the tallest bar: at 14 bars there is no room for every value,
  // and the peak is what the panel is read for.
  const peakBar = sampledBars.find((bar) => bar.value === peak && peak > 0);

  return (
    <div>
      <div className="relative">
        <svg
          aria-label={`${label} usage over the last ${Math.round(
            (endAt - startAt) / 86_400
          )} days, one bar per ${barUnit}${
            lineLabel ? `, with the ${lineLabel} usage as a line` : ''
          }`}
          className="w-full"
          style={{ height: HEIGHT }}
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect
                height={chartHeight}
                width={chartWidth}
                x={PADDING_X}
                y={PADDING_TOP}
              />
            </clipPath>
          </defs>

          {[0, 0.5].map((ratio) => (
            <g key={ratio}>
              <line
                stroke="var(--border)"
                strokeDasharray="2 3"
                strokeWidth="0.7"
                x1={PADDING_X}
                x2={WIDTH - PADDING_X}
                y1={PADDING_TOP + ratio * chartHeight}
                y2={PADDING_TOP + ratio * chartHeight}
              />
              {/* The axis stays pinned to the full quota so the headroom above
                the bars keeps meaning as usage grows. */}
              <text
                fill="var(--text-muted)"
                fontSize="8"
                opacity="0.7"
                x={PADDING_X + 2}
                y={PADDING_TOP + ratio * chartHeight - 2}
              >
                {100 - ratio * 100}%
              </text>
            </g>
          ))}

          {bars.map((bar) => {
            // A bar may reach past either end of the axis - a window that began
            // before it, or a day that runs on past it - so it is clipped here
            // rather than in the data, where two clipped bars would collide.
            const left = Math.max(PADDING_X, toX(bar.startAt));
            const right = Math.min(WIDTH - PADDING_X, toX(bar.endAt));
            if (right <= left) return null;

            const x = left;
            const span = right - left;
            const width = Math.max(1, span - Math.min(BAR_GAP, span * 0.25));
            if (!bar.hasSamples) {
              return (
                <rect
                  fill="var(--border)"
                  height={chartHeight}
                  key={`${bar.startAt}-${bar.endAt}`}
                  opacity="0.1"
                  width={width}
                  x={x}
                  y={PADDING_TOP}
                />
              );
            }
            const y = toY(bar.value);
            return (
              <rect
                fill={bar.partial ? 'none' : barColor}
                height={Math.max(0, baselineY - y)}
                key={`${bar.startAt}-${bar.endAt}`}
                opacity={bar.partial ? 0.9 : 0.55}
                rx="1"
                stroke={bar.partial ? barColor : 'none'}
                strokeDasharray={bar.partial ? '2 2' : undefined}
                strokeWidth={bar.partial ? 1 : 0}
                width={width}
                x={x}
                y={y}
              />
            );
          })}

          <g clipPath={`url(#${clipId})`}>
            {linePaths.map((path) => (
              <path
                d={path}
                fill="none"
                key={path}
                stroke={lineColor}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.4"
              />
            ))}
          </g>

          {peakBar && (
            <text
              fill="var(--text-muted)"
              fontSize="9"
              paintOrder="stroke"
              stroke="var(--background)"
              strokeWidth="2.5"
              textAnchor="middle"
              x={
                (Math.max(PADDING_X, toX(peakBar.startAt)) +
                  Math.min(WIDTH - PADDING_X, toX(peakBar.endAt))) /
                2
              }
              y={Math.max(PADDING_TOP + 7, toY(peakBar.value) - 3)}
            >
              {/* Not clamped to the axis. These bars carry two different
                quantities: a window peak, which is a share of a quota and so
                never above 100, and a day's consumption, which sums the rises
                of however many windows the day held and passes 100 whenever a
                reset falls inside the day. The bar stops at the ceiling
                because the axis does; the label is what says how far past it
                went - and it is what made a poisoned series legible as 449%
                rather than as one more full day. */}
              {Math.round(peakBar.value)}%
            </text>
          )}

          <line
            stroke="var(--border)"
            strokeWidth="0.7"
            x1={PADDING_X}
            x2={WIDTH - PADDING_X}
            y1={baselineY}
            y2={baselineY}
          />
        </svg>
        {bars.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-muted">
            No samples yet
          </div>
        )}
      </div>

      <div className="flex justify-between text-[10px] tabular-nums text-text-muted">
        <span>{formatDay(startAt)}</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span
              className="h-1.5 w-2.5 rounded-[1px]"
              style={{ backgroundColor: barColor, opacity: 0.55 }}
            />
            {barLabel}
          </span>
          {lineLabel && (
            <span className="flex items-center gap-1">
              <span
                className="h-px w-2.5"
                style={{ backgroundColor: lineColor }}
              />
              {lineLabel}
            </span>
          )}
        </span>
        <span>{formatDay(endAt)}</span>
      </div>
    </div>
  );
}
