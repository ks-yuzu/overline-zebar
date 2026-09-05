import { cn } from '../../utils/cn';
import { clampPercentage } from '../../utils/clampPercentage';
import { getThresholdColor } from '../../utils/thresholds';
import Ring from './components/Ring';
import { systemStatThresholds } from './defaults/systemStatThresholds';
import { Threshold } from '@overline-zebar/config';

interface StatRingProps {
  Icon: React.ReactNode;
  stat: string;
  threshold?: Threshold[];
}

export function StatRing({
  Icon,
  stat,
  threshold = systemStatThresholds,
}: StatRingProps) {
  function getNumbersFromString(str: string): number {
    const match = str.match(/-?\d+/g);
    if (match && match.length > 0) {
      const num = Number(match[0]);
      return isNaN(num) ? 0 : num;
    }
    return 0;
  }

  const statAsInt = clampPercentage(getNumbersFromString(stat));
  const thresholdColor = getThresholdColor(statAsInt, threshold);
  const colorClassMap = {
    '--text': { text: 'text-text', stroke: 'stroke-success' },
    '--warning': { text: 'text-warning', stroke: 'stroke-warning' },
    '--danger': { text: 'text-danger', stroke: 'stroke-danger' },
  };
  // The type says the lookup always hits, but the value comes from config: a
  // config that fails validation is merged into the defaults and used as-is,
  // so labelColor can still hold something outside the union (a legacy or
  // hand-edited '--primary', say). Without the fallback that renders the whole
  // bar as a TypeError, on every monitor.
  const colors = colorClassMap[thresholdColor] ?? colorClassMap['--text'];

  return (
    <div
      className={cn('flex items-center justify-center gap-1.5', colors.text)}
    >
      {Icon}
      <Ring
        percentage={statAsInt}
        className="h-3.5 w-3.5"
        strokeColor={cn(colors.stroke)}
      />
    </div>
  );
}
