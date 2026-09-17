import { currentMonitor } from '@tauri-apps/api/window';
import { startWidget, WidgetPlacement } from 'zebar';

/**
 * Keep in sync with the ai-usage-details preset in zpack.json: the placement
 * built here overrides it.
 */
const PANEL_SIZE = { width: 1700, height: 854 };

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
 *
 * The panel opens on the monitor this bar is on, because that cap is the bar's
 * own width: opened on a wider monitor it would leave a gap, and on a narrower
 * one it would hang off the edge. The monitor is named rather than indexed -
 * zebar sorts its monitor list left-to-right, which is not the order Tauri
 * enumerates them in, so an index read here would select a different screen.
 * Tauri types the name as nullable; with none to match, this falls back to the
 * primary monitor, which is where the panel opened before.
 */
export async function openUsagePanel(marginX: number) {
  /* Both are read off the document, which is in the same CSS pixels that
     zebar scales a placement's `px` by. `outerSize` is physical, so on a
     scaled display it would be multiplied by the scale factor twice. The bar
     is the full width of its monitor and its root is `h-screen`, so these are
     the monitor's width and the bar's own height. */
  const barWidth = document.documentElement.scrollWidth;
  const barHeight = document.documentElement.clientHeight;
  const monitor = await currentMonitor();

  const placement = {
    anchor: 'top_right',
    offsetX: `-${marginX}px`,
    offsetY: `${barHeight + 6}px`,
    width: `${Math.min(PANEL_SIZE.width, barWidth - marginX * 2)}px`,
    height: `${PANEL_SIZE.height}px`,
    monitorSelection: monitor?.name
      ? { type: 'name', match: monitor.name }
      : { type: 'primary' },
    /* `windowMargin` is what zebar reserves *after* the window, and it reads
       it only while `enabled` is true. Nothing is docked here, so there is
       nothing to reserve. */
    dockToEdge: {
      enabled: false,
      edge: 'top',
      windowMargin: '0px',
    },
  } satisfies WidgetPlacement;

  await startWidget('ai-usage-details', placement, {});
}
