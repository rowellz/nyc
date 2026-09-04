/** Shared formatting helpers for the status views. */

export function clockFromDayFraction(f: number): string {
  const total = Math.floor(f * 24 * 60);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function phaseFromDayFraction(f: number): string {
  const h = f * 24;
  if (h < 5) return 'night';
  if (h < 7) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 15) return 'midday';
  if (h < 18) return 'afternoon';
  if (h < 20) return 'golden hour';
  if (h < 22) return 'dusk';
  return 'night';
}

export function prettyCondition(c: string): string {
  return c.replace(/_/g, ' ');
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}
