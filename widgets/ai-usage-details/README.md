# AI usage details

This widget is opened from the Claude usage chip in the main bar. It displays
the current 5H and 7D usage windows and their retained history. The window
closes when it loses focus.

History is collected by `scripts/claude-usage/claude-usage-json` every five
minutes and retained for 14 days in the existing Claude usage cache.
