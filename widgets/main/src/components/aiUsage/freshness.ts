export type UsageFreshness = {
  level: 'fresh' | 'warning' | 'danger' | 'unknown';
  ageLabel: string;
  indicatorLabel: string;
  description: string;
};

const WARNING_AGE_MS = 8 * 60_000;
const DANGER_AGE_MS = 20 * 60_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

function formatAge(ageMs: number) {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0
    ? `${hours}h`
    : `${hours}h ${remainingMinutes}m`;
}

export function getUsageFreshness(
  generatedAt: string,
  now: number,
  sourceReportedStale = false,
  sourceAge?: string
): UsageFreshness {
  const generatedTimestamp = Date.parse(generatedAt);

  if (
    Number.isNaN(generatedTimestamp) ||
    generatedTimestamp > now + FUTURE_TOLERANCE_MS
  ) {
    return {
      level: 'unknown',
      ageLabel: 'unknown',
      indicatorLabel: 'unknown',
      description: 'Usage update time is unavailable.',
    };
  }

  const ageMs = Math.max(0, now - generatedTimestamp);
  const ageLabel = formatAge(ageMs);

  if (ageMs >= DANGER_AGE_MS) {
    return {
      level: 'danger',
      ageLabel,
      indicatorLabel: `${ageLabel} old`,
      description: `Usage cache has not updated for ${ageLabel}.`,
    };
  }

  if (sourceReportedStale || ageMs >= WARNING_AGE_MS) {
    const reportedAge = sourceAge || ageLabel;
    return {
      level: 'warning',
      ageLabel,
      indicatorLabel: `${reportedAge} old`,
      description: sourceReportedStale
        ? `Usage source reported last-known data from ${reportedAge} ago.`
        : `Usage cache has not updated for ${ageLabel}.`,
    };
  }

  return {
    level: 'fresh',
    ageLabel,
    indicatorLabel: '',
    description: `Usage data updated ${ageLabel} ago.`,
  };
}
