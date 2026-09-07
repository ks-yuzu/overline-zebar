/**
 * The zone name a reading carries, when `Intl` will take it, and nothing when
 * it will not - a name it refuses throws inside render.
 * See docs/ai-usage-integration.md.
 */
export function usableTimeZone(timezone: string | undefined) {
  if (timezone === undefined) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return timezone;
  } catch {
    return undefined;
  }
}
