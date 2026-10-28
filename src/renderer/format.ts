/** Price formatting — MT5-ish digit heuristic until per-symbol digits are wired
 *  (FX majors 5dp, JPY/indices 3dp, metals/crypto 2dp). Display-only. */
export function fmtPrice(p: number | undefined): string {
  if (p === undefined || !isFinite(p)) return '—';
  const d = p >= 1000 ? 2 : p >= 50 ? 3 : 5;
  return p.toFixed(d);
}

export function fmtMoney(n: number | undefined): string {
  if (n === undefined || !isFinite(n)) return '—';
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtSigned(n: number): string {
  return `${n >= 0 ? '' : ''}${fmtMoney(n)}`;
}

/** Friendly display label for a historical order's ENUM_ORDER_STATE. The value (via
 *  the SDK, lowercased upstream) is one of filled | canceled | expired | rejected |
 *  partial | placed | unknown — SDK >= 0.28.0 surfaces the non-filled states from the
 *  op=0x65 sub=0x20 order stream (a cancelled limit/stop no longer silently vanishes).
 *  Title-cased for display; an unrecognised value is capitalised as-is, never dropped. */
export function orderStateLabel(state: string | undefined): string {
  if (!state) return '—';
  const s = state.toLowerCase();
  const map: Record<string, string> = {
    filled: 'Filled', canceled: 'Cancelled', cancelled: 'Cancelled', expired: 'Expired',
    rejected: 'Rejected', partial: 'Partial', placed: 'Placed', started: 'Started', unknown: 'Unknown',
  };
  return map[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

/** Format a broker trade-time (ISO-8601, an epoch seconds/ms string, or the legacy
 *  MT5-dotted "YYYY.MM.DD HH:MM[:SS]") as a locale date-time. Returns '—' when the value
 *  is absent or unparseable — never throws, never shows "Invalid Date". */
export function fmtTradeTime(t: string | number | null | undefined): string {
  if (t == null || t === '') return '—';
  let ms: number;
  if (typeof t === 'number') {
    ms = t > 1e12 ? t : t * 1000;
  } else {
    let s = t.trim();
    if (/^\d+$/.test(s)) { const n = Number(s); ms = n > 1e12 ? n : n * 1000; }
    else {
      // MT5 commonly sends "YYYY.MM.DD HH:MM[:SS]" — Date.parse can't read the dots, so
      // normalise to ISO first (matches tradeTimeSec in Terminal.tsx).
      const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
      if (m) s = `${m[1]}-${m[2]}-${m[3]}T${m[4]}`;
      ms = Date.parse(s);
    }
  }
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : '—';
}
