import type { LabelColor, Threshold } from '@overline-zebar/config';

export function getThresholdColor(
  value: number,
  thresholds: Threshold[]
): LabelColor {
  // The type says this is an array, but the value reaches here from config: a
  // config that fails validation is merged into the defaults and used as-is,
  // and deepMerge replaces an array wholesale when the stored value is not one.
  // A string here would throw on .find and take down every caller's render.
  if (!Array.isArray(thresholds)) return '--text';

  const range = thresholds.find(
    (threshold) => value >= threshold.min && value <= threshold.max
  );
  if (range) return range.labelColor;

  const first = thresholds.reduce<Threshold | undefined>(
    (lowest, candidate) =>
      !lowest || candidate.min < lowest.min ? candidate : lowest,
    undefined
  );
  const last = thresholds.reduce<Threshold | undefined>(
    (highest, candidate) =>
      !highest || candidate.max > highest.max ? candidate : highest,
    undefined
  );

  if (first && value < first.min) return first.labelColor;
  if (last && value > last.max) return last.labelColor;
  return '--text';
}
