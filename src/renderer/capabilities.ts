/**
 * Host capabilities — the renderer's read-side of TerminalApi.platform (the sync capability
 * discriminator each host installs on `window.terminal`). Components gate UI on these instead
 * of letting a host-unsupported method silently throw: e.g. hide the manual-trade UI when
 * !canTrade.
 *
 * Read straight off `window.terminal` (guarded), NOT via `../api` — that keeps this module
 * import-safe in the node test runner (api.ts touches `window` at import) and mirrors how
 * branding.ts reads the DOM. `platform` is a static set at boot and never changes, so a plain
 * read each call is fine.
 *
 * SAFE FALLBACKS when platform is somehow absent (renderer + its host are co-shipped, so this
 * is belt-and-suspenders): NEVER hide trading on a missing field (canTrade true).
 */
import type { Capabilities, HostNavItem, PlatformInfo, PlatformKind } from '../shared/types';

export const SAFE_DEFAULTS: Capabilities = {
  canTrade: true,
  nativeTitlebar: true,
};

/** Pure resolver — exported for tests. */
export function resolveCapabilities(platform: PlatformInfo | undefined): Capabilities {
  return platform?.capabilities ?? SAFE_DEFAULTS;
}

/** Pure resolver — exported for tests. Defaults to 'desktop' when platform is absent. */
export function resolvePlatformKind(platform: PlatformInfo | undefined): PlatformKind {
  return platform?.kind ?? 'desktop';
}

/** Pure resolver — exported for tests. The host-injected initial active account, or undefined
 *  when absent/blank (§29 presence: a blank value is NOT a valid account id, so it's ignored). */
export function resolveActiveAccountId(platform: PlatformInfo | undefined): string | undefined {
  const id = platform?.activeAccountId?.trim();
  return id ? id : undefined;
}

/** The host-installed platform info off `window.terminal`, or undefined outside a host. */
function hostPlatform(): PlatformInfo | undefined {
  if (typeof window === 'undefined') return undefined;
  const p = (window as unknown as { terminal?: { platform?: PlatformInfo } }).terminal?.platform;
  // A preview/test Proxy stub may return a non-object for `platform`; treat only a real
  // {kind,capabilities} shape as present (else fall back to defaults).
  return p && typeof p === 'object' && 'capabilities' in p ? p : undefined;
}

/** This host's capabilities (resolved, with safe fallbacks). */
export function getCapabilities(): Capabilities {
  return resolveCapabilities(hostPlatform());
}

/** This host's kind ('desktop' | 'web'). */
export function getPlatformKind(): PlatformKind {
  return resolvePlatformKind(hostPlatform());
}

/** The host-injected initial active account (web), or undefined. */
export function getActiveAccountId(): string | undefined {
  return resolveActiveAccountId(hostPlatform());
}

/** Pure resolver — exported for tests. The host-injected boot-chart symbol (web), or undefined
 *  when absent/blank (§29 presence: a blank value is not a valid instrument token). */
export function resolveActiveSymbol(platform: PlatformInfo | undefined): string | undefined {
  const s = platform?.activeSymbol?.trim();
  return s ? s : undefined;
}

/** Pure resolver — exported for tests. The host-injected boot-chart timeframe TOKEN (web), or
 *  undefined when absent/blank. Independently optional from activeSymbol. */
export function resolveActiveTimeframe(platform: PlatformInfo | undefined): string | undefined {
  const t = platform?.activeTimeframe?.trim();
  return t ? t : undefined;
}

/** The host-injected Studio deep-link boot-chart symbol (web), or undefined. */
export function getActiveSymbol(): string | undefined {
  return resolveActiveSymbol(hostPlatform());
}

/** The host-injected Studio deep-link boot-chart timeframe token (web), or undefined. */
export function getActiveTimeframe(): string | undefined {
  return resolveActiveTimeframe(hostPlatform());
}

/** An icon is renderable when it's an inline `<svg …>` string or a `data:` image URI — the two
 *  shapes of the frozen `HostNavItem.icon` contract. Anything else (a bare URL, arbitrary
 *  markup, a non-string) is rejected, so the bar never injects unvetted host HTML. */
function usableIcon(icon: unknown): icon is string {
  if (typeof icon !== 'string') return false;
  const s = icon.trim();
  return s.startsWith('<svg') || s.startsWith('data:image/');
}

/**
 * Pure resolver — exported for tests. The host-injected mobile bottom-bar entries, normalized:
 * non-array → `[]`; every item must carry a non-blank `id` + `label` and a usable `icon`
 * (§29 presence — a blank field is ABSENT, so the item is DROPPED rather than rendered as an
 * empty button); `position` falls back to `'end'`; duplicate ids keep the FIRST (a repeat would
 * otherwise collide as a React key). A host that injects nothing gets `[]` and the bar renders
 * exactly the four built-in tabs.
 */
export function resolveMobileNavItems(platform: PlatformInfo | undefined): HostNavItem[] {
  const raw = platform?.mobileNavItems;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: HostNavItem[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const id = typeof it.id === 'string' ? it.id.trim() : '';
    const label = typeof it.label === 'string' ? it.label.trim() : '';
    if (!id || !label || !usableIcon(it.icon) || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label,
      icon: it.icon.trim(),
      onSelect: typeof it.onSelect === 'function' ? it.onSelect : undefined,
      href: typeof it.href === 'string' && it.href.trim() ? it.href.trim() : undefined,
      position: it.position === 'start' ? 'start' : 'end',
    });
  }
  return out;
}

/** The host-injected mobile bottom-bar entries (web), or `[]` on desktop / an uninjected host. */
export function getMobileNavItems(): HostNavItem[] {
  return resolveMobileNavItems(hostPlatform());
}
