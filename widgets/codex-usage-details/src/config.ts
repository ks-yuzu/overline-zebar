export const CODEX_USAGE_COMMAND: { program: string; args: string[] } = {
  program: 'wsl.exe',
  args: [
    '-d',
    '<wsl-distribution>',
    '--user',
    '<wsl-user>',
    '--',
    '$HOME/bin/codex-usage-json',
    '--cached-only',
  ],
};
