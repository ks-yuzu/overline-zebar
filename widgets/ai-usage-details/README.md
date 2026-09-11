# AI usage details

This widget is opened from either the Claude or the Codex usage chip in the
main bar, and holds both: Claude on the left, Codex on the right. Each side
shows its current windows, the trend within the window in progress, and the
retained history. The window closes when it loses focus.

Each service is fetched on its own, so one whose helper fails leaves the other
side standing.

History is collected by `scripts/claude-usage/claude-usage-json` and
`scripts/codex-usage/codex-usage-json` every five minutes, and retained for 14
days in each service's own usage cache.
