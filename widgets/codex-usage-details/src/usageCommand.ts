import * as zebar from 'zebar';

export type UsageCommand = {
  program: string;
  args: string[];
  env?: Record<string, string>;
};

/** Longest command output excerpt kept in an error message. */
const MAX_OUTPUT_EXCERPT = 300;

export function formatUsageCommand(command: UsageCommand): string {
  return [command.program, ...command.args].join(' ');
}

/**
 * Condenses command output into a single line fit for an error message.
 *
 * `wsl.exe` writes its own failures as UTF-16LE, which the UTF-8 decoding
 * turns into text with a NUL after every ASCII character, so strip NULs
 * before showing it. `WSL_UTF8` covers newer WSL builds; this covers the
 * rest.
 */
function excerptOutput(output: string): string {
  const text = output.replace(/\0/g, '').replace(/\s+/g, ' ').trim();

  return text.length > MAX_OUTPUT_EXCERPT
    ? `${text.slice(0, MAX_OUTPUT_EXCERPT)}…`
    : text;
}

/**
 * Runs a usage helper and parses its stdout.
 *
 * A failure renders as a bare `--`, so log the command and the cause where
 * the widget devtools (Ctrl+Shift+I) can show them.
 */
export async function fetchUsageJson<T>(
  label: string,
  command: UsageCommand,
  parse: (stdout: string) => T
): Promise<T> {
  try {
    const result = await zebar.shellExec(command.program, command.args, {
      env: command.env,
    });

    if (result.code !== 0) {
      // The helper reports its own failures on stderr, but `wsl.exe`
      // reports a failed launch on stdout, so fall back to stdout.
      const detail =
        excerptOutput(result.stderr) || excerptOutput(result.stdout);

      throw new Error(
        `${label} command exited with ${result.code}.${detail ? ` ${detail}` : ''}`
      );
    }

    return parse(result.stdout);
  } catch (error) {
    console.error(`${label} fetch failed:`, formatUsageCommand(command), error);
    throw error;
  }
}
