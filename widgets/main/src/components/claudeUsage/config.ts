import type { UsageCommand } from '../aiUsage/usageCommand';

// Runs in the default WSL distribution as its default user so that the pack
// does not embed a distribution name, user name, or absolute home path.
// `sh -c` expands $HOME inside WSL. Keep the matching `argsRegex` in
// `zpack.json` in sync with these arguments; `env` is not covered by that
// permission and needs no change there.
export const CLAUDE_USAGE_COMMAND: UsageCommand = {
  program: 'wsl.exe',
  args: ['--', 'sh', '-c', '$HOME/bin/claude-usage-json --cached-only'],
  // Without this, `wsl.exe` reports a failed launch as UTF-16LE.
  env: { WSL_UTF8: '1' },
};
