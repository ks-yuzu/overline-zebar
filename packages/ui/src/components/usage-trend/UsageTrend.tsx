import { useId } from 'react';
import {
  CHART_DEFAULT_WIDTH as DEFAULT_WIDTH,
  CHART_HEIGHT as HEIGHT,
  CHART_PADDING_TOP as PADDING_TOP,
  CHART_PADDING_X as PADDING_X,
  CHART_PLOT_HEIGHT,
} from '../../utils/chartGeometry';
import { SERIES_PRIMARY, SERIES_SECONDARY } from '../../utils/seriesColors';

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
  /** Legend text for `points`. */
  pointsLabel?: string;
  /** A second quantity on the same axis, measured the same way. */
  secondaryPoints?: TrendPoint[];
  secondaryLabel?: string;
  startAt: number;
  /**
   * viewBox width. The svg keeps its aspect ratio, so a card much wider than
   * this letterboxes the plot away from the axis labels beneath it.
   */
  viewWidth?: number;
};

const MAX_POINTS = 120;

/** Half an end marker, so the clip does not cut one in two. */
const MARK_SLACK = 3;

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
  pointsLabel = 'usage',
  secondaryPoints,
  secondaryLabel,
  startAt,
  viewWidth = DEFAULT_WIDTH,
}: Props) {
  const WIDTH = viewWidth;
  const clipId = `usage-trend-${useId().replaceAll(':', '')}`;
  const sampled = downsample(points);
  const timeRange = Math.max(1, endAt - startAt);
  const chartHeight = CHART_PLOT_HEIGHT;
  const chartWidth = WIDTH - PADDING_X * 2;
  const baselineY = PADDING_TOP + chartHeight;
  const project = (point: TrendPoint) => {
    const x =
      PADDING_X + ((point.recordedAt - startAt) / timeRange) * chartWidth;
    const value = Math.min(100, Math.max(0, point.value));
    const y = PADDING_TOP + ((100 - value) / 100) * chartHeight;
    return { x, y };
  };
  const pathOf = (coords: { x: number; y: number }[]) =>
    coords
      .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
      .join(' ');
  const coordinates = sampled.map(project);
  const secondaryCoordinates = secondaryPoints
    ? downsample(secondaryPoints).map(project)
    : [];
  const linePath = pathOf(coordinates);
  const secondaryPath = pathOf(secondaryCoordinates);
  const lastCoordinate = coordinates.at(-1);
  const lastSecondaryCoordinate = secondaryCoordinates.at(-1);

  return (
    <div>
      <div className="relative">
        <svg
          aria-label={`${label} usage as read, across the window on show${
            secondaryLabel && secondaryCoordinates.length > 0
              ? `, ${pointsLabel} and ${secondaryLabel}`
              : ''
          }`}
          className="w-full"
          style={{ height: HEIGHT }}
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          {/* Clipped like the fortnight chart, with slack for the end
              markers, which are inside it. */}
          <defs>
            <clipPath id={clipId}>
              <rect
                height={chartHeight + MARK_SLACK * 2}
                width={chartWidth + MARK_SLACK * 2}
                x={PADDING_X - MARK_SLACK}
                y={PADDING_TOP - MARK_SLACK}
              />
            </clipPath>
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
          <g clipPath={`url(#${clipId})`}>
            {coordinates.length >= 2 && (
              <path
                d={linePath}
                fill="none"
                stroke={SERIES_PRIMARY}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            )}
            {secondaryCoordinates.length >= 2 && (
              <path
                d={secondaryPath}
                fill="none"
                stroke={SERIES_SECONDARY}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
            )}
            <line
              stroke="var(--border)"
              strokeWidth="0.7"
              x1={PADDING_X}
              x2={WIDTH - PADDING_X}
              y1={baselineY}
              y2={baselineY}
            />
            {/* Where each series has got to. Same mark for both; the scoped
                one is drawn on top where they coincide. */}
            {lastCoordinate && (
              <circle
                cx={lastCoordinate.x}
                cy={lastCoordinate.y}
                fill="var(--primary-text)"
                r="2.2"
                stroke={SERIES_PRIMARY}
                strokeWidth="1.5"
              />
            )}
            {lastSecondaryCoordinate && (
              <circle
                cx={lastSecondaryCoordinate.x}
                cy={lastSecondaryCoordinate.y}
                fill="var(--primary-text)"
                r="2.2"
                stroke={SERIES_SECONDARY}
                strokeWidth="1.5"
              />
            )}
          </g>
        </svg>
        {sampled.length === 0 && secondaryCoordinates.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-muted">
            No samples yet
          </div>
        )}
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-text-muted">
        <span>{formatSampleTime(startAt)}</span>
        {/* The slot holds the legend in both charts: the same place saying
            the same kind of thing is what lets the column be read as one. The
            line here is the quantity the fortnight chart draws as its own
            line. */}
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span
              className="h-px w-2.5"
              style={{ backgroundColor: SERIES_PRIMARY }}
            />
            {pointsLabel}
          </span>
          {secondaryLabel && secondaryCoordinates.length > 0 && (
            <span className="flex items-center gap-1">
              <span
                className="h-px w-2.5"
                style={{ backgroundColor: SERIES_SECONDARY }}
              />
              {secondaryLabel}
            </span>
          )}
        </span>
        <span>{formatSampleTime(endAt)}</span>
      </div>
    </div>
  );
}
