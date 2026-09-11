import * as zebar from 'zebar';
import { calculateUsagePanelPlacement } from '../../utils/calculateWidgetPlacement';

/**
 * Keep in sync with the ai-usage-details preset in zpack.json: the size passed
 * here overrides it.
 */
const PANEL_SIZE = { width: 1700, height: 650 };

/**
 * Opens the panel that holds both services. Either chip opens it, and this is
 * the one place that says which widget and how large, so that the two cannot
 * drift into opening different panels.
 */
export async function openUsagePanel(marginX: number) {
  const placement = await calculateUsagePanelPlacement(PANEL_SIZE, marginX);
  await zebar.startWidget('ai-usage-details', placement, {});
}
