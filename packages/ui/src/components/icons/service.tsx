import { cn } from '../../utils/cn';

/* Codicons from Nerd Fonts v3.5.1, carried by Cojica: cod-claude and
   cod-openai. Escaped because the code points are private use and would render
   as nothing in this file. The font is not bundled - it has to be installed on
   the system. */
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
      className={cn('font-icon text-lg leading-none text-icon', className)}
      role={label ? 'img' : undefined}
    >
      {GLYPHS[service]}
    </span>
  );
}
