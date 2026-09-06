import { useId } from 'react';
import {
  CHART_DEFAULT_WIDTH as DEFAULT_WIDTH,
  CHART_HEIGHT as HEIGHT,
  CHART_PADDING_TOP as PADDING_TOP,
  CHART_PADDING_X as PADDING_X,
  CHART_PLOT_HEIGHT,
} from '../../utils/chartGeometry';

export type TrendPoint = {
  recordedAt: number;
  value: number;
};

type Props = {
  endAt: number;
  label: string;
  /**
   * Draws the line a window would follow consuming its quota evenly. Only
   * meaningful for a window that starts empty and resets, not a rolling one.
   */
  paceGuide?: boolean;
  points: TrendPoint[];
  startAt: number;
  /**
   * viewBox width. The svg keeps its aspect ratio, so a card much wider than
   * this letterboxes the plot away from the axis labels beneath it.
   */
  viewWidth?: number;
};

const MAX_POINTS = 120;

function downsample(points: TrendPoint[]) {
  if (points.length <= MAX_POINTS) return points;

  const step = Math.ceil(points.length / MAX_POINTS);
  const sampled = points.filter((_, index) => index % step === 0);
  const last = points.at(-1);
  if (last && sampled.at(-1) !== last) sampled.push(last);
  return sampled;
}

function formatSampleTime(epochSeconds: number) {
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochSeconds * 1000));
}

export default function UsageTrend({
  endAt,
  label,
  paceGuide = true,
  points,
  startAt,
  viewWidth = DEFAULT_WIDTH,
}: Props) {
  const WIDTH = viewWidth;
  const gradientId = `usage-${useId().replaceAll(':', '')}`;
  const sampled = downsample(points);
  const timeRange = Math.max(1, endAt - startAt);
  const chartHeight = CHART_PLOT_HEIGHT;
  const chartWidth = WIDTH - PADDING_X * 2;
  const baselineY = PADDING_TOP + chartHeight;
  const coordinates = sampled.map((point) => {
    const x =
      PADDING_X + ((point.recordedAt - startAt) / timeRange) * chartWidth;
    const value = Math.min(100, Math.max(0, point.value));
    const y = PADDING_TOP + ((100 - value) / 100) * chartHeight;
    return { x, y };
  });
  const linePath = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
  const areaPath = `${linePath} L ${coordinates.at(-1)?.x ?? PADDING_X} ${baselineY} L ${coordinates.at(0)?.x ?? PADDING_X} ${baselineY} Z`;
  const lastCoordinate = coordinates.at(-1);

  return (
    <div>
      <div className="relative">
        <svg
          aria-label={`${label} usage as read, across the window on show`}
          className="w-full"
          style={{ height: HEIGHT }}
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--success)" stopOpacity="0.45" />
              <stop
                offset="100%"
                stopColor="var(--success)"
                stopOpacity="0.04"
              />
            </linearGradient>
          </defs>
          {/* Same furniture as the fortnight chart below: the pair is read as
              one scale, and an axis drawn two ways breaks that before the
              numbers are even compared. */}
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
          {paceGuide && (
            <line
              aria-hidden="true"
              opacity="0.5"
              stroke="var(--border)"
              strokeDasharray="4 3"
              strokeWidth="0.75"
              x1={PADDING_X}
              x2={WIDTH - PADDING_X}
              y1={baselineY}
              y2={PADDING_TOP}
            />
          )}
          {coordinates.length >= 2 && (
            <>
              <path d={areaPath} fill={`url(#${gradientId})`} />
              <path
                d={linePath}
                fill="none"
                stroke="var(--success)"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </>
          )}
          <line
            stroke="var(--border)"
            strokeWidth="0.7"
            x1={PADDING_X}
            x2={WIDTH - PADDING_X}
            y1={baselineY}
            y2={baselineY}
          />
          {lastCoordinate && (
            <circle
              cx={lastCoordinate.x}
              cy={lastCoordinate.y}
              fill="var(--primary-text)"
              r="2.2"
              stroke="var(--success)"
              strokeWidth="1.5"
            />
          )}
        </svg>
        {sampled.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-muted">
            No samples yet
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-text-muted">
        <span>{formatSampleTime(startAt)}</span>
        {/* One series, but the slot holds the legend in both charts: the same
            place saying the same kind of thing is what lets the column be read
            as one. The line here is the quantity the fortnight chart draws as
            its own line. */}
        <span className="flex items-center gap-1">
          <span
            className="h-px w-2.5"
            style={{ backgroundColor: 'var(--success)' }}
          />
          usage
        </span>
        <span>{formatSampleTime(endAt)}</span>
      </div>
    </div>
  );
}
