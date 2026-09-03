import { useWidgetSetting } from '@overline-zebar/config';
import { Chip, clampPercentage } from '@overline-zebar/ui';
import { Code2 } from 'lucide-react';
import { useRef } from 'react';
import * as zebar from 'zebar';
import { calculateWidgetPlacementFromRight } from '../../utils/calculateWidgetPlacement';
import { worstProjection } from '../../utils/projectWindowUsage';
import ProjectionFill from '../aiUsage/ProjectionFill';
import FreshnessIndicator from '../aiUsage/FreshnessIndicator';
import { getUsageFreshness } from '../aiUsage/freshness';
import { formatRemaining, useMinuteNow } from '../aiUsage/useMinuteNow';
import Stat from '../stat/Stat';
import { useCodexUsage } from './useCodexUsage';
import type { CodexUsageWindow } from './useCodexUsage';

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
    return formatRemaining(window.resetsAt * 1000, now);
  }

  const date = new Date(window.resetsAt * 1000);
  if (Number.isNaN(date.getTime())) return '--';

  return new Intl.DateTimeFormat('ja-JP', {
    month: window.windowDurationMins >= 24 * 60 ? '2-digit' : undefined,
    day: window.windowDurationMins >= 24 * 60 ? '2-digit' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export default function CodexUsage() {
  const { data, error, isPending } = useCodexUsage();
  const chipRef = useRef<HTMLElement | null>(null);
  const now = useMinuteNow();
  const [systemStatThresholds] = useWidgetSetting(
    'main',
    'systemStatThresholds'
  );
  const [useInlineStats] = useWidgetSetting('main', 'useInlineStats');

  const windows = [data?.rate_limits.primary, data?.rate_limits.secondary]
    .filter((window): window is CodexUsageWindow => window != null)
    .sort((a, b) => a.windowDurationMins - b.windowDurationMins);

  if (!data || windows.length === 0) {
    return (
      <Chip
        aria-label={
          error instanceof Error ? error.message : 'Loading Codex usage'
        }
        className="flex items-center h-full px-3 text-text-muted"
      >
        Codex {isPending ? '…' : '--'}
      </Chip>
    );
  }

  const freshness = getUsageFreshness(data.generated_at, now);
  const projected = worstProjection(
    windows.map((window) => ({
      usedPercent: window.usedPercent,
      resetsAt: window.resetsAt * 1000,
      windowSeconds: window.windowDurationMins * 60,
    })),
    now
  );

  return (
    <Chip
      ref={chipRef}
      aria-label={
        projected === null
          ? 'Open Codex usage details'
          : `Open Codex usage details. Projected ${Math.round(projected)}% by reset`
      }
      as="button"
      className="relative isolate flex items-center gap-2.5 h-full overflow-hidden px-3"
      onClick={async () => {
        const placement = await calculateWidgetPlacementFromRight(chipRef, {
          width: 920,
          // Keep in sync with the codex-usage-details preset in zpack.json:
          // the size passed here overrides it.
          height: 580,
        });
        await zebar.startWidget('codex-usage-details', placement, {});
      }}
    >
      <ProjectionFill projected={projected} thresholds={systemStatThresholds} />
      <Code2 aria-label="Codex usage" className="h-3.5 w-3.5 text-icon" />
      {windows.map((window) => (
        <div
          className="flex items-center gap-2.5"
          key={`${window.windowDurationMins}-${window.resetsAt}`}
        >
          <Stat
            Icon={
              <p className="font-medium text-icon">
                {formatWindowDuration(window.windowDurationMins)}
              </p>
            }
            stat={`${Math.round(clampPercentage(window.usedPercent))}%`}
            type={useInlineStats ? 'inline' : 'ring'}
            threshold={systemStatThresholds}
          />
          <p className="text-text-muted tabular-nums">
            {formatReset(window, now)}
          </p>
        </div>
      ))}
      <FreshnessIndicator freshness={freshness} />
    </Chip>
  );
}
