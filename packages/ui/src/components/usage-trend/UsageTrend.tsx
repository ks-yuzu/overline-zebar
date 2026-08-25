import { useId } from 'react';

export type TrendPoint = {
  recordedAt: number;
  value: number;
};

type Props = {
  endAt: number;
  label: string;
  points: TrendPoint[];
  startAt: number;
};

const WIDTH = 180;
const HEIGHT = 72;
const PADDING_X = 8;
const PADDING_Y = 7;
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

export default function UsageTrend({ endAt, label, points, startAt }: Props) {
  const gradientId = `usage-${useId().replaceAll(':', '')}`;
  const sampled = downsample(points);
  const timeRange = Math.max(1, endAt - startAt);
  const chartHeight = HEIGHT - PADDING_Y * 2;
  const chartWidth = WIDTH - PADDING_X * 2;
  const coordinates = sampled.map((point) => {
    const x =
      PADDING_X + ((point.recordedAt - startAt) / timeRange) * chartWidth;
    const value = Math.min(100, Math.max(0, point.value));
    const y = PADDING_Y + ((100 - value) / 100) * chartHeight;
    return { x, y };
  });
  const linePath = coordinates
    .map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`)
    .join(' ');
  const areaPath = `${linePath} L ${coordinates.at(-1)?.x ?? PADDING_X} ${HEIGHT - PADDING_Y} L ${coordinates.at(0)?.x ?? PADDING_X} ${HEIGHT - PADDING_Y} Z`;
  const lastCoordinate = coordinates.at(-1);

  return (
    <div>
      <div className="relative">
        <svg
          aria-label={`${label} usage history`}
          className="h-[82px] w-full"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.45" />
              <stop
                offset="100%"
                stopColor="var(--primary)"
                stopOpacity="0.04"
              />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((ratio) => {
            const y = PADDING_Y + ratio * chartHeight;
            return (
              <line
                key={ratio}
                stroke="var(--border)"
                strokeDasharray="2 3"
                strokeWidth="0.7"
                x1={PADDING_X}
                x2={WIDTH - PADDING_X}
                y1={y}
                y2={y}
              />
            );
          })}
          {coordinates.length >= 2 && (
            <>
              <path d={areaPath} fill={`url(#${gradientId})`} />
              <path
                d={linePath}
                fill="none"
                stroke="var(--primary-border)"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </>
          )}
          {lastCoordinate && (
            <circle
              cx={lastCoordinate.x}
              cy={lastCoordinate.y}
              fill="var(--primary-text)"
              r="2.2"
              stroke="var(--primary-border)"
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
        <span>
          {sampled.length} {sampled.length === 1 ? 'sample' : 'samples'}
        </span>
        <span>{formatSampleTime(endAt)}</span>
      </div>
    </div>
  );
}
