import type { LabelColor, Threshold } from '@overline-zebar/config';

export function getThresholdColor(
  value: number,
  thresholds: Threshold[]
): LabelColor {
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
