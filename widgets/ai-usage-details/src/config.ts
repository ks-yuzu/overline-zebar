export const CLAUDE_USAGE_COMMAND: { program: string; args: string[] } = {
  program: 'wsl.exe',
  args: [
    '-d',
    '<wsl-distribution>',
    '--user',
    '<wsl-user>',
    '--',
    '$HOME/bin/claude-usage-json',
    '--cached-only',
  ],
};
