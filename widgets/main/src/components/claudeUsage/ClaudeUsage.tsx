import { useWidgetSetting } from '@overline-zebar/config';
import { Chip } from '@overline-zebar/ui';
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
  const [systemStatThresholds] = useWidgetSetting(
    'main',
    'systemStatThresholds'
  );

  if (!data) {
    return (
      <Chip
        className="flex items-center h-full px-3 mr-2 text-text-muted"
        title={error instanceof Error ? error.message : 'Loading Claude usage'}
      >
        Claude {isPending ? '…' : '--'}
      </Chip>
    );
  }

  const sessionReset = formatReset(data.current_session);
  const weekReset = formatReset(data.current_week, true);
  const isLastKnown = data.refresh_status === 'last_known';

  return (
    <Chip
      className="flex items-center gap-2.5 h-full px-3 mr-2"
      title={`Claude usage${isLastKnown ? ` (last known ${data.last_known_age ?? ''})` : ''}\nSession resets: ${sessionReset}\nWeek resets: ${weekReset}\nUpdated: ${data.generated_at}`}
    >
      <Stat
        Icon={<p className="font-medium text-icon">5H</p>}
        stat={`${Math.round(data.current_session.used_percent)}%`}
        type="inline"
        threshold={systemStatThresholds}
      />
      <p className="text-text-muted tabular-nums">↻{sessionReset}</p>
      <Stat
        Icon={<p className="font-medium text-icon">7D</p>}
        stat={`${Math.round(data.current_week.used_percent)}%`}
        type="inline"
        threshold={systemStatThresholds}
      />
      <p className="text-text-muted tabular-nums">↻{weekReset}</p>
    </Chip>
  );
}
