import type { Threshold } from '@overline-zebar/config';
import { getThresholdColor } from '@overline-zebar/ui';

type Props = {
  /** Usage the window is projected to reach by its reset, or null if unknown. */
  projected: number | null;
  thresholds: Threshold[];
};

/**
 * Fills the chip behind its numbers with the projected usage at reset. The
 * current value is already printed on the chip, so the background carries what
 * the numbers cannot: whether this pace runs the quota out before it resets.
 */
export default function ProjectionFill({ projected, thresholds }: Props) {
  if (projected === null) return null;

  const level = Math.round(projected);
  const thresholdColor = getThresholdColor(level, thresholds);
  const color = thresholdColor === '--text' ? '--success' : thresholdColor;

  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 -z-10"
      style={{
        backgroundColor: `var(${color})`,
        opacity: 0.2,
        width: `${Math.min(100, level)}%`,
      }}
    />
  );
}
