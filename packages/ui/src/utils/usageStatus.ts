/** Past this, a reading is shown as old rather than current. */
const STALE_AFTER_MINUTES = 8;

export type UsageStatus = {
  isStale: boolean;
  label: string;
};

/**
 * How current a reading is.
 *
 * `lastKnown` is Claude's own report that it served a cached value; Codex has
 * no equivalent and passes nothing. A reading whose age cannot be read is
 * called stale: the age is what the panel has to show the fetch stopped, and
 * without it there is nothing left to say the value is current.
 */
export function readUsageStatus(
  generatedAt: string,
  now: number,
  lastKnown?: { age?: string }
): UsageStatus {
  if (lastKnown) {
    return {
      isStale: true,
      label: `Last known${lastKnown.age ? ` · ${lastKnown.age} old` : ''}`,
    };
  }

  const parsed = Date.parse(generatedAt);
  if (Number.isNaN(parsed)) return { isStale: true, label: 'Unknown' };

  /* Not clamped at zero: a reading from ahead of the clock gives a
     negative age, which fails the threshold below and is called current
     either way. The clamp only ever changed a number nothing read. */
  const ageMinutes = Math.floor((now - parsed) / 60_000);
  return ageMinutes >= STALE_AFTER_MINUTES
    ? { isStale: true, label: `${ageMinutes}m old` }
    : { isStale: false, label: 'Fresh' };
}

export function formatUpdatedAt(generatedAt: string) {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return generatedAt;
  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/** Minutes to `2h 5m`, as both services' short windows are read. */
export function formatRemaining(resetsAt: number, now: number) {
  const remainingMinutes = Math.max(0, Math.ceil((resetsAt - now) / 60_000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
