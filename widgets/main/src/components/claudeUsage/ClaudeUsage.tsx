import { useWidgetSetting } from '@overline-zebar/config';
import {
  Chip,
  clampPercentage,
  formatRemaining,
  ServiceIcon,
  usableTimeZone,
} from '@overline-zebar/ui';
import { worstProjection } from '../../utils/projectWindowUsage';
import { openUsagePanel } from '../aiUsage/panel';
import ProjectionFill from '../aiUsage/ProjectionFill';
import FreshnessIndicator from '../aiUsage/FreshnessIndicator';
import { getUsageFreshness } from '../aiUsage/freshness';
import { useMinuteNow } from '../aiUsage/useMinuteNow';
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
    timeZone: usableTimeZone(period.timezone),
  }).format(date);
}

export default function ClaudeUsage() {
  const { data, error, isPending } = useClaudeUsage();
  const now = useMinuteNow();
  const [marginX] = useWidgetSetting('main', 'marginX');
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
  const weekModel = data.current_week_model;
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
      aria-label={
        /* The rings inside are not announced - an explicit label on a button
           replaces them - so the scoped quota has to be named here. Its own
           projection is deliberately absent from `projected`, which folds two
           views of one quantity. */
        [
          'Open Claude usage details.',
          projected === null
            ? null
            : `Projected ${Math.round(projected)}% by reset.`,
          weekModel
            ? `${weekModel.label} weekly at ${Math.round(clampPercentage(weekModel.used_percent))}%.`
            : null,
        ]
          .filter(Boolean)
          .join(' ')
      }
      as="button"
      className="relative isolate flex items-center gap-2.5 h-full overflow-hidden px-3"
      onClick={() => void openUsagePanel(marginX)}
    >
      <ProjectionFill projected={projected} thresholds={systemStatThresholds} />
      <ServiceIcon label="Claude usage" service="claude" />
      <Stat
        Icon={<p className="font-medium text-icon">5H</p>}
        stat={`${sessionUsage}%`}
        type={useInlineStats ? 'inline' : 'ring'}
        threshold={systemStatThresholds}
      />
      <p className="text-text-muted tabular-nums">{sessionReset}</p>
      <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
      <Stat
        Icon={<p className="font-medium text-icon">7D</p>}
        stat={`${weekUsage}%`}
        type={useInlineStats ? 'inline' : 'ring'}
        threshold={systemStatThresholds}
      />
      {weekModel && (
        <Stat
          Icon={
            /* Bounded: the bar's centre is an absolute layer under this group.
               `title` keeps the whole name reachable. */
            <p
              className="max-w-[10ch] truncate font-medium text-icon"
              title={weekModel.label}
            >
              {weekModel.label}
            </p>
          }
          stat={`${Math.round(clampPercentage(weekModel.used_percent))}%`}
          type={useInlineStats ? 'inline' : 'ring'}
          threshold={systemStatThresholds}
        />
      )}
      <p className="text-text-muted tabular-nums">{weekReset}</p>
      <FreshnessIndicator freshness={freshness} />
    </Chip>
  );
}
