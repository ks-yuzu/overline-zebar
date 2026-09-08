/* Codicons from Nerd Fonts v3.5.1, carried by Cojica: cod-claude and
   cod-openai. Escaped because the code points are private use and would render
   as nothing in this file. The font is not bundled - it has to be installed on
   the system. */
const SERVICES = {
  claude: { glyph: '\uec82', label: 'Claude usage' },
  codex: { glyph: '\uec81', label: 'Codex usage' },
} as const;

type Props = {
  service: keyof typeof SERVICES;
};

export default function ServiceIcon({ service }: Props) {
  const { glyph, label } = SERVICES[service];

  return (
    <span
      aria-label={label}
      className="font-icon text-lg leading-none text-icon"
      role="img"
    >
      {glyph}
    </span>
  );
}
