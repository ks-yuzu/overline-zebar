import { ClockAlert } from 'lucide-react';
import type { UsageFreshness } from './freshness';

type Props = {
  freshness: UsageFreshness;
};

export default function FreshnessIndicator({ freshness }: Props) {
  if (freshness.level === 'fresh') return null;

  const colorClass =
    freshness.level === 'danger'
      ? 'text-danger'
      : freshness.level === 'warning'
        ? 'text-warning'
        : 'text-text-muted';

  return (
    <span
      aria-label={freshness.description}
      className={`flex items-center gap-1 tabular-nums ${colorClass}`}
    >
      <ClockAlert className="h-3.5 w-3.5" />
      {freshness.indicatorLabel}
    </span>
  );
}
