import { currentWidget, startWidget, WidgetPlacement } from 'zebar';

/**
 * Keep in sync with the ai-usage-details preset in zpack.json: the placement
 * built here overrides it.
 */
const PANEL_SIZE = { width: 1700, height: 650 };

/**
 * Opens the panel that holds both services. Either chip opens it, and this is
 * the one place that says which widget, how large, and where, so that the two
 * cannot drift into opening different panels.
 *
 * The panel is wider than the gap between either chip and the edge of the
 * screen, so anchoring it to the chip that opened it would push it off the left
 * of the monitor - and a panel that moved depending on which chip was pressed
 * would read as two. It sits against the bar's own right edge instead, which is
 * inset by the bar's margin.
 *
 * The width is capped at what the bar spans. The panel is wider than a 1366 or
 * 1440 monitor, and this placement overrides the preset, so without the cap the
 * left-hand service would open past the edge of the screen with no way to reach
 * it. The charts read their own viewBox and shrink to fit.
 */
export async function openUsagePanel(marginX: number) {
  const windowSize = await currentWidget().tauriWindow.outerSize();
  /* The bar is the full width of its monitor, and this is in the same CSS
     pixels as the size and the margin - unlike `outerSize`, which is physical
     and differs from them wherever the display is scaled. */
  const barWidth = document.documentElement.scrollWidth;

  const placement = {
    anchor: 'top_right',
    offsetX: `-${marginX}px`,
    offsetY: `${windowSize.height + 6}px`,
    width: `${Math.min(PANEL_SIZE.width, barWidth - marginX * 2)}px`,
    height: `${PANEL_SIZE.height}px`,
    monitorSelection: { type: 'primary' },
    dockToEdge: {
      enabled: false,
      edge: 'top',
      windowMargin: `${windowSize.height}px`,
    },
  } satisfies WidgetPlacement;

  await startWidget('ai-usage-details', placement, {});
}
