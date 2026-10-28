import type { TerminalApi } from '../shared/types';

declare global {
  interface Window { terminal: TerminalApi }
}

/** The preload bridge — the only surface the renderer can touch. */
export const api: TerminalApi = window.terminal;

/** Turn a thrown error / TickerAll sign-in error code into a human message. */
export function humanizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/invalid_credentials/i.test(msg)) return 'Wrong email or password.';
  if (/timed out/i.test(msg)) return 'Sign-in timed out — please try again.';
  return msg;
}
