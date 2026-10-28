/** Shared History time-range filter — ONE source of truth for the period filter used by
 *  BOTH the mobile History view (MobileHistory + MobileHeader) and the desktop History
 *  panel (Toolbox). Filtering is 100% CLIENT-SIDE over the already-loaded rows (the broker
 *  serves a recent window; we don't re-query per period), so mobile and desktop filter
 *  IDENTICALLY — "same how it's done on mobile" by construction. */

export type Period = 'today' | 'yesterday' | 'thisweek' | 'week' | 'month' | 'q' | 'all';

export const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'thisweek', label: 'This week' },
  { id: 'week', label: 'Last week' },
  { id: 'month', label: 'Last month' },
  { id: 'q', label: 'Last 3 months' },
  { id: 'all', label: 'All history' },
];

// History times are ISO-8601 with milliseconds (the TickerAll API `d.toISOString()` →
// "2026-06-26T03:00:00.000Z"), so parse ISO FIRST. The old code blindly did
// `.replace(/\./g,'-')` (meant for the legacy MT5-dotted "2026.06.26 03:00:00"), which
// mangled the millisecond dot ".000" → "-000" → NaN → 0 → EVERY bounded range filtered to
// empty (only "All history" / from=0 survived). Fall back to the dotted form for any feed
// that still sends it.
export const parseT = (s: string): number => {
  if (!s) return 0;
  const iso = Date.parse(s);
  if (Number.isFinite(iso)) return iso;
  const dotted = Date.parse(s.replace(/\./g, '-').replace(' ', 'T'));
  return Number.isFinite(dotted) ? dotted : 0;
};

const DAY = 86_400_000;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Monday 00:00 of t's week (ISO week start).
const startOfWeek = (t: number) => { const sod = startOfDay(t); const dow = (new Date(sod).getDay() + 6) % 7; return sod - dow * DAY; };

// [from, to) epoch-ms window for a period (to = Infinity → open-ended up to now).
// Today / Yesterday / This week are CALENDAR windows; Last week/month/3-months are rolling.
export const periodRange = (p: Period): [number, number] => {
  const now = Date.now();
  const sod = startOfDay(now);
  switch (p) {
    case 'today': return [sod, Infinity];
    case 'yesterday': return [sod - DAY, sod];
    case 'thisweek': return [startOfWeek(now), Infinity];
    case 'week': return [now - 7 * DAY, Infinity];
    case 'month': return [now - 30 * DAY, Infinity];
    case 'q': return [now - 90 * DAY, Infinity];
    default: return [0, Infinity];
  }
};
