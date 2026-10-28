import type { AccountInfo, PositionRow } from '../shared/types';

/** A connected account's live state held in the renderer. */
export interface ConnAcct {
  id: string;
  label: string;
  broker: string;
  isDemo: boolean;
  info: AccountInfo | null;
  symbols: string[];
  watch: string[];
  positions: PositionRow[];
}

/** A live quote with the last tick direction (for green/red flashing). */
export interface QuoteVal { bid: number; ask: number; time: number; dir: 'up' | 'down' | 'flat' }

/** accountId → symbol → quote. */
export type QuoteMap = Record<string, Record<string, QuoteVal>>;
