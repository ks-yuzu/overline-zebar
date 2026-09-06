/**
 * The vertical geometry both usage charts are drawn to.
 *
 * The detail views stack the two in one column - a window's trend above the
 * fortnight it belongs to - so the column reads as one scale. That only holds
 * if the same 100% is the same height in both: the panels have to be equally
 * tall, and the space above and below the plot has to match, or the two bands
 * differ by the padding even at equal height.
 *
 * They were separate constants and had drifted: 72 against 132, so the same
 * quota was drawn 1.8 times taller in one chart than the other.
 *
 * The horizontal inset is shared for the same reason: stacked in a column, two
 * plots that start at different x read as two unrelated panels.
 */
export const CHART_HEIGHT = 132;
export const CHART_PADDING_TOP = 8;
/** Holds no marks. It keeps the baseline off the labels below the svg. */
export const CHART_PADDING_BOTTOM = 16;
export const CHART_PLOT_HEIGHT =
  CHART_HEIGHT - CHART_PADDING_TOP - CHART_PADDING_BOTTOM;

export const CHART_PADDING_X = 10;

/**
 * Default viewBox width. Shared for the same reason as the heights: the two
 * charts were 180 and 420, so omitting the prop on one of them put the pair on
 * different geometry without anything to see at the call site.
 */
export const CHART_DEFAULT_WIDTH = 420;
