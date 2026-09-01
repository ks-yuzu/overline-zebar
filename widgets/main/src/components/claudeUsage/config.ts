// Runs in the default WSL distribution as its default user so that the pack
// does not embed a distribution name, user name, or absolute home path.
// `sh -c` expands $HOME inside WSL. Keep the matching `argsRegex` in
// `zpack.json` in sync with these arguments.
export const CLAUDE_USAGE_COMMAND: { program: string; args: string[] } = {
  program: 'wsl.exe',
  args: ['--', 'sh', '-c', '$HOME/bin/claude-usage-json --cached-only'],
};
