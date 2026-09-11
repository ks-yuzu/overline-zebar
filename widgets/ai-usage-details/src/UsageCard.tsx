import type { Threshold } from '@overline-zebar/config';
import {
  Card,
  Progress,
  clampPercentage,
  getThresholdColor,
} from '@overline-zebar/ui';
import { Clock3 } from 'lucide-react';

/** A second quota drawn inside the card, scoped to part of the first. */
type Scoped = {
  label: string;
  usedPercent: number;
};

type Props = {
  label: string;
  /** What the pace so far says about the rest of the window. */
  projection?: string;
  reset: string;
  scoped?: Scoped;
  thresholds: Threshold[];
  usedPercent: number;
};

export default function UsageCard({
  label,
  projection,
  reset,
  scoped,
  thresholds,
  usedPercent,
}: Props) {
  const usage = Math.round(clampPercentage(usedPercent));
  const thresholdColor = getThresholdColor(usage, thresholds);
  const textColor = `var(${thresholdColor})`;
  const indicatorColor =
    thresholdColor === '--text' ? 'var(--success)' : textColor;
  const scopedUsage = scoped
    ? Math.round(clampPercentage(scoped.usedPercent))
    : 0;
  const scopedColor = getThresholdColor(scopedUsage, thresholds);

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
      {scoped && (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <p
              className="min-w-0 truncate text-[10px] font-medium text-text-muted"
              title={scoped.label}
            >
              {scoped.label}
            </p>
            <p
              className="text-base font-semibold tabular-nums"
              style={{ color: `var(${scopedColor})` }}
            >
              {scopedUsage}%
            </p>
          </div>
          <Progress
            aria-label={`${scoped.label} usage`}
            indicatorColor={
              scopedColor === '--text'
                ? 'var(--success)'
                : `var(${scopedColor})`
            }
            value={scopedUsage}
          />
        </div>
      )}
      {/* Pushed to the bottom edge so that the line sits at the same height in
          every card, including the ones with no scoped quota above it. */}
      <div className="mt-auto flex flex-col gap-0.5 text-text-muted">
        <div className="flex items-center gap-1.5 text-xs">
          <Clock3 className="h-3 w-3" />
          <span>{reset}</span>
        </div>
        {/* Indented to the reset it qualifies, and set no larger than it: the
            theme's xs is 10px, so an arbitrary 11px reads as the louder of the
            two lines. Only ever one line, too - the card below has no room. */}
        {projection && (
          <span className="truncate pl-[18px] text-xs" title={projection}>
            {projection}
          </span>
        )}
      </div>
    </Card>
  );
}
