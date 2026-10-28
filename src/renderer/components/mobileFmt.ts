/** Shared number formatting for the MT5-style mobile views. MT5 renders figures with a
 *  space thousands-separator and a dot decimal (e.g. `61 586.89`, `16 758.44`), so we
 *  format en-US then swap each comma for a non-breaking space (U+00A0) — same look as
 *  MT5, and a figure never wraps mid-number. P&L uses a real minus glyph. */

const spaceSep = (s: string) => s.replace(/,/g, ' ');

/** Money / account figure — 2 decimals. */
export const money = (n: number) => spaceSep(n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/** Price — 2–5 decimals (covers crypto 2dp through FX 5dp). */
export const px = (n: number) => spaceSep(n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 }));

/** Signed P&L — leading minus glyph for negatives, bare for non-negatives. */
export const pnl = (n: number) => `${n < 0 ? '−' : ''}${money(Math.abs(n))}`;
