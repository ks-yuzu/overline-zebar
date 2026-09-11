import { ServiceIcon } from '@overline-zebar/ui';
import type { UsageStatus } from '@overline-zebar/ui';

type Props = {
  className?: string;
  service: 'claude' | 'codex';
  /** Absent while the reading is still being fetched, or after it failed. */
  status?: UsageStatus;
  subtitle: string;
  title: string;
  updatedAt?: string;
};

export default function SectionHeader({
  className,
  service,
  status,
  subtitle,
  title,
  updatedAt,
}: Props) {
  return (
    <header
      className={`flex min-w-0 items-center justify-between ${className ?? ''}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ServiceIcon className="text-xl" service={service} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-tight">{title}</h2>
          <p className="truncate text-[10px] leading-tight text-text-muted">
            {subtitle}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {updatedAt && (
          <span className="text-[10px] tabular-nums text-text-muted">
            Updated {updatedAt}
          </span>
        )}
        {status && (
          <span
            className={`flex items-center gap-1.5 text-xs ${status.isStale ? 'text-warning' : 'text-success'}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {status.label}
          </span>
        )}
      </div>
    </header>
  );
}
