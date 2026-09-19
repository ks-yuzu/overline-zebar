import { cn } from '../../utils/cn';

/* Codicons from Nerd Fonts v3.5.1, carried by Cojica: cod-claude and
   cod-openai. Escaped because the code points are private use and would render
   as nothing in this file. The font is not bundled - it has to be installed on
   the system. Named here rather than as a Tailwind token, because this is the
   only place that needs it and the shared config is upstream's file. */
const FONT_FAMILY = "'Cojica', monospace";

const GLYPHS = {
  claude: '\uec82',
  codex: '\uec81',
} as const;

type Props = {
  service: keyof typeof GLYPHS;
  className?: string;
  /* Given only where no adjacent text names the service. Without it the glyph
     stays out of the a11y tree, which is what lucide did for the same spots -
     a private use code point read aloud is noise. */
  label?: string;
};

export function ServiceIcon({ service, className, label }: Props) {
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={cn('text-lg leading-none text-icon', className)}
      style={{ fontFamily: FONT_FAMILY }}
      role={label ? 'img' : undefined}
    >
      {GLYPHS[service]}
    </span>
  );
}
