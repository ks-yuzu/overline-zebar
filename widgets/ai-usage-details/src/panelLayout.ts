/**
 * The two service blocks are laid out as independent grids, so their rows line
 * up only if both are given the same track heights. This is that one template.
 *
 * The heights are a budget against the 650px panel: its content box is 624
 * (650 less the 1px border and the 12px padding on each edge), and these
 * tracks with three 8px gaps come to 620.
 *
 * The header is a fixed track rather than `auto` so that a block whose fetch
 * failed - and which therefore has no plan name under its title - still starts
 * its cards level with the block beside it.
 */
export const SECTION_GRID_ROWS = '34px 166px 198px 198px';

/**
 * viewBox width for the charts. The svg is a fixed 132px tall and keeps its
 * aspect ratio, so a viewBox narrower than the card leaves the plot centred in
 * the card with its axis labels running on past it. These are the card's inner
 * width at the 1700px panel: half a block, and a whole one for the single
 * window Codex sometimes reports.
 */
export const CHART_WIDTH_HALF = 390;
export const CHART_WIDTH_FULL = 810;
