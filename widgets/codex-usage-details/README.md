# Codex usage details

This widget is opened from the Codex usage chip in the main bar. It displays
the current rate-limit windows and their retained history. The window closes
when it loses focus.

History is collected by `scripts/codex-usage/codex-usage-json` every five
minutes and retained for 14 days in the existing Codex usage cache.
