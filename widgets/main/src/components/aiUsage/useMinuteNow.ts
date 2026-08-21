import { useEffect, useState } from 'react';

export function useMinuteNow() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  return now;
}

export function formatRemaining(resetsAt: number, now: number) {
  const remainingMinutes = Math.max(0, Math.ceil((resetsAt - now) / 60_000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
