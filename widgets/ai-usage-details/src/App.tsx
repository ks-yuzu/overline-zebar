import { useWidgetSetting } from '@overline-zebar/config';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import * as zebar from 'zebar';
import ClaudeSection from './ClaudeSection';
import CodexSection from './CodexSection';

const HISTORY_WINDOW_SECONDS = 14 * 24 * 60 * 60;

export default function App() {
  const [now, setNow] = useState(() => Date.now());
  const [systemStatThresholds] = useWidgetSetting(
    'main',
    'systemStatThresholds'
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    let unlisten: (() => void) | undefined;
    void zebar
      .currentWidget()
      .tauriWindow.listen('tauri://blur', () => {
        void zebar.currentWidget().close();
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });

    return () => {
      window.clearInterval(interval);
      unlisten?.();
    };
  }, []);

  /* Both blocks are given the same fortnight so that a bar in one is the same
     span of time as the bar level with it in the other. */
  const historyRange = {
    startAt: now / 1000 - HISTORY_WINDOW_SECONDS,
    endAt: now / 1000,
  };

  return (
    <div className="relative flex h-screen overflow-y-auto rounded-lg border border-button-border/80 bg-background p-3 font-mono text-text shadow-sm backdrop-blur-xl">
      {/* Each service fetches on its own, so one that fails leaves the other
          block standing. */}
      <ClaudeSection
        className="flex-1 pr-2"
        historyRange={historyRange}
        now={now}
        thresholds={systemStatThresholds}
      />
      <CodexSection
        className="flex-1 border-l border-border pl-2"
        historyRange={historyRange}
        now={now}
        thresholds={systemStatThresholds}
      />
      {/* Outside both blocks: it has to stay reachable when the block it would
          otherwise sit in is showing an error. */}
      <button
        aria-label="Close AI usage details"
        className="absolute right-3 top-3 rounded p-1 text-text-muted transition-colors hover:bg-background-deeper hover:text-text"
        onClick={() => void zebar.currentWidget().close()}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
