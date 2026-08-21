import { useWidgetSetting } from '@overline-zebar/config';
import { Chip } from '@overline-zebar/ui';
import { Bot } from 'lucide-react';
import FreshnessIndicator from '../aiUsage/FreshnessIndicator';
import { getUsageFreshness } from '../aiUsage/freshness';
import { formatRemaining, useMinuteNow } from '../aiUsage/useMinuteNow';
import Stat from '../stat/Stat';
import { useClaudeUsage } from './useClaudeUsage';
import type { ClaudeUsagePeriod } from './useClaudeUsage';

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
  const now = useMinuteNow();
  const [systemStatThresholds] = useWidgetSetting(
    'main',
    'systemStatThresholds'
  );
  const [useInlineStats] = useWidgetSetting('main', 'useInlineStats');

  if (!data) {
    return (
      <Chip
        className="flex items-center h-full px-3 text-text-muted"
        title={error instanceof Error ? error.message : 'Loading Claude usage'}
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

  return (
    <Chip
      className="flex items-center gap-2.5 h-full px-3"
      title={`Claude usage${isLastKnown ? ` (last known ${data.last_known_age ?? ''})` : ''}\nSession resets in: ${sessionReset}\nWeek resets: ${weekReset}\nUpdated: ${data.generated_at}\n${freshness.description}`}
    >
      <Bot aria-label="Claude usage" className="h-3.5 w-3.5 text-icon" />
      <Stat
        Icon={<p className="font-medium text-icon">5H</p>}
        stat={`${Math.round(data.current_session.used_percent)}%`}
        type={useInlineStats ? 'inline' : 'ring'}
        threshold={systemStatThresholds}
      />
      <p className="text-text-muted tabular-nums">{sessionReset}</p>
      <Stat
        Icon={<p className="font-medium text-icon">7D</p>}
        stat={`${Math.round(data.current_week.used_percent)}%`}
        type={useInlineStats ? 'inline' : 'ring'}
        threshold={systemStatThresholds}
      />
      <p className="text-text-muted tabular-nums">{weekReset}</p>
      <FreshnessIndicator freshness={freshness} />
    </Chip>
  );
}
