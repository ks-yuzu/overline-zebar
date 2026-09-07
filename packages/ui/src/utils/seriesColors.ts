/**
 * Grafana's classic visualization palette, in its own order. Why series
 * colours do not come from the theme: docs/ai-usage-integration.md.
 *
 * Source: grafana/grafana v12.0.2,
 * packages/grafana-data/src/themes/createVisualizationColors.ts
 */
export const SERIES_PALETTE = [
  '#7EB26D', // 0  green
  '#EAB839', // 1  semi-dark-yellow
  '#6ED0E0', // 2  light-blue
  '#EF843C', // 3  semi-dark-orange
  '#E24D42', // 4  red
  '#1F78C1', // 5  blue
  '#BA43A9', // 6  purple
  '#705DA0', // 7  violet
  '#508642', // 8  dark-green
  '#CCA300', // 9  yellow
  '#447EBC', // 10
  '#C15C17', // 11
  '#890F02', // 12
  '#0A437C', // 13
  '#6D1F62', // 14
  '#584477', // 15
  '#B7DBAB', // 16
  '#F4D598', // 17
  '#70DBED', // 18
  '#F9BA8F', // 19
  '#F29191', // 20
  '#82B5D8', // 21
  '#E5A8E2', // 22
  '#AEA2E0', // 23
  '#629E51', // 24
  '#E5AC0E', // 25
  '#64B0C8', // 26
  '#E0752D', // 27
  '#BF1B00', // 28
  '#0A50A1', // 29
  '#962D82', // 30
  '#614D93', // 31
  '#9AC48A', // 32
  '#F2C96D', // 33
  '#65C5DB', // 34
  '#F9934E', // 35
  '#EA6460', // 36
  '#5195CE', // 37
  '#D683CE', // 38
  '#806EB7', // 39
] as const;

/** The quantity a chart is about. */
export const SERIES_PRIMARY = SERIES_PALETTE[0];
/** The same quantity shown a second way - bars beside their own cumulative line. */
export const SERIES_PRIMARY_MUTED = SERIES_PALETTE[16];
/** A second quantity on the same axis. */
export const SERIES_SECONDARY = SERIES_PALETTE[1];
