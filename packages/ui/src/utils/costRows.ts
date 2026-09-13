/** One session's spend inside a window, as the cost helper reports it. */
export type CostSession = {
  session_id: string;
  cost: number;
  session_name?: string;
  custom_title?: string;
  ai_title?: string;
  task_id?: string;
  project?: string;
  cwd?: string;
};

/** A title that is only a reference, such as `#102`, with no text of its own. */
const BARE_REFERENCE = /^#\d+$/;

/** How much of a session id stands in for a session that has no other name. */
const ID_PREFIX_LENGTH = 8;

/**
 * What to call a session in the breakdown.
 *
 * The helper passes both titles through rather than choosing, because the
 * choice is a display one: a custom title is what a person or their hook meant
 * to call the session and comes first, but when it is only a reference - six
 * of the local transcripts are named just `#102` - the generated title is the
 * only part that says what the session was about, so it is appended rather
 * than discarded.
 *
 * The last resort is not decoration. Every label but `session_id` is optional
 * in the metric, so a session started in `/` arrives with nothing else; it is
 * still a session that spent money and has to be nameable.
 */
export function sessionDisplayName(session: CostSession): string {
  const custom = session.custom_title?.trim();
  const generated = session.ai_title?.trim();

  if (custom) {
    return BARE_REFERENCE.test(custom) && generated
      ? `${custom} ${generated}`
      : custom;
  }

  return (
    generated ||
    session.project?.trim() ||
    session.session_id.slice(0, ID_PREFIX_LENGTH)
  );
}

/** `$1,234.57`, or `$0.01` for anything a cent or under that is not nothing. */
export function formatCost(cost: number): string {
  const shown = cost > 0 && cost < 0.01 ? 0.01 : cost;
  return `$${shown.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
