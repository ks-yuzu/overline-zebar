import { useId } from 'react';
import type { UsageBar } from '../../utils/usageSeries';

export type UsageHistorySegment = {
  recordedAt: number;
  value: number;
}[];

type Props = {
  barLabel: string;
  bars: UsageBar[];
  endAt: number;
  label: string;
  lineLabel?: string;
  segments?: UsageHistorySegment[];
  startAt: number;
};

const WIDTH = 420;
const HEIGHT = 132;
const PADDING_X = 10;
const PADDING_TOP = 8;
const PADDING_BOTTOM = 16;
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
  bars,
  endAt,
  label,
  lineLabel,
  segments = [],
  startAt,
}: Props) {
  const clipId = `usage-history-${useId().replaceAll(':', '')}`;
  const chartHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
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
      <svg
        aria-label={`${label} daily consumption and cumulative usage`}
        className="h-[132px] w-full"
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
          const x = toX(bar.startAt);
          const span = toX(bar.endAt) - x;
          const width = Math.max(1, span - Math.min(BAR_GAP, span * 0.25));
          if (!bar.hasSamples) {
            return (
              <rect
                fill="var(--border)"
                height={chartHeight}
                key={bar.startAt}
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
              fill={bar.partial ? 'none' : 'var(--primary)'}
              height={Math.max(0, baselineY - y)}
              key={bar.startAt}
              opacity={bar.partial ? 0.9 : 0.55}
              rx="1"
              stroke={bar.partial ? 'var(--primary-border)' : 'none'}
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
              stroke="var(--primary-border)"
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
            x={(toX(peakBar.startAt) + toX(peakBar.endAt)) / 2}
            y={Math.max(PADDING_TOP + 7, toY(peakBar.value) - 3)}
          >
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

      <div className="flex justify-between text-[10px] tabular-nums text-text-muted">
        <span>{formatDay(startAt)}</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-2.5 rounded-[1px] bg-primary/55" />
            {barLabel}
          </span>
          {lineLabel && (
            <span className="flex items-center gap-1">
              <span className="h-px w-2.5 bg-primary-border" />
              {lineLabel}
            </span>
          )}
        </span>
        <span>{formatDay(endAt)}</span>
      </div>
    </div>
  );
}
