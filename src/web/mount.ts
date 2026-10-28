/**
 * Web platform install. The renderer reads `window.terminal` at module-load
 * (renderer/api.ts), so the host MUST install it BEFORE the renderer's module
 * graph initializes — the web entry (index.tsx) calls this, then dynamic-imports
 * the renderer. Typed (`.ts`, typechecked) so the WebTerminalApi construction is
 * checked against the contract; the thin entry glue lives in index.tsx (`.tsx`).
 */

import { WebTerminalApi, type WebTerminalApiConfig } from './webTerminalApi';

export type { WebTerminalApiConfig } from './webTerminalApi';
export type { WebAuthProvider } from './webTerminalApi';

/** Construct the web TerminalApi and install it on `window.terminal`. */
export function installWebPlatform(config: WebTerminalApiConfig): void {
  window.terminal = new WebTerminalApi(config);
}
