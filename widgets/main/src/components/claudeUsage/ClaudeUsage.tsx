import { useWidgetSetting } from '@overline-zebar/config';
import { Chip, clampPercentage } from '@overline-zebar/ui';
import { Bot } from 'lucide-react';
import { useRef } from 'react';
import * as zebar from 'zebar';
import { calculateWidgetPlacementFromRight } from '../../utils/calculateWidgetPlacement';
import { worstProjection } from '../../utils/projectWindowUsage';
import ProjectionFill from '../aiUsage/ProjectionFill';
import FreshnessIndicator from '../aiUsage/FreshnessIndicator';
import { getUsageFreshness } from '../aiUsage/freshness';
import { formatRemaining, useMinuteNow } from '../aiUsage/useMinuteNow';
import Stat from '../stat/Stat';
import { useClaudeUsage } from './useClaudeUsage';
import type { ClaudeUsagePeriod } from './useClaudeUsage';

const SESSION_WINDOW_SECONDS = 5 * 60 * 60;
const WEEK_WINDOW_SECONDS = 7 * 24 * 60 * 60;

function formatReset(period: ClaudeUsagePeriod, includeDate = false) {
  if (!period.resets_at) return period.resets_at_display;

  const date = new Date(period.resets_at);
  if (Number.isNaN(date.getTime())) return period.resets_at_display;

  return new Intl.DateTimeFormat('ja-JP', {
    month: includeDate ? '2-digit' : undefined,
    day: includeDate ? '2-digit' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: period.timezone,
  }).format(date);
}

export default function ClaudeUsage() {
  const { data, error, isPending } = useClaudeUsage();
  const chipRef = useRef<HTMLElement | null>(null);
  const now = useMinuteNow();
  const [systemStatThresholds] = useWidgetSetting(
    'main',
    'systemStatThresholds'
  );
  const [useInlineStats] = useWidgetSetting('main', 'useInlineStats');

  if (!data) {
    return (
      <Chip
        aria-label={
          error instanceof Error ? error.message : 'Loading Claude usage'
        }
        className="flex items-center h-full px-3 text-text-muted"
      >
        Claude {isPending ? '…' : '--'}
      </Chip>
    );
  }

  const sessionResetsAt = data.current_session.resets_at
    ? new Date(data.current_session.resets_at).getTime()
    : NaN;
  const sessionReset = Number.isNaN(sessionResetsAt)
    ? formatReset(data.current_session)
    : formatRemaining(sessionResetsAt, now);
  const weekReset = formatReset(data.current_week, true);
  const isLastKnown = data.refresh_status === 'last_known';
  const freshness = getUsageFreshness(
    data.generated_at,
    now,
    isLastKnown,
    data.last_known_age
  );
  const sessionUsage = Math.round(
    clampPercentage(data.current_session.used_percent)
  );
  const weekUsage = Math.round(clampPercentage(data.current_week.used_percent));
  const weekResetsAt = data.current_week.resets_at
    ? new Date(data.current_week.resets_at).getTime()
    : NaN;
  const projected = worstProjection(
    [
      {
        usedPercent: data.current_session.used_percent,
        resetsAt: sessionResetsAt,
        windowSeconds: SESSION_WINDOW_SECONDS,
      },
      {
        usedPercent: data.current_week.used_percent,
        resetsAt: weekResetsAt,
        windowSeconds: WEEK_WINDOW_SECONDS,
      },
    ],
    now
  );

  return (
    <Chip
      ref={chipRef}
      aria-label={
        projected === null
          ? 'Open Claude usage details'
          : `Open Claude usage details. Projected ${Math.round(projected)}% by reset`
      }
      as="button"
      className="relative isolate flex items-center gap-2.5 h-full overflow-hidden px-3"
      onClick={async () => {
        const placement = await calculateWidgetPlacementFromRight(chipRef, {
          width: 920,
          // Keep in sync with the ai-usage-details preset in zpack.json: the
          // size passed here overrides it.
          height: 580,
        });
        await zebar.startWidget('ai-usage-details', placement, {});
      }}
    >
      <ProjectionFill projected={projected} thresholds={systemStatThresholds} />
      <Bot aria-label="Claude usage" className="h-3.5 w-3.5 text-icon" />
      <Stat
        Icon={<p className="font-medium text-icon">5H</p>}
        stat={`${sessionUsage}%`}
        type={useInlineStats ? 'inline' : 'ring'}
        threshold={systemStatThresholds}
      />
      <p className="text-text-muted tabular-nums">{sessionReset}</p>
      <Stat
        Icon={<p className="font-medium text-icon">7D</p>}
        stat={`${weekUsage}%`}
        type={useInlineStats ? 'inline' : 'ring'}
        threshold={systemStatThresholds}
      />
      <p className="text-text-muted tabular-nums">{weekReset}</p>
      <FreshnessIndicator freshness={freshness} />
    </Chip>
  );
}
