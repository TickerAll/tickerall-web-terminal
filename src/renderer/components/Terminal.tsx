import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuthUser, BrokerAccount, ConnectConfig, ConnectResult, HistoryRow, OrderRow, DealRow,
  Quote, PositionPush, AccountPush, OrdersPush, SymbolSpecLite, PositionRow, PendingOrderRow,
} from '../../shared/types';
import { TIMEFRAMES, TF_LABEL } from '../../shared/types';
import type { ConnAcct, QuoteMap, QuoteVal } from '../types';
import { api, humanizeError } from '../api';
import { ChartPane, type ChartPaneHandle } from './ChartPane';
import { tickBus } from '../chart/tickBus';
import { MarketWatch } from './MarketWatch';
import { Navigator } from './Navigator';
import { Toolbox, type ToolboxTab } from './Toolbox';
import { recomputePositionPnl, deriveAccountPnlFactor } from '../livePnl';
import { resolveSetActiveChart, resolveBootChart } from '../chart/setActiveChartCommand';
import { OrderDialog } from './OrderDialog';
import { SettingsPage } from './SettingsPage';
import { ChartTabs, LAYOUTS, type ChartTab } from './ChartTabs';
import { pickAccountTab, mirrorActiveTab } from './accountFocus';
import { ChartMosaic } from './ChartMosaic';
import { buildTree, pruneTree, appendLeaf, removeLeaf, leaves, type ChartLayout, type MosaicNode } from './mosaic';
import { BigPrice } from './BigPrice';
import { type ChartTrade } from './TradeLayer';
import { consumeDrawTap, markDrawTapConsumed } from '../drawing/tapSignal';
import { IndicatorMenu } from '../chart/indicators';
import { ThemeSwitcher } from '../theme/ThemeSwitcher';
import { useTradeSounds, seedTradeSounds, resetTradeSounds } from '../sound/tradeSounds';
import { startAlertsEngine } from '../alerts/AlertsEngine';
import { initAlertsSync } from '../alerts/sync';
import { StatusBar, type ConnectionSummary } from './StatusBar';
import { UserMenu } from './UserMenu';
import { BrandLogo } from './BrandLogo';
import { getBranding } from '../branding';
import { getCapabilities, getPlatformKind, getActiveAccountId, getActiveSymbol, getActiveTimeframe } from '../capabilities';
import { useViewport, orientationOf, tierOverride } from './useViewport';
import { TierToggle } from './TierToggle';
import { MobileNav, type MobileView } from './MobileNav';
import { MobileHeader } from './MobileHeader';
import { MobileTrade } from './MobileTrade';
import { MobileQuotes } from './MobileQuotes';
import { MobileHistory } from './MobileHistory';
import { type Period } from './historyFilter';
import { MobileTradeBand } from './MobileTradeBand';
import { MobileSymbolPicker } from './MobileSymbolPicker';
import { MobileTfRadial } from './MobileTfRadial';
import { MobileAccountView } from './MobileAccountView';
import { ModifyDialog, type ModifyTarget } from './ModifyDialog';
import { px as fmtPx } from './mobileFmt';
import { CommandPalette } from '../command/CommandPalette';
import { useTerminalCommands } from '../command/useTerminalCommands';
import { setSetting } from '../settings/store';
import { useSetting } from '../settings/hooks';
import { useTheme } from '../theme/ThemeProvider';

/** Parse a broker trade time (ISO string, or epoch ms/s) to epoch SECONDS for the
 *  chart's time axis, or null if unparseable. */
function tradeTimeSec(t: string | number | null | undefined): number | null {
  if (t == null || t === '') return null;
  if (typeof t === 'number') return Number.isFinite(t) ? (t > 1e12 ? Math.floor(t / 1000) : Math.floor(t)) : null;
  let s = t.trim();
  if (/^\d+$/.test(s)) { const n = Number(s); return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n); }
  // MT5 commonly formats times as "YYYY.MM.DD HH:MM[:SS]" — Date.parse can't read the dots,
  // so normalise to ISO ("YYYY-MM-DDTHH:MM[:SS]") first. Without this, every trade time
  // parses to NaN → null → the trade is silently dropped.
  const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
  if (m) s = `${m[1]}-${m[2]}-${m[3]}T${m[4]}`;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** The persisted workspace — the active (account, symbol, timeframe) + every open chart
 *  tab — so reopening the terminal restores exactly what you left (not a reset to the
 *  first account / 1 tab / default symbol). Renderer-only (localStorage); accounts
 *  themselves re-warm via previouslyConnected(). */
interface SavedWorkspace {
  activeAccountId: string | null;
  activeSymbol: string | null;
  timeframe: number;
  tabs: { accountId: string; symbol: string; timeframe: number; pinned: boolean }[];
  /** Per-account Market Watch symbols — so symbols you add in Quotes survive a reload
   *  (the broker re-sends only the DEFAULT watch on reconnect, losing user additions). */
  watchlists?: Record<string, string[]>;
  /** The last view route (#charts/#trade/…) — so a relaunch returns to the same view. */
  route?: string;
}

/** The hash routes — one per primary view. Web: location.hash is refresh-safe with zero
 *  server change (the browser strips it before the request). Desktop (Electron): the same
 *  location.hash + history works, so one mechanism covers both. */
const ROUTE_HASHES = ['quotes', 'charts', 'trade', 'history', 'account', 'settings', 'journal', 'alerts'];
// Routes that open a full-screen MODAL SHEET on mobile — must NOT auto-reopen from a persisted
// workspace route on boot (a phone would reboot trapped in the sheet). Explicit hash nav still opens.
const MODAL_SHEET_ROUTES: string[] = [];
const WORKSPACE_KEY = 'ta.workspace';

function readWorkspace(): SavedWorkspace | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as SavedWorkspace;
    if (w && typeof w === 'object' && Array.isArray(w.tabs)) return w;
  } catch { /* corrupt / unavailable → start fresh */ }
  return null;
}
function writeWorkspace(w: SavedWorkspace): void {
  try { localStorage.setItem(WORKSPACE_KEY, JSON.stringify(w)); } catch { /* quota / unavailable — non-fatal */ }
}

/** Per-account UI workspace (#19 part B): the per-account chart state that ta.workspace's
 *  single active context can't hold — the mosaic LAYOUT, the left-sidebar collapse, and the
 *  account's last-active SYMBOL/TF (`sym`/`tf`, so switching back restores the chart you left
 *  on THAT account, not the first tab). acc.watch carries the watchlist; the chart-tab LIST is
 *  per-account in `tabs`. Kept in its OWN accountId-keyed map, separate from ta.workspace, so
 *  the (gated, boot-timing-sensitive) session restore is untouched. Saved on the outgoing
 *  account + loaded on the incoming one as you switch; a brand-new account gets sane defaults. */
type AcctUi = { layout: ChartLayout; leftCollapsed: boolean; sym?: string | null; tf?: number };
const ACCT_WS_KEY = 'ta.acctWs';
function readAcctWs(): Record<string, AcctUi> {
  try { const r = JSON.parse(localStorage.getItem(ACCT_WS_KEY) || '{}'); return r && typeof r === 'object' ? r : {}; } catch { return {}; }
}

// TF token ('M5') → numeric MT5 enum (5), for the boot-chart deep-link. Built from
// the shared TIMEFRAMES table (label↔id); an unknown/absent token → null (caller keeps the
// current timeframe). The host passes a partner host's TF token verbatim; the mapping lives here.
const TF_ID: Record<string, number> = Object.fromEntries(TIMEFRAMES.map((t) => [t.label, t.id]));
function tokenToTimeframe(token: string | undefined): number | null {
  return token != null && TF_ID[token] != null ? TF_ID[token] : null;
}

export function Terminal({ user, onLogout }: { user?: AuthUser; onLogout: () => void }) {
  const [accounts, setAccounts] = useState<BrokerAccount[]>([]);
  const [connected, setConnected] = useState<Record<string, ConnAcct>>({});
  // Mirror of `connected` for stable callbacks (e.g. the stream-reconnect resync) that
  // need the CURRENT account list without re-subscribing on every connect/disconnect.
  const connectedRef = useRef<Record<string, ConnAcct>>({});
  useEffect(() => { connectedRef.current = connected; }, [connected]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<Set<string>>(new Set()); // accountIds mid-connect
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState(16385); // H1
  const [reloadKey, setReloadKey] = useState(0); // bump to force-reload the SAME chart (reload button)
  const [quotes, setQuotes] = useState<QuoteMap>({});
  const [journal, setJournal] = useState<string[]>([`Welcome to ${getBranding().productName} Terminal.`]);
  const [toolboxTab, setToolboxTab] = useState<ToolboxTab>('trade');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]); // historical orders (History → Orders tab)
  const [deals, setDeals] = useState<DealRow[]>([]); // historical deals/fills (History → Deals tab)
  const [pending, setPending] = useState<PendingOrderRow[]>([]); // resting pending orders (Trade → Orders)
  const [modifyTarget, setModifyTarget] = useState<ModifyTarget | null>(null); // open Modify dialog target
  const [modifyBusy, setModifyBusy] = useState(false);
  const [orderFor, setOrderFor] = useState<string | null>(null);
  const [orderBusy, setOrderBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Responsive layout (WEB ONLY — desktop Electron is always tier='desktop', so all
  // of the below is inert there: the grid, panel routing, drawer and bottom-nav reduce
  // to the original desktop render). See useViewport / index.html responsive @media.
  const vp = useViewport();
  const brand = getBranding(); // host-injected product name / logo / home (or TickerAll defaults)
  const tradingEnabled = getCapabilities().canTrade; // false on a trade-disabled deployment (a partner host) → read-only Trade tab, no order/modify/close/band
  // Auto-snap to the mobile layout when the desktop/tablet toolbar runs out of room and its
  // right-hand controls (profile/settings/…) would clip — the bar is overloaded, so beyond a
  // point there's simply no space. Driven by a ResizeObserver on the toolbar (see effect
  // below). Skipped when the user has FORCED a tier via the toggle (an explicit preview wins).
  const toolbarRef = useRef<HTMLElement | null>(null);
  const [snapMobile, setSnapMobile] = useState(false);
  const snapAtRef = useRef(0); // viewport width (px) at which we snapped — the un-snap threshold
  // The snap applies to WHATEVER non-mobile tier is in effect (forced or width-resolved): the
  // toolbar must never clip. Only a forced 'mobile' has nothing to snap.
  const effTier = snapMobile ? 'mobile' : vp.tier;
  const isMobile = effTier === 'mobile';
  const isTablet = effTier === 'tablet';
  useEffect(() => {
    if (!vp.isWeb || vp.tier === 'mobile') { if (snapMobile) setSnapMobile(false); return; }
    if (snapMobile) {
      // Un-snap once the window is clearly wider than where it overflowed (+40px dead-band).
      if (vp.width > snapAtRef.current + 40) setSnapMobile(false);
      return;
    }
    const el = toolbarRef.current;
    if (!el) return;
    // The toolbar's content must fit the actual VIEWPORT. The #mt5 grid can grow WIDER than the
    // window (so the toolbar's own clientWidth isn't the constraint — it overflows the screen
    // edge). Compare the toolbar's full content width (scrollWidth) to window.innerWidth: if it
    // exceeds the viewport, something is being cut off at the edge → snap to mobile NOW.
    const check = () => {
      const iw = window.innerWidth;
      if (el.scrollWidth > iw + 2) { snapAtRef.current = iw; setSnapMobile(true); }
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vp.isWeb, vp.width, vp.tier, snapMobile]);
  const [mobileView, setMobileView] = useState<MobileView>('chart'); // active mobile bottom-tab
  const [streamDown, setStreamDown] = useState(false); // live stream dropped (phones: shown as a pill)
  const [drawerLeft, setDrawerLeft] = useState(false); // mobile/tablet: side drawer open
  const [mobileSheet, setMobileSheet] = useState<null | 'journal' | 'alerts'>(null); // mobile full-screen sheet (from ☰)
  const [mobileAddOpen, setMobileAddOpen] = useState(false); // mobile: add-symbol picker (Quotes +)
  const [mobileSymPick, setMobileSymPick] = useState(false); // mobile: chart symbol-switch picker (tap the symbol)
  const [mobileTfOpen, setMobileTfOpen] = useState(false); // mobile: timeframe strip (tap the chart)
  const [histPeriod, setHistPeriod] = useState<Period>('all'); // mobile History period (dropdown lives in the header)
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false); // mobile: dedicated account-details view (from ☰)
  const [connectSignal, setConnectSignal] = useState(0); // bump to open the Navigator's connect form (chart CTA)
  const openConnect = () => { setConnectSignal((n) => n + 1); if (isMobile) setDrawerLeft(true); };
  // The brand logo / drawer "Home" item leaves the web terminal (/terminal) back to the
  // host's site root (branding.homeUrl; default '/'). Web-only: the Electron desktop app is
  // itself the home, so it no-ops.
  const goHome = () => { if (vp.isWeb) window.location.href = brand.homeUrl; };

  // Workspace persist/restore state (Items 5 + 2) — read once at mount; `wsRestored` gates
  // persistence (so the empty boot state never clobbers the save), `restoredWatch` tracks
  // which accounts have had their saved watchlist re-applied, `bootDone` lets the restore
  // give up if the saved active account never reconnects. Declared here (before
  // addConnected) so the connect path can restore each account's watchlist as it warms.
  const savedWs = useRef<SavedWorkspace | null>(readWorkspace());
  const wsRestored = useRef(false);
  const restoredWatch = useRef<Set<string>>(new Set());
  // Per-account layout/sidebar (#19 part B): the saved map + a ref mirroring the CURRENT live
  // values so an account switch can save the OUTGOING account's state before loading the incoming.
  const acctWs = useRef<Record<string, AcctUi>>(readAcctWs());
  const liveUi = useRef<{ id: string | null; layout: ChartLayout; leftCollapsed: boolean; sym: string | null; tf: number }>({ id: null, layout: 'single', leftCollapsed: false, sym: null, tf: 16385 });
  const [bootDone, setBootDone] = useState(false);
  const [bandVolume, setBandVolume] = useState(0.01); // mobile chart SELL/BUY band volume
  const [bandConfirm, setBandConfirm] = useState<null | 'BUY' | 'SELL'>(null); // band order confirmation (MT5 confirms by default)
  const [oneClickTrading] = useSetting<boolean>('general.oneClickTrading'); // opt-in: band places instantly
  // stepBandVol / setBandVolumeManual / bandOrder are defined after activeSpec (below) —
  // they clamp the volume to the symbol's volumeMin / volumeStep.

  // Mobile: the drawing tools are hidden by default (they'd overlap the chart); a
  // press-and-hold on the chart reveals them. The hold timer cancels on move/drag so it
  // never fights the chart's pan/zoom; a "Done" button dismisses + un-arms the tool.
  // A SINGLE TAP on the chart toggles the timeframe strip (MT5-style — Item 2); a
  // PRESS-AND-HOLD (500ms) reveals the drawing tools. Both are armed only when the touch
  // lands on the chart canvas (.chart-main) — not the SELL/BUY band, the chart tabs, or
  // an overlay — and both cancel the moment the finger drags >10px (that's a pan/zoom).
  const [mobileDrawOpen, setMobileDrawOpen] = useState(false);
  const [mobileDrawTool, setMobileDrawTool] = useState<string | null>(null); // armed tool (null = none → an outside tap dismisses the toolbar)
  const lpTimer = useRef(0);
  const lpStart = useRef<{ x: number; y: number } | null>(null);
  const lpFired = useRef(false);   // the long-press opened the draw tools this gesture
  const tapCandidate = useRef(false); // this gesture is still a candidate single-tap
  const onChartTouchStart = (e: React.TouchEvent) => {
    if (!isMobile || mobileView !== 'chart' || e.touches.length !== 1) return;
    if (!(e.target as HTMLElement).closest?.('.chart-main')) return; // chart canvas only
    const t = e.touches[0];
    // A tap on the price-axis (Y) gutter must NOT engage the tap→TF gesture — let it reach
    // lightweight-charts so its native double-tap-to-refit (auto-fit the price scale) works.
    // The Y-axis is just another region to exclude in the #8/#21/#24/#26 tap→TF family: mark the
    // tap consumed (belt) and don't arm our long-press / tap-candidate so we never intercept it.
    if (chartPaneRef.current?.isOverPriceAxis(t.clientX)) { markDrawTapConsumed(); return; }
    lpStart.current = { x: t.clientX, y: t.clientY };
    lpFired.current = false;
    tapCandidate.current = true;
    if (!mobileDrawOpen) {
      window.clearTimeout(lpTimer.current);
      lpTimer.current = window.setTimeout(() => { lpFired.current = true; setMobileDrawOpen(true); lpStart.current = null; }, 500);
    }
  };
  const onChartTouchMove = (e: React.TouchEvent) => {
    if (!lpStart.current && !tapCandidate.current) return;
    const t = e.touches[0];
    const s = lpStart.current;
    if (s && (Math.abs(t.clientX - s.x) > 10 || Math.abs(t.clientY - s.y) > 10)) {
      window.clearTimeout(lpTimer.current);
      lpStart.current = null;
      tapCandidate.current = false; // a drag/pan — not a tap
    }
  };
  const onChartTouchEnd = () => {
    window.clearTimeout(lpTimer.current);
    lpStart.current = null;
    // A quick in-place tap (not a long-press, not a drag, not while drawing) toggles the TF strip —
    // UNLESS the drawing layer already consumed this tap (selecting/deselecting an object or
    // dismissing its menu). Without this, a dismiss/select tap ALSO opened the TF strip (#8).
    const drawConsumed = consumeDrawTap();
    if (tapCandidate.current && !lpFired.current && !mobileDrawOpen && !drawConsumed) setMobileTfOpen((v) => !v);
    tapCandidate.current = false;
  };
  const closeMobileDraw = () => { setMobileDrawOpen(false); chartPaneRef.current?.setActiveTool(null); };

  const [toolboxH, setToolboxH] = useState(212); // bottom toolbox height (px)
  const areaRef = useRef<HTMLElement>(null);
  const leftRef = useRef<HTMLElement>(null);

  // Chart tabs (multi-symbol) + panel maximize + the left-sidebar split.
  const [tabs, setTabs] = useState<ChartTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null); // which chart SLOT is active
  const tabSeq = useRef(0);
  const [maximized, setMaximized] = useState<null | 'left' | 'chart' | 'toolbox'>(null);
  const [leftSplit, setLeftSplit] = useState<number>(() => {
    const v = Number(localStorage.getItem('ta.leftSplit'));
    return v >= 0.15 && v <= 0.85 ? v : 0.55;
  });
  const [toolboxHidden, setToolboxHidden] = useState<boolean>(() => localStorage.getItem('ta.toolboxHidden') === '1');
  const [bigPrice, setBigPrice] = useState<boolean>(() => localStorage.getItem('ta.bigPrice') === '1');
  // Desktop: fully collapse the left sidebar (Navigator/watchlist) to maximise chart space (#10).
  // Persisted like its sibling toggles; desktop-only (tablet/mobile use the off-canvas drawer).
  const [leftCollapsed, setLeftCollapsed] = useState<boolean>(() => localStorage.getItem('ta.leftCollapsed') === '1');
  const toggleToolbox = () => setToolboxHidden((v) => { localStorage.setItem('ta.toolboxHidden', v ? '0' : '1'); return !v; });
  const toggleBigPrice = () => setBigPrice((v) => { localStorage.setItem('ta.bigPrice', v ? '0' : '1'); return !v; });
  const toggleLeftCollapsed = () => setLeftCollapsed((v) => { localStorage.setItem('ta.leftCollapsed', v ? '0' : '1'); return !v; });
  const [chartLayout, setChartLayout] = useState<ChartLayout>(() => {
    const v = localStorage.getItem('ta.chartLayout');
    return v === 'cols' || v === 'rows' || v === 'grid' ? v : 'single';
  });
  const [maximizedTabId, setMaximizedTabId] = useState<string | null>(null); // a chart maximized over the grid (layout preserved)
  const setLayout = (l: ChartLayout) => { localStorage.setItem('ta.chartLayout', l); setChartLayout(l); setMaximizedTabId(null); };
  const [tree, setTree] = useState<MosaicNode | null>(null); // the drag-to-dock split layout (multi-chart)
  const [dragSourceId, setDragSourceId] = useState<string | null>(null); // a strip tab being touch-dock-dragged into the mosaic
  const [activeSpec, setActiveSpec] = useState<SymbolSpecLite | null>(null); // active charted symbol's spec (for on-chart position/measure sizing)
  const [historyBySymbol, setHistoryBySymbol] = useState<Record<string, HistoryRow[]>>({}); // closed trades per charted symbol (chart overlays)

  const specs = useRef<Record<string, SymbolSpecLite | null>>({}); // `${accountId}:${symbol}` → RESOLVED spec (a spec, or null = broker genuinely has none). A key is present only once the fetch SUCCEEDS.
  const pnlFactors = useRef<Record<string, number>>({}); // `${accountId}:${symbol}` → account-currency P&L factor (deposit-ccy per price-unit per lot), recovered from the broker's own pushed profit. Preferred over the spec for live P&L so non-USD accounts (e.g. THB) recompute in the right currency.
  const specsFetching = useRef<Set<string>>(new Set()); // keys with a symbolSpec fetch in flight (so a failure isn't cached as a permanent null, and we never double-fetch)
  const chartPaneRef = useRef<ChartPaneHandle>(null); // the active chart pane (for chart markers)

  const log = useCallback((m: string) => {
    setJournal((p) => [`${new Date().toLocaleTimeString()}  ${m}`, ...p].slice(0, 300));
  }, []);

  const markConnecting = useCallback((id: string, on: boolean) => {
    setConnecting((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  }, []);

  // For live P&L: make sure the symbol's spec is cached + its ticks subscribed. The spec is cached
  // ONLY on a SUCCESSFUL fetch (a spec, or null when the broker genuinely has none) — a transient
  // failure (a 401 before the account warms, a connect race) is left UNCACHED so a later call
  // retries. Caching the failure was the bug: the old null-sentinel + `key in` guard froze live P&L
  // on that symbol forever. In-flight is tracked separately so we never double-fetch.
  const ensurePositionSymbol = useCallback((accountId: string, symbol: string) => {
    const key = `${accountId}:${symbol}`;
    if (!(key in specs.current) && !specsFetching.current.has(key)) {
      specsFetching.current.add(key);
      void api.symbolSpec(accountId, symbol)
        .then((s) => {
          specs.current[key] = s ?? null;   // resolved → cache (a spec, or null = genuinely none)
          // A successful-but-null fetch also happens when the HOST doesn't expose /symbol-specs (a
          // 404 the adapter maps to null) — that silently froze profit at the broker's last value
          // twice (the backend missing the route). Warn once so a missing route surfaces instead of hiding.
          if (s == null) console.warn(`[live P&L] no symbol spec for ${key} — profit falls back to the broker's last value (if unexpected, verify the host exposes /symbol-specs)`);
        })
        .catch(() => { /* transient → leave uncached so a later ensure retries */ })
        .finally(() => { specsFetching.current.delete(key); });
    }
    void api.watch(accountId, [symbol]); // ticks must flow even if it's not in the Market Watch
  }, []);

  // Retry symbolSpec for every OPEN-position symbol whose spec hasn't resolved yet — covers a
  // connect-time fetch that 401'd before the account warmed (now uncached → retryable) AND a
  // SUBSCRIBE ticks + fetch the spec for EVERY open-position symbol — NOT just charted/watched ones.
  // The headline live-P&L fix: a position on a symbol the user never charts (loaded via a positions
  // REFRESH, which replaces the array without re-subscribing) gets no tick subscription → currentPrice
  // frozen (no ticks) AND no spec → profit frozen. So whenever the set of open positions changes,
  // ensurePositionSymbol (api.watch — idempotent — + spec fetch) runs for all of them. Keyed on the
  // STABLE set of (account,symbol) pairs (NOT `connected`, which changes every tick with live P&L), so
  // it doesn't churn per tick; the spec fetch is then retried on a 3s poll while any is unresolved
  // (a connect-time fetch can 401 before the account warms), stopping once all resolve.
  const positionSpecKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const acc of Object.values(connected)) for (const p of acc.positions) keys.add(`${acc.id}:${p.symbol}`);
    return Array.from(keys).sort().join('\n');
  }, [connected]);
  useEffect(() => {
    if (!positionSpecKeys) return;
    const allKeys = positionSpecKeys.split('\n');
    const ensureAll = () => allKeys.forEach((k) => { const i = k.indexOf(':'); ensurePositionSymbol(k.slice(0, i), k.slice(i + 1)); });
    ensureAll(); // subscribe + spec-fetch every open-position symbol (restores ticks → currentPrice, and profit)
    const specUnresolved = () => allKeys.some((k) => !(k in specs.current) && !specsFetching.current.has(k));
    if (!specUnresolved()) return;
    const id = setInterval(() => { if (!specUnresolved()) clearInterval(id); else ensureAll(); }, 3000);
    return () => clearInterval(id);
  }, [positionSpecKeys, ensurePositionSymbol]);

  // Trade open/close cues + the price-alerts engine — both gated by the live settings
  // (the engine subscribes the shared tickBus; the hook listens on the position stream).
  useTradeSounds();
  useEffect(() => { startAlertsEngine(); void initAlertsSync(api.serverAlerts); }, []);

  // ── Boot: roster + the live stream listeners (once) ──────────
  useEffect(() => {
    void api.listAccounts().then(setAccounts).catch((e) => log(`couldn't list accounts: ${humanizeError(e)}`));

    // One broker tick subscription, fanned out by the bus: the rolling per-symbol
    // tick buffer + the forming bar now live in tickBus + each ChartPane. Here we keep
    // only the GLOBAL price-only consumers — Market Watch quotes + live P&L — which use
    // the bid for every tick (the future-tick guard that gates the chart pipeline lives
    // in the bus).
    tickBus.start();
    tickBus.onAny((q: Quote) => {
      setQuotes((prev) => {
        const acc = prev[q.accountId] ?? {};
        const old = acc[q.symbol] as QuoteVal | undefined;
        const dir: QuoteVal['dir'] = old ? (q.bid > old.bid ? 'up' : q.bid < old.bid ? 'down' : old.dir) : 'flat';
        return { ...prev, [q.accountId]: { ...acc, [q.symbol]: { bid: q.bid, ask: q.ask, time: q.time, dir } } };
      });

      // Live floating P&L — the official client recomputes per tick (no broker
      // push per tick). profit = (deltaPrice / point) × tickValue × volume.
      const facKey = `${q.accountId}:${q.symbol}`;
      setConnected((prev) => {
        const acc = prev[q.accountId];
        if (!acc || acc.positions.length === 0) return prev;
        let changed = false;
        const positions = acc.positions.map((p) => {
          if (p.symbol !== q.symbol) return p;
          // Bootstrap the account-currency factor from the TickerAll API's OWN profit anchor. the TickerAll API serves the
          // deposit-currency profit on every positions() fetch; onPosition pushes only fire on trade
          // EVENTS, so a quietly-held position never gets a push — deriving only on push left the
          // factor null and the row recomputed in the wrong (profit) currency. Derive it here from the
          // position's the TickerAll API-provided (profit, prices) the first tick after any the TickerAll API update; stable
          // thereafter (FX × contractSize). currentPrice tracks every tick regardless.
          if (pnlFactors.current[facKey] == null) {
            const k = deriveAccountPnlFactor(p);
            if (k != null) pnlFactors.current[facKey] = k;
          }
          const next = recomputePositionPnl(p, q.bid, q.ask, pnlFactors.current[facKey]);
          if (next !== p) changed = true;
          return next;
        });
        return changed ? { ...prev, [q.accountId]: { ...acc, positions } } : prev;
      });
    });

    api.onPosition((p: PositionPush) => {
      setConnected((prev) => {
        const acc = prev[p.accountId];
        if (!acc) return prev;
        let positions = acc.positions;
        if (p.event === 'position-closed') positions = positions.filter((x) => x.ticket !== p.position.ticket);
        else {
          const i = positions.findIndex((x) => x.ticket === p.position.ticket);
          positions = i >= 0 ? positions.map((x) => (x.ticket === p.position.ticket ? p.position : x)) : [...positions, p.position];
        }
        return { ...prev, [p.accountId]: { ...acc, positions } };
      });
      if (p.event !== 'position-closed') {
        // Recover the account-currency P&L factor from the broker's authoritative profit so the
        // per-tick recompute stays in the deposit currency (no cross-rate needed). Keep the last
        // good factor when this push can't derive one (position not yet moved).
        const k = deriveAccountPnlFactor(p.position);
        if (k != null) pnlFactors.current[`${p.accountId}:${p.position.symbol}`] = k;
        ensurePositionSymbol(p.accountId, p.position.symbol);
      }
      else {
        // The closed position just left `positions`, so its OPEN entry arrow is gone — now
        // surface it as a CLOSED trade so the chart shows the entry + opposite-direction EXIT
        // arrows. historyBySymbol only re-fetches on a symbol/account change, so refresh THIS
        // symbol now (and once more shortly — the broker can log the close deal a beat after
        // the position-closed event). Without this, the marker just vanishes on close.
        const accId = p.accountId, sym = p.position.symbol;
        const pullClosed = () => void api.history(accId, sym, 300)
          .then((h) => setHistoryBySymbol((prev) => ({ ...prev, [sym]: h })))
          .catch(() => {});
        pullClosed();
        setTimeout(pullClosed, 1500);
      }
      if (p.event !== 'position-updated') log(`${p.event.replace('position-', 'position ')}: ${p.position.side} ${p.position.volume} ${p.position.symbol}`);
    });

    // Live resting pending orders — the server pushes the FULL book (a snapshot, not
    // a delta) on subscribe and on every change, so replace the list wholesale. The
    // subscription piggybacks on the same stream as positions. `pending` is the ACTIVE
    // account's book (flat state), so apply only updates for the account in view
    // (liveUi tracks the active id). Optional on desktop → a safe no-op there.
    api.onOrders?.((o: OrdersPush) => {
      if (o.accountId === liveUi.current.id) setPending(o.orders);
    });

    api.onAccount((a: AccountPush) => {
      setConnected((prev) => {
        const acc = prev[a.accountId];
        if (!acc || !acc.info) return prev;
        return { ...prev, [a.accountId]: { ...acc, info: { ...acc.info, balance: a.balance } } };
      });
    });

    api.onLog((m: string) => log(m));

    // Stream reconnect → REST-resync open positions. Position pushes are DELTAS, so a
    // close that arrived while the socket was down is lost → the position lingers as a
    // phantom "open" (chart draws it with no close marker; History shows it closed).
    // getOpenPositions is authoritative, so replacing each account's positions from
    // REST reconciles the phantoms away. Also refresh the active symbol's history so
    // any close that happened during the drop gets its exit marker. Reads the current
    // account list via connectedRef (this effect runs once).
    api.onStreamState?.((st) => setStreamDown(st === 'reconnecting'));
    api.onStreamReconnect?.(() => {
      const ids = Object.keys(connectedRef.current);
      if (ids.length) log(`stream reconnected — resyncing ${ids.length} account(s)`);
      for (const id of ids) {
        void api.positions(id)
          .then((positions) => setConnected((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id]!, positions } } : prev)))
          .catch(() => {});
      }
      const { id, sym } = liveUi.current;
      if (id && sym) void api.history(id, sym, 300)
        .then((h) => setHistoryBySymbol((prev) => ({ ...prev, [sym]: h })))
        .catch(() => {});
    });
  }, [log]);

  // The active chart is driven by props — these just set state; the ChartPane reloads
  // when its (account, symbol, timeframe) changes.
  const selectSymbol = (symbol: string) => {
    if (!activeId) return;
    setActiveSymbol(symbol);
  };

  const changeTimeframe = (tf: number) => {
    setTimeframe(tf);
  };

  // ── Account connection ─────────────────────────────────────────────────────
  const addConnected = (res: ConnectResult, makeActive = true) => {
    const acct: ConnAcct = {
      id: res.accountId, label: res.label, broker: res.broker, isDemo: res.isDemo,
      info: res.info, symbols: res.symbols, watch: res.watch, positions: res.positions,
    };
    // Restore this account's saved Market Watch once per session (Item 2): on reconnect the
    // broker re-sends only the DEFAULT watch, so user-added symbols would vanish on reload.
    // Re-apply the saved set (valid symbols only) + re-subscribe its ticks.
    const savedWatch = savedWs.current?.watchlists?.[res.accountId];
    if (savedWatch && savedWatch.length && !restoredWatch.current.has(res.accountId)) {
      const valid = savedWatch.filter((s) => res.symbols.includes(s));
      if (valid.length) { acct.watch = valid; void api.watch(res.accountId, valid); }
    }
    restoredWatch.current.add(res.accountId);
    setConnected((prev) => ({ ...prev, [res.accountId]: acct }));
    seedTradeSounds(res.accountId, res.positions); // existing trades don't chime on connect ()
    res.positions.forEach((p) => ensurePositionSymbol(res.accountId, p.symbol)); // live P&L
    if (makeActive) {
      setActiveId(res.accountId);
      const first = res.watch[0] ?? res.symbols[0] ?? null;
      if (first) setActiveSymbol(first);
      void api.history(res.accountId, undefined, 100).then(setHistory).catch(() => {});
    }
    void api.listAccounts().then(setAccounts).catch(() => {}); // reflect new/remembered state
    log(`connected ${res.label}`);
  };

  const onConnect = async (a: BrokerAccount): Promise<'ok' | 'needs-password' | 'error'> => {
    markConnecting(a.id, true);
    try {
      const res = await api.connectAccount(a.id);
      if ('needsPassword' in res) return 'needs-password';
      addConnected(res);
      return 'ok';
    } catch (e) {
      log(`connect failed: ${humanizeError(e)}`);
      return 'error';
    } finally { markConnecting(a.id, false); }
  };

  // Cold roster account → password-only re-warm (the TickerAll API holds the number).
  const onReconnect = async (accountId: string, password: string, remember: boolean): Promise<boolean> => {
    markConnecting(accountId, true);
    try {
      addConnected(await api.reconnectAccount(accountId, password, remember));
      return true;
    } catch (e) {
      log(`reconnect failed: ${humanizeError(e)}`);
      return false;
    } finally { markConnecting(accountId, false); }
  };

  // Add a brand-new account (not on the roster) with full broker credentials.
  const onConnectCreds = async (cfg: ConnectConfig): Promise<boolean> => {
    try {
      addConnected(await api.connectWithCreds(cfg));
      return true;
    } catch (e) {
      log(`connect failed: ${humanizeError(e)}`);
      return false;
    }
  };

  const setActive = (id: string) => {
    setActiveId(id);
    const acc = connected[id];
    if (!acc) return;
    // Per-account workspace (#19): restore THIS account's OWN last-active chart — the
    // symbol/TF it was on when you last left it (persisted per account in ta.acctWs), NOT
    // account A's symbol carried into B, nor a reset to B's first tab. The old heuristic
    // matched the OUTGOING symbol against B's tabs, so on desktop (many tabs/account) it
    // always landed on B's first tab — this is the bug that made it feel like desktop never
    // remembered per account (invisible on mobile, where each account has one tab).
    const accTabs = tabs.filter((t) => t.accountId === id);
    const slot = acctWs.current[id];
    const adopt = pickAccountTab(accTabs, slot?.sym, activeSymbol);
    if (adopt) {
      setActiveTabId(adopt.id);
      setActiveSymbol(adopt.symbol);
      setTimeframe(slot?.tf ?? adopt.timeframe);
    } else {
      // Brand-new account with no tabs yet: CLEAR the active-tab pointer so it never lingers on
      // the OUTGOING account's tab (which the mirror effect would otherwise reassign into this
      // account, stealing that chart). Pick a default symbol; the bootstrap effect opens this
      // account's first slot. Restore its last TF if we have one.
      setActiveTabId(null);
      setActiveSymbol(acc.watch[0] ?? acc.symbols[0] ?? null);
      if (slot?.tf != null) setTimeframe(slot.tf);
    }
  };

  const disconnect = (id: string) => {
    void api.disconnectAccount(id);
    resetTradeSounds(id);
    setConnected((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setTabs((prev) => prev.filter((t) => t.accountId !== id)); // drop the account's chart tabs
    if (activeId === id) {
      const rest = Object.keys(connected).filter((x) => x !== id);
      const next = rest[0] ?? null;
      setActiveId(next);
      setActiveSymbol(null);
      if (next) setActive(next); // no next → activeSymbol stays null → ChartPane clears
    }
    void api.listAccounts().then(setAccounts).catch(() => {});
    log(`disconnected ${connected[id]?.label ?? id}`);
  };

  const forget = (id: string) => { void api.forgetAccount(id); void api.listAccounts().then(setAccounts).catch(() => {}); };

  // Permanently remove an account from the roster (connected OR cold). Only mutate the
  // local UI once the remove SUCCEEDS, so a failed remove leaves the account in place.
  // If the removed account was active/connected, drop its tabs + switch away (like disconnect).
  const removeAccount = (id: string) => {
    const label = connected[id]?.label ?? accounts.find((a) => a.id === id)?.server ?? id;
    void api.removeAccount(id)
      .then(() => {
        resetTradeSounds(id);
        setConnected((prev) => { const n = { ...prev }; delete n[id]; return n; });
        setTabs((prev) => prev.filter((t) => t.accountId !== id));
        if (activeId === id) {
          const next = Object.keys(connected).filter((x) => x !== id)[0] ?? null;
          setActiveId(next);
          setActiveSymbol(null);
          if (next) setActive(next); // no next → activeSymbol stays null → ChartPane clears
        }
        void api.listAccounts().then(setAccounts).catch(() => {});
        log(`removed ${label}`);
      })
      .catch((e) => log(`couldn't remove ${label}: ${humanizeError(e)}`));
  };

  const reloadChart = () => {
    setShowSettings(false);
    setReloadKey((k) => k + 1); // force the ChartPane to reload the same chart
  };

  // ── Market Watch add/remove ────────────────────────────────────────────────
  const addWatch = (symbol: string) => {
    if (!activeId) return;
    setConnected((prev) => {
      const acc = prev[activeId]; if (!acc || acc.watch.includes(symbol)) return prev;
      return { ...prev, [activeId]: { ...acc, watch: [...acc.watch, symbol] } };
    });
    void api.watch(activeId, [symbol]);
  };
  const removeWatch = (symbol: string) => {
    if (!activeId) return;
    setConnected((prev) => {
      const acc = prev[activeId]; if (!acc) return prev;
      return { ...prev, [activeId]: { ...acc, watch: acc.watch.filter((s) => s !== symbol) } };
    });
    void api.unwatch(activeId, [symbol]);
  };

  // ── Trading ────────────────────────────────────────────────────────────────
  const refreshPositions = (id: string) => {
    void api.positions(id).then((positions) => setConnected((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id]!, positions } } : prev))).catch(() => {});
  };
  const refreshPending = (id: string) => { void api.listPendingOrders?.(id)?.then(setPending).catch(() => {}); };

  const placeOrder = async (req: { symbol: string; side: 'BUY' | 'SELL'; volume: number; type?: 'market' | 'limit' | 'stop'; price?: number; stopLoss?: number; takeProfit?: number; comment?: string }) => {
    if (!tradingEnabled || !activeId) return;
    const type = req.type ?? 'market';
    // Audit what we SEND (side + type), so a "Sell opened a Buy" report is decisive: the
    // journal shows the exact side/type sent vs. the side the broker reports back below. If
    // they differ, the swap is server-side (the request leaves here correct), not the UI.
    log(`order → ${type} ${req.side} ${req.volume} ${req.symbol}${req.price != null ? ` @ ${req.price}` : ''}`);
    setOrderBusy(true);
    const r = await api.placeOrder({
      accountId: activeId, type, symbol: req.symbol, side: req.side, volume: req.volume,
      price: req.price, stopLoss: req.stopLoss, takeProfit: req.takeProfit, comment: req.comment,
    });
    // r.message echoes the side we SENT (the TickerAll API's order ack echoes the request side), so it
    // is NOT broker ground truth — see the readback line below for the side actually held.
    log(r.ok ? `order ack — ${r.message}` : `order rejected — ${r.message}`);
    setOrderBusy(false);
    if (r.ok) {
      setOrderFor(null);
      // A placed LIMIT/STOP is a PENDING order, not a position — refresh the pending
      // list too (a market order leaves it unchanged; cheap + mirrors cancel/modify).
      // The live orders channel also updates it, but this is instant + covers the
      // (rare) case where the account isn't streaming yet.
      refreshPending(activeId);
      // Read the broker's view of the just-placed position so the journal shows, adjacently:
      //   order → market SELL …        (what we send — verbatim to the broker)
      //   position readback … : SELL   (the side actually held)
      // Same side = correct. Different = the SDK's side decode/execution (NOT the terminal —
      // its display is verbatim everywhere). Broker ground truth (MT5 app) then tells a real
      // execution flip from a readback-decode bug. Symbol-matched (netting = one per symbol),
      // since a market order's result ticket can differ from the position ticket.
      void api.positions(activeId).then((positions) => {
        setConnected((prev) => (prev[activeId] ? { ...prev, [activeId]: { ...prev[activeId]!, positions } } : prev));
        const pos = positions.find((p) => p.symbol === req.symbol);
        if (pos) log(`position readback (${pos.symbol}): ${pos.side} ${pos.volume}`);
      }).catch(() => {});
    }
  };

  const closePosition = async (ticket: number) => {
    if (!tradingEnabled || !activeId) return;
    const r = await api.closePosition(activeId, ticket);
    log(r.ok ? r.message : `close failed — ${r.message}`);
    if (r.ok) { refreshPositions(activeId); void api.history(activeId, undefined, 100).then(setHistory).catch(() => {}); }
  };

  // Modify a position's S/L · T/P, or a pending order's trigger price · S/L · T/P. The
  // ModifyDialog is the confirm step (no silent one-tap modify — real-money rule).
  const submitModify = async (vals: { price?: number; stopLoss: number; takeProfit: number }) => {
    if (!tradingEnabled || !activeId || !modifyTarget) return;
    setModifyBusy(true);
    const r = modifyTarget.kind === 'position'
      ? await api.modifyPosition(activeId, modifyTarget.position.ticket, vals.stopLoss, vals.takeProfit)
      : (await api.modifyPendingOrder?.(activeId, Number(modifyTarget.order.ticket), vals.price, vals.stopLoss, vals.takeProfit)
          ?? { ok: false, message: 'Modify isn’t available here.' });
    log(r.ok ? r.message : `modify failed — ${r.message}`);
    setModifyBusy(false);
    if (r.ok) {
      if (modifyTarget.kind === 'position') refreshPositions(activeId); else refreshPending(activeId);
      setModifyTarget(null);
    }
  };

  const cancelPending = async (ticket: string) => {
    if (!tradingEnabled || !activeId) return;
    const r = (await api.cancelPendingOrder?.(activeId, Number(ticket))) ?? { ok: false, message: 'Cancel isn’t available here.' };
    log(r.ok ? r.message : `cancel failed — ${r.message}`);
    if (r.ok) refreshPending(activeId);
  };

  // Re-open every account the user had connected last session — hot ones attach
  // with no prompt, password-saved cold ones re-warm automatically. So the
  // workspace comes back as you left it, no reconnecting one-by-one.
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoDone.current || accounts.length === 0) return;
    autoDone.current = true;
    void (async () => {
      try {
        // #1c: a WEB host can inject `platform.activeAccountId` — the account it wants active on
        // load (e.g. /studio opened for one account). It LEADS the boot connect and is made the
        // active account; HOT → connects with no password, cooled → the reconnect prompt. Only
        // honoured when it's actually on the roster. Desktop / no-injection → undefined.
        const hostActive =
          getPlatformKind() === 'web' ? getActiveAccountId() : undefined;
        const hostActiveOnRoster = hostActive && accounts.some((a) => a.id === hostActive) ? hostActive : undefined;
        const ids = await api.previouslyConnected().catch(() => [] as string[]);
        // hostActive first (deduped), then the previously-connected set — roster ids only.
        const want = [...new Set([hostActiveOnRoster, ...ids].filter((id): id is string => !!id))]
          .filter((id) => accounts.some((a) => a.id === id));
        if (want.length === 0) return;
        log(`re-opening ${want.length} account${want.length > 1 ? 's' : ''} from last session…`);
        want.forEach((id) => markConnecting(id, true));
        // Connect concurrently, but surface EACH account the moment IT resolves —
        // a hot account (≈27ms) must not wait on a cold one's ~6s broker re-warm.
        // With a host-injected active account, THAT one becomes active (not merely the
        // first to resolve); otherwise keep the first-hot-wins behaviour.
        let first = true;
        await Promise.all(want.map((id) =>
          api.connectAccount(id)
            .then((res) => {
              if ('needsPassword' in res) {
                log(`${accounts.find((a) => a.id === id)?.server ?? id} needs its password — click to reconnect`);
                // Cooled host-active account → surface the accounts panel so its reconnect
                // prompt is right there (the Navigator shows the password field per account).
                if (id === hostActiveOnRoster) openConnect();
              } else {
                const makeActive = id === hostActiveOnRoster || (first && !hostActiveOnRoster);
                addConnected(res, makeActive);
                if (!hostActiveOnRoster) first = false;
              }
            })
            .catch(() => { /* offline / stale — the user can reconnect it manually */ })
            .finally(() => markConnecting(id, false))));
      } finally {
        setBootDone(true); // boot reconnect attempted → the workspace restore can stop waiting
      }
    })();
    // addConnected/log are stable enough for a once-only run guarded by autoDone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  // Backstop: even with no roster (autoDone never runs) or a hung reconnect, let the
  // restore give up + persistence begin after a generous window (past a cold re-warm).
  useEffect(() => { const t = setTimeout(() => setBootDone(true), 9000); return () => clearTimeout(t); }, []);

  // History tab refresh when opened (closed positions + orders; orders is optional —
  // absent on impls that don't serve it, leaving the Orders tab's "not available" note).
  useEffect(() => {
    if (toolboxTab === 'history' && activeId) {
      void api.history(activeId, undefined, 100).then(setHistory).catch(() => {});
      void api.ordersHistory?.(activeId, undefined, 100).then(setOrders).catch(() => {});
      void api.dealsHistory?.(activeId, undefined, 100).then(setDeals).catch(() => {});
    }
    // Resting pending orders for the Trade view's Orders section (refreshed on open;
    // re-fetched after a modify/cancel). The optional-chain leaves it empty on impls
    // that don't serve pending orders, hiding the section.
    if (toolboxTab === 'trade' && activeId) {
      // Backfill open positions on Trade-tab open: a live position-opened push can be
      // missed during a stream hiccup (no full reconnect), so reconcile against the
      // authoritative REST list whenever the tab is shown — mirrors refreshPositions.
      void api.positions(activeId).then((positions) => setConnected((prev) => (prev[activeId] ? { ...prev, [activeId]: { ...prev[activeId]!, positions } } : prev))).catch(() => {});
      void api.listPendingOrders?.(activeId).then(setPending).catch(() => {});
    }
  }, [toolboxTab, activeId]);

  // Drag the chart↕toolbox divider (taller Trade/History/Journal panel).
  const startToolboxDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const h = window.innerHeight - ev.clientY;
      setToolboxH(Math.min(window.innerHeight - 220, Math.max(120, h)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'row-resize';
  };

  // ── Chart tabs (multi-symbol; explicit chart SLOTS) ───────────────────────
  // Each tab is a chart slot with a STABLE id. The ACTIVE slot (`activeTabId`) mirrors
  // the live (account, symbol, timeframe) — so picking a symbol in Market Watch REPLACES
  // the active chart in place; the "+" opens a NEW slot. One ChartPane per slot; the
  // load-bearing chart pipeline is untouched.
  const newTabId = () => `tab${tabSeq.current++}`;

  // The chart tabs belonging to the ACTIVE account — the strip / mosaic show only these, so
  // account A and account B have independent chart tabs/symbols/pins (#19). `tabs` itself stays
  // the full multi-account list (persisted, each carrying accountId); this just display-filters.
  const accountTabs = tabs.filter((t) => t.accountId === activeId);

  // Mirror a symbol/TF change on the active chart into its own tab — never reassigning a tab
  // across accounts (mirrorActiveTab guards on accountId; see its doc for the per-account
  // chart-loss bug this prevents). Returns the same array when unchanged → setTabs bails out.
  useEffect(() => {
    setTabs((prev) => mirrorActiveTab(prev, activeTabId, activeId, activeSymbol, timeframe));
  }, [activeId, activeSymbol, timeframe, activeTabId]);

  // Bootstrap the first slot for the ACTIVE ACCOUNT on connect; re-adopt one if the active
  // slot vanished or belongs to another account (after an account switch). Scoped to
  // accountTabs so each account keeps its own tabs (#19).
  useEffect(() => {
    if (!activeId || !activeSymbol) return;
    if (accountTabs.length === 0) {
      const id = newTabId();
      // Guard inside the updater so a stale-length re-run can never append a 2nd tab for the account.
      setTabs((prev) => prev.some((t) => t.accountId === activeId) ? prev : [...prev, { id, accountId: activeId, symbol: activeSymbol, timeframe, pinned: false }]);
      setActiveTabId(id);
    } else if (!activeTabId || !accountTabs.some((t) => t.id === activeTabId)) {
      setActiveTabId((accountTabs.find((t) => t.symbol === activeSymbol) ?? accountTabs[0]!).id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeSymbol, accountTabs.length, activeTabId]);

  // Restore the saved workspace (Item 5) ONCE: as soon as the saved active account re-warms
  // (so the chart returns to exactly where you left it), or — if it never reconnects — give
  // up once the boot reconnect is done. Tabs are rebuilt with fresh ids for whatever
  // accounts came back. Runs after addConnected may have activated the first-resolved
  // account, so it snaps the active context to the saved one.
  useEffect(() => {
    if (wsRestored.current) return;
    const ws = savedWs.current;
    if (!ws) { wsRestored.current = true; return; } // nothing saved → allow persistence
    // A deep-link is an EXPLICIT active-context intent expressed NOW (?acct=&symbol=&tf=);
    // the workspace is an IMPLICIT one from last time. The explicit one wins — so
    // when a deep-link is present, restore the tabs + watchlists but do NOT override the active
    // account / symbol / timeframe (those are set by the activeAccountId + bootChart boot effects).
    const hasBootIntent = getPlatformKind() === 'web' && (!!getActiveAccountId() || !!getActiveSymbol());
    const wantId = ws.activeAccountId;
    const haveActive = !!wantId && !!connected[wantId];
    if (!haveActive && !bootDone) return; // still reconnecting the saved active account — wait
    if (haveActive && !hasBootIntent) {
      const acc = connected[wantId!]!;
      setActiveId(wantId!);
      if (ws.activeSymbol && acc.symbols.includes(ws.activeSymbol)) setActiveSymbol(ws.activeSymbol);
      if (ws.timeframe) setTimeframe(ws.timeframe);
    }
    const restoredTabs = (ws.tabs ?? [])
      .filter((t) => connected[t.accountId])
      .map((t) => ({ id: newTabId(), accountId: t.accountId, symbol: t.symbol, timeframe: t.timeframe, pinned: !!t.pinned }));
    if (restoredTabs.length) {
      setTabs(restoredTabs);
      // Don't snap the active tab to a workspace chart under a deep-link — leave it to the deep-link's
      // own active context (a matching restored tab, if any, else the deep-link's fresh chart).
      if (!hasBootIntent) {
        const act = restoredTabs.find((t) => t.accountId === wantId && t.symbol === ws.activeSymbol) ?? restoredTabs[0]!;
        setActiveTabId(act.id);
      }
    }
    wsRestored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, bootDone]);

  // ── Deep-link: open a specific chart on boot (web) — ?acct=&symbol=&tf= ──────────
  // Sibling to activeAccountId: once the deep-linked account's roster resolves, chart the requested
  // symbol (+ optional tf) ONCE, when the symbol is on that roster. Replaces the host's
  // retry-until-roster poll of tickerall:set-active-chart with a single bundle-native apply — no
  // observing unobservable state. Applied once (never yanks the chart after the user navigates).
  const bootChartDone = useRef(false);
  useEffect(() => {
    if (bootChartDone.current) return;
    if (getPlatformKind() !== 'web' || !getActiveSymbol()) { bootChartDone.current = true; return; }
    const acc = activeId ? connected[activeId] : undefined;
    const roster = acc?.symbols ?? [];
    if (!acc || roster.length === 0) return; // wait for the account + its roster to load
    const cmd = resolveBootChart(getActiveSymbol(), getActiveTimeframe(), roster, tokenToTimeframe);
    bootChartDone.current = true;            // apply exactly once
    if (!cmd) return;                        // symbol not on the roster → leave the default chart
    setActiveSymbol(cmd.symbol);
    if (cmd.tf != null) setTimeframe(cmd.tf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, connected]);

  // ── Host runtime command: switch the active chart (a host strip click) ──────────
  // The host can own a strip of entries; clicking one switches the terminal's ACTIVE chart to that
  // entry's symbol+timeframe. Runtime (not boot) → a window CustomEvent, not platform.* config. A
  // STABLE listener reads the LATEST activeId/roster via a ref, so it never goes stale on ticks and
  // never re-binds per tick. v1: switch on the current active account; optional detail.accountId
  // switches the active account first. The symbol must be on that account's roster (else no-op —
  // we never chart a symbol the account can't stream). Inert on desktop (no host dispatches it).
  const chartCmdRef = useRef<{ activeId: string | null; connected: Record<string, ConnAcct> }>({ activeId, connected });
  chartCmdRef.current = { activeId, connected };
  useEffect(() => {
    const onSetActiveChart = (e: Event): void => {
      const { activeId: aId, connected: conn } = chartCmdRef.current;
      const cmd = resolveSetActiveChart((e as CustomEvent).detail ?? {}, {
        activeId: aId,
        rosters: Object.fromEntries(Object.values(conn).map((a) => [a.id, a.symbols])),
        tokenToTimeframe,
      });
      if (!cmd) return;                                      // malformed / blank / off-roster / no account → no-op
      if (cmd.accountId !== aId) setActiveId(cmd.accountId);
      setActiveSymbol(cmd.symbol);
      if (cmd.tf != null) setTimeframe(cmd.tf);              // unknown TF token → keep the current timeframe
    };
    window.addEventListener('tickerall:set-active-chart', onSetActiveChart);
    return () => window.removeEventListener('tickerall:set-active-chart', onSetActiveChart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A stable signature of every account's Market Watch — changes only when a watchlist
  // actually changes, NOT on the ticks/P&L that also mutate `connected` every frame. Used
  // as the persist trigger so we don't write localStorage on every tick.
  const watchSig = Object.values(connected).map((a) => `${a.id}:${a.watch.join(',')}`).sort().join('|');

  // ── Per-view URL routing (hash) ──────────────────────────────────────────────
  // Each primary view maps to a hash route so a refresh / bookmark / Back-Forward /
  // relaunch returns to the same view. The route is DERIVED from the view state; applying
  // a route sets that state. Works on web (refresh-safe) + desktop (Electron) identically.
  const route = showSettings ? 'settings'
    : isMobile ? (mobileAccountOpen ? 'account' : mobileSheet ? mobileSheet : (mobileView === 'chart' ? 'charts' : mobileView))
    : toolboxTab;

  const applyRoute = (r: string) => {
    setShowSettings(r === 'settings');
    if (isMobile) {
      setMobileAccountOpen(r === 'account');
      if (r === 'journal' || r === 'alerts') { setMobileSheet(r); setToolboxTab(r); }
      else setMobileSheet(null);
      if (r === 'quotes' || r === 'trade' || r === 'history') { setMobileView(r); if (r === 'trade') setToolboxTab('trade'); else if (r === 'history') setToolboxTab('history'); }
      else if (r === 'charts') setMobileView('chart');
    } else if (r === 'trade' || r === 'history' || r === 'journal' || r === 'alerts') {
      setToolboxTab(r);
    }
  };

  // Deep link / home-screen shortcut (web only, once at mount): /terminal?view=charts|quotes|
  // trade|history|journal|alerts|settings|account opens straight on that view — the manifest's
  // app shortcuts and notification taps use it. Unknown values are ignored.
  useEffect(() => {
    if (getPlatformKind() !== 'web' || typeof window === 'undefined') return;
    const v = new URLSearchParams(window.location.search).get('view');
    if (!v) return;
    const route = v === 'chart' ? 'charts' : v;
    if (['charts', 'quotes', 'trade', 'history', 'journal', 'alerts', 'settings', 'account'].includes(route)) applyRoute(route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const applyRouteRef = useRef(applyRoute); applyRouteRef.current = applyRoute;
  const routeRef = useRef(route); routeRef.current = route;

  // Persist the workspace on any change — but only AFTER restore, so the transient empty
  // boot state never overwrites what we're about to restore. (Items 5 + 2 + routing.)
  useEffect(() => {
    if (!wsRestored.current) return;
    writeWorkspace({
      activeAccountId: activeId,
      activeSymbol,
      timeframe,
      tabs: tabs.map((t) => ({ accountId: t.accountId, symbol: t.symbol, timeframe: t.timeframe, pinned: t.pinned })),
      watchlists: Object.fromEntries(Object.values(connected).map((a) => [a.id, a.watch])),
      route,
    });
    // `connected` is read for the watchlists but intentionally NOT a dep — watchSig captures
    // the watch-relevant part, so we persist watch changes without writing on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeSymbol, timeframe, tabs, watchSig, route]);

  // Per-account layout + sidebar + symbol/TF focus (#19 part B). On an account CHANGE: save the
  // OUTGOING account's layout/sidebar/sym/tf (from the ref, which still holds the previous account's
  // live values), then LOAD the incoming account's layout/sidebar (or sane defaults for a brand-new
  // one); its symbol/TF are restored synchronously in setActive from this same slot. While on the
  // SAME account: keep its slot current as the user changes layout/sidebar/symbol/TF. The ref
  // re-points each run, so the one-render lag after a load self-corrects. Separate from ta.workspace.
  useEffect(() => {
    const prev = liveUi.current;
    if (activeId && prev.id !== activeId) {
      // save outgoing — layout + sidebar + its last-active symbol/TF (from the ref, which
      // still holds the previous account's live values).
      if (prev.id) acctWs.current[prev.id] = { layout: prev.layout, leftCollapsed: prev.leftCollapsed, sym: prev.sym, tf: prev.tf };
      const slot = acctWs.current[activeId]; // load incoming layout/sidebar (symbol/TF are restored in setActive)
      setChartLayout(slot?.layout ?? 'single');
      setLeftCollapsed(slot?.leftCollapsed ?? false);
      try { localStorage.setItem(ACCT_WS_KEY, JSON.stringify(acctWs.current)); } catch { /* non-fatal */ }
    } else if (activeId && prev.id === activeId) {
      acctWs.current[activeId] = { layout: chartLayout, leftCollapsed, sym: activeSymbol, tf: timeframe }; // keep current
      try { localStorage.setItem(ACCT_WS_KEY, JSON.stringify(acctWs.current)); } catch { /* non-fatal */ }
    }
    liveUi.current = { id: activeId, layout: chartLayout, leftCollapsed, sym: activeSymbol, tf: timeframe };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, chartLayout, leftCollapsed, activeSymbol, timeframe]);

  // Reflect the current view in location.hash (a genuine navigation = a new history entry,
  // so Back/Forward steps through views). The hashchange handler below restores state. The
  // FIRST run is skipped so the initial deep-link (#trade) isn't clobbered by the default
  // route before the restore effect (below) gets to read + apply it.
  const firstHashSync = useRef(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (firstHashSync.current) { firstHashSync.current = false; return; }
    const h = `#${route}`;
    // window.history / window.location explicitly — `history` is shadowed by the closed-trade state.
    if (window.location.hash !== h) { try { window.history.pushState(null, '', h); } catch { /* ignore */ } }
  }, [route]);

  // hashchange (Back/Forward) → restore the view; + the initial route on mount (the hash
  // wins, else the persisted workspace route). Refs keep the listener current without churn.
  useEffect(() => {
    const apply = (r: string) => { if (ROUTE_HASHES.includes(r) && r !== routeRef.current) applyRouteRef.current(r); };
    const onHash = () => apply((window.location.hash || '').replace('#', ''));
    window.addEventListener('hashchange', onHash);
    const fromHash = (window.location.hash || '').replace('#', '');
    const wsRoute = savedWs.current?.route ?? '';
    // The hash (explicit navigation) wins; else the persisted workspace route — but NEVER auto-reopen
    // a full-screen MODAL SHEET route from the workspace (a phone could reboot trapped in it). An
    // explicit hash still opens such a route.
    const initial = ROUTE_HASHES.includes(fromHash) ? fromHash : (MODAL_SHEET_ROUTES.includes(wsRoute) ? '' : wsRoute);
    if (ROUTE_HASHES.includes(initial)) apply(initial);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activateTab = (t: ChartTab) => { setActiveTabId(t.id); setActiveId(t.accountId); setActiveSymbol(t.symbol); setTimeframe(t.timeframe); };
  const addChart = () => {
    if (!activeId || !activeSymbol) return;
    const id = newTabId();
    setTabs((prev) => [...prev, { id, accountId: activeId, symbol: activeSymbol, timeframe, pinned: false }]);
    setActiveTabId(id);
  };
  const closeTab = (t: ChartTab) => {
    if (t.id === maximizedTabId) setMaximizedTabId(null);
    const rest = tabs.filter((x) => x.id !== t.id);
    setTabs(rest);
    if (t.id === activeTabId) {
      // Adopt the next tab OF THE SAME ACCOUNT (don't jump to another account's chart). If none
      // remain for this account, clear — the bootstrap effect reopens a slot (#19).
      const next = rest.find((x) => x.accountId === t.accountId) ?? null;
      if (next) activateTab(next);
      else { setActiveTabId(null); setActiveSymbol(null); }
    }
  };
  const togglePin = (t: ChartTab) => setTabs((prev) => prev.map((x) => (x.id === t.id ? { ...x, pinned: !x.pinned } : x)));
  const reorderTab = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTabs((prev) => {
      const from = prev.findIndex((t) => t.id === fromId);
      const to = prev.findIndex((t) => t.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  };
  const toggleMax = (which: 'left' | 'chart' | 'toolbox') => setMaximized((m) => (m === which ? null : which));

  // Drag the Market Watch ↕ Accounts divider in the left sidebar.
  const startLeftSplit = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const rect = leftRef.current?.getBoundingClientRect();
      if (!rect || rect.height === 0) return;
      setLeftSplit(Math.min(0.85, Math.max(0.15, (ev.clientY - rect.top) / rect.height)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      setLeftSplit((v) => { localStorage.setItem('ta.leftSplit', String(v)); return v; });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'row-resize';
  };

  const connectedList = Object.values(connected);
  const activeAcct = activeId ? connected[activeId] ?? null : null;
  // Closed-history guard for the positions/Trade surfaces. If a `position-closed` push is missed
  // during a stream gap, the position lingers in acc.positions as a phantom (shows open with
  // live-recomputed P&L) until a reconnect resync — the chart overlay already self-heals via
  // closed history (see tradesFor), but the Trade tab, positions panel and floating-P&L total do
  // not. History is the source of truth: drop any open position whose ticket appears in the closed
  // history, so every Trade surface self-heals the same way, regardless of a missed push.
  const activeOpenPositions = useMemo(() => {
    if (!activeAcct) return [];
    if (history.length === 0) return activeAcct.positions;
    // Only FULLY-closed rows count — a partial-realisation row (partial:true) keeps
    // the position open with a remainder, so it must NOT drop the live position.
    const closed = new Set(history.filter((h) => !h.partial).map((h) => String(h.ticket)));
    return activeAcct.positions.filter((p) => !closed.has(String(p.ticket)));
  }, [activeAcct, history]);
  const activeAcctView = useMemo(
    () => (activeAcct ? { ...activeAcct, positions: activeOpenPositions } : null),
    [activeAcct, activeOpenPositions],
  );
  const activeQuotes = activeId ? quotes[activeId] ?? {} : {};
  const hasConnection = connectedList.length > 0;

  // Footer status-bar inputs (derived from the live state).
  const sbConnection: ConnectionSummary = {
    state: activeId && connected[activeId] ? 'warm' : (connecting.size > 0 ? 'connecting' : 'offline'),
    connecting: connecting.size,
    label: activeAcct?.label.split('·')[0]?.trim(),
  };
  const sbFloatingPnl = activeOpenPositions.reduce((s, p) => s + p.profit, 0);

  // Command palette (Cmd/Ctrl-K) — register the standard commands with live context.
  const themeNow = useTheme();
  useTerminalCommands(
    {
      newOrder: () => { if (activeSymbol) setOrderFor(activeSymbol); },
      changeTimeframe,
      openSettings: () => setShowSettings(true),
      reloadChart,
      switchAccount: setActive,
      setTheme: (id) => setSetting('appearance.theme', id),
    },
    {
      activeSymbol,
      timeframe,
      accounts: connectedList.map((a) => ({ id: a.id, label: a.label })),
      activeAccountId: activeId,
      themeId: themeNow.id,
    },
  );

  // Live trade context for the on-chart position/measure tools (Items 6/7): the active
  // charted symbol's spec (fetched + cached) + balance, exposed reactively. bid/ask are
  // intentionally omitted — the tools size from their own handles (no per-tick churn).
  useEffect(() => {
    if (!activeId || !activeSymbol) { setActiveSpec(null); return; }
    const key = `${activeId}:${activeSymbol}`;
    const cached = specs.current[key];
    if (cached) { setActiveSpec(cached); return; }
    let alive = true;
    void api.symbolSpec(activeId, activeSymbol)
      .then((s) => { specs.current[key] = s; if (alive) setActiveSpec(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, [activeId, activeSymbol]);

  const tradeCtx = useMemo(() => ({
    point: activeSpec?.point ?? undefined,
    tickValue: activeSpec?.tickValue ?? undefined,
    contractSize: activeSpec?.contractSize ?? undefined,
    balance: activeAcct?.info?.balance,
  }), [activeSpec, activeAcct?.info?.balance]);

  // Band volume helpers (Item 1: directly-editable lots) — clamp to the active symbol's
  // volumeMin / volumeStep so a typed OR stepped value is always a valid lot before send.
  const bandStep = activeSpec?.volumeStep || 0.01;
  const bandMin = activeSpec?.volumeMin || 0.01;
  const clampBandVol = (v: number) => {
    if (!Number.isFinite(v)) return bandMin;
    const dp = Math.max(2, (String(bandStep).split('.')[1] || '').length);
    return Number(Math.max(bandMin, Math.round(v / bandStep) * bandStep).toFixed(dp));
  };
  const stepBandVol = (dir: 1 | -1) => setBandVolume((v) => clampBandVol(v + dir * bandStep));
  const setBandVolumeManual = (v: number) => setBandVolume(clampBandVol(v));
  const bandOrder = (side: 'BUY' | 'SELL') => {
    if (!activeSymbol) return;
    const vol = clampBandVol(bandVolume);   // snap a typed value to a valid lot before send
    if (vol !== bandVolume) setBandVolume(vol);
    if (oneClickTrading) placeOrder({ symbol: activeSymbol, side, volume: vol, type: 'market' });
    else setBandConfirm(side);
  };

  const placePlannedTradeFor = (sym: string, plan: { side: 'long' | 'short'; entry: number; sl: number; tp: number; lots: number }) => {
    void placeOrder({ symbol: sym, side: plan.side === 'long' ? 'BUY' : 'SELL', volume: plan.lots, stopLoss: plan.sl, takeProfit: plan.tp });
  };

  // Closed trades for every charted symbol on the active account (the on-chart history
  // overlays — single chart OR grid). Fetched per unique open symbol + the active one;
  // re-runs only when that set changes.
  const chartSymbolsKey = tabs.filter((t) => t.accountId === activeId).map((t) => t.symbol).sort().join(',');
  useEffect(() => {
    if (!activeId) { setHistoryBySymbol({}); return; }
    const syms = Array.from(new Set([
      ...(activeSymbol ? [activeSymbol] : []),
      ...tabs.filter((t) => t.accountId === activeId).map((t) => t.symbol),
    ]));
    if (syms.length === 0) { setHistoryBySymbol({}); return; }
    let alive = true;
    void Promise.all(syms.map((sym) =>
      api.history(activeId, sym, 300).then((h) => [sym, h] as const).catch(() => [sym, [] as HistoryRow[]] as const),
    )).then((entries) => { if (alive) setHistoryBySymbol(Object.fromEntries(entries)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeSymbol, chartSymbolsKey]);

  // Build the on-chart trades for a (account, symbol): live open positions (arrow + line
  // to the live price + P&L) + closed history (entry→exit + dotted connector). Open
  // positions recompute per tick, so the on-chart P&L stays live.
  const tradesFor = useCallback((accId: string | null, sym: string | null): ChartTrade[] => {
    if (!accId || !sym) return [];
    const acc = connected[accId];
    // Canonicalise side to uppercase BUY/SELL at the render boundary — the chart's whole
    // arrow/colour contract keys off `=== 'BUY'`, so any stray-cased side ('buy') must never
    // flip an arrow. the TickerAll API is verified uppercase; this is a belt-and-braces guard.
    const normSide = (s: unknown): 'BUY' | 'SELL' => (String(s).toUpperCase() === 'SELL' ? 'SELL' : 'BUY');
    const closed: ChartTrade[] = (historyBySymbol[sym] ?? []).filter((h) => h.symbol === sym).map((h) => ({
      id: `c${h.ticket}`, source: 'real', side: normSide(h.side), open: false,
      openTime: tradeTimeSec(h.openTime), openPrice: h.openPrice,
      closeTime: tradeTimeSec(h.closeTime) ?? undefined, closePrice: h.closePrice,
      profit: h.profit ?? 0, volume: h.volume,
    }));
    // A ticket present in closed history is definitively CLOSED — never draw it as open.
    // If a `position-closed` push was missed during a stream drop, the position lingers in
    // `positions` as a phantom (entry marker, no exit — looks open on the chart while History
    // shows it closed). The stream-reconnect resync clears it from `positions`; this guard
    // makes the chart correct even in the interim, keyed off history as the source of truth.
    const closedTickets = new Set((historyBySymbol[sym] ?? []).filter((h) => !h.partial).map((h) => String(h.ticket)));
    const open: ChartTrade[] = (acc?.positions ?? []).filter((p) => p.symbol === sym && !closedTickets.has(String(p.ticket))).map((p) => ({
      id: `o${p.ticket}`, source: 'real', side: normSide(p.side), open: true,
      openTime: tradeTimeSec(p.openTime), openPrice: p.entryPrice,
      currentPrice: p.currentPrice, profit: p.profit, volume: p.volume,
    }));
    return [...closed, ...open];
  }, [connected, historyBySymbol]);

  // What the chart actually DRAWS. Both chart panes use this.
  const visibleTradesFor = (accId: string | null, sym: string | null): ChartTrade[] => tradesFor(accId, sym);

  // All distinct symbols with an OPEN position on an account — passed to the trade overlay
  // so an empty overlay can reveal a symbol-string mismatch (e.g. a position on "BTCUSDm"
  // while charting "BTCUSD") ON the chart, instead of silently showing nothing.
  const positionSymbolsFor = (accId: string | null): string[] =>
    accId ? Array.from(new Set((connected[accId]?.positions ?? []).map((p) => p.symbol))) : [];

  // Status/diagnostic: when the active chart's drawable trade set changes, note the counts in
  // the log. This makes it visible whether trades actually reach the overlay — "0 open + 0
  // closed" points at the data fetch (positions/history/symbol match); non-zero counts with
  // nothing drawn points at the render/projection. Only fires when a count changes (cheap).
  const activeChartTrades = activeId && activeSymbol ? tradesFor(activeId, activeSymbol) : [];
  const activeChartOpenN = activeChartTrades.filter((t) => t.open).length;
  // How many open trades carry a usable entry time — i.e. how many CAN have their arrow
  // placed at the entry candle (vs. the broker omitting openTime → no entry arrow, but the
  // dashed level + label + axis tag still show). Makes a "no arrow" report decisive.
  const activeChartOpenTimed = activeChartTrades.filter((t) => t.open && t.openTime != null).length;
  const activePosSyms = positionSymbolsFor(activeId);
  const activeChartSig = `${activeId}|${activeSymbol}|${activeChartTrades.length}|${activeChartOpenN}|${activeChartOpenTimed}|${activePosSyms.join(',')}`;
  useEffect(() => {
    if (!activeId || !activeSymbol) return;
    if (activeChartTrades.length === 0 && activePosSyms.length > 0 && !activePosSyms.includes(activeSymbol)) {
      // Nothing to draw for the charted symbol, but the account HAS open positions on other
      // symbols — dump them so a mismatch (e.g. BTCUSDm vs BTCUSD) is obvious in the journal.
      log(`chart ${activeSymbol}: 0 trades — but account holds open position(s) on [${activePosSyms.join(', ')}] → SYMBOL MISMATCH (charting "${activeSymbol}")`);
    } else {
      log(`chart ${activeSymbol}: ${activeChartOpenN} open (${activeChartOpenTimed} with entry time) + ${activeChartTrades.length - activeChartOpenN} closed trade(s) to draw`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChartSig]);

  // One chart cell for the grid (a standalone ChartPane driven by the tab). Only the
  // ACTIVE cell binds the chart ref + the live trade-context; every cell gets its own
  // symbol's trades + a new-order/place-order bound to ITS symbol.
  const renderPaneForTab = (t: ChartTab, active: boolean) => (
    <ChartPane
      ref={active ? chartPaneRef : undefined}
      accountId={t.accountId}
      symbol={t.symbol}
      timeframe={t.timeframe}
      reloadKey={reloadKey}
      hasConnection={hasConnection}
      onLog={log}
      trades={visibleTradesFor(t.accountId, t.symbol)}
      positionSymbols={positionSymbolsFor(t.accountId)}
      isMobile={isMobile}
      trade={active ? tradeCtx : undefined}
      onPlaceOrder={(plan) => placePlannedTradeFor(t.symbol, plan)}
      onNewOrder={() => setOrderFor(t.symbol)}
      onOpenSettings={() => setShowSettings(true)}
      onActiveToolChange={active ? setMobileDrawTool : undefined}
    />
  );

  // Drag-to-dock mosaic. The VISIBLE pane set is DECOUPLED from the tab strip: picking a
  // multi-chart layout no longer force-charts every open tab. Instead the mosaic starts with
  // just the active chart and the user GROWS it by dragging tabs onto a pane's edge — so you
  // can keep 4 symbols in the strip while viewing only 2 side by side.
  // Ids allowed to remain as panes: this account's open tabs. A pane whose id isn't here (tab
  // closed, or another account's) is pruned. It's a WHITELIST for pruning — NOT a list to create.
  const validPaneIds = new Set<string>(accountTabs.map((t) => t.id));
  const validPaneIdsKey = [...validPaneIds].sort().join(',');
  // Reseed the arrangement only on a deliberate reset — a preset change or an account switch —
  // keyed by this string; a mere tab open/close/click reconciles in place (keeps pane sizes).
  const seededFor = useRef('');
  useEffect(() => {
    if (chartLayout === 'single') return; // a lone chart uses the plain ChartPane path
    const seedKey = `${activeId ?? ''}|${chartLayout}`;
    setTree((prev) => {
      // A) preset/account entry → (re)build the arrangement, KEEPING whatever panes are already
      //    shown (rearranged into the new preset), else start from just the active chart.
      if (seededFor.current !== seedKey) {
        seededFor.current = seedKey;
        const keep = leaves(prev).filter((id) => validPaneIds.has(id));
        const seed = keep.length ? keep : (activeTabId ? [activeTabId] : []);
        return buildTree(seed, chartLayout) ?? prev;
      }
      // B) reconcile in place: drop panes for closed tabs, keep the ACTIVE chart visible
      //    (clicking a hidden tab brings it in). Never auto-adds any OTHER tab — extra charts
      //    are added by dragging.
      let t = pruneTree(prev, validPaneIds);
      if (activeTabId && validPaneIds.has(activeTabId) && !leaves(t).includes(activeTabId)) t = appendLeaf(t, activeTabId);
      return t;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, chartLayout, validPaneIdsKey, activeTabId]);

  // Use the mosaic when there's more than one pane to lay out (a multi-chart preset). A lone
  // chart keeps the clean single-ChartPane path (no cell-head).
  const useMosaic = chartLayout !== 'single' && accountTabs.length > 1;
  const showLeft = !maximized || maximized === 'left';
  const showChart = !maximized || maximized === 'chart';
  const showToolbox = !toolboxHidden && (!maximized || maximized === 'toolbox');
  const splitLeft = hasConnection && !!activeAcct; // Market Watch visible → show the split
  const gridStyle: React.CSSProperties = isMobile
    // MOBILE: single column, taller (52px) toolbar so toolbar controls clear the ≥44px
    // touch-target floor. The chart is ALWAYS the 'main' cell (kept mounted + autoSized);
    // non-chart views render as overlays ON TOP via .m-overlay, so the chart is never
    // resized to 0 (no LWC refit glitch). 'nav' = bottom tab bar. The status bar is hidden
    // on mobile (CSS) — it would render below the nav and clip; its info lives in the
    // chart / quotes / trade views.
    ? { gridTemplateColumns: '1fr', gridTemplateRows: '52px 1fr auto', gridTemplateAreas: '"toolbar" "main" "nav"' }
    : isTablet
      // TABLET: chart full-width (the left sidebar becomes an off-canvas drawer). The
      // toolbox stays as a collapsible bottom panel; status auto-flows the last row.
      ? (toolboxHidden
          ? { gridTemplateColumns: '1fr', gridTemplateRows: '42px 1fr 24px', gridTemplateAreas: '"toolbar" "chart"' }
          : { gridTemplateColumns: '1fr', gridTemplateRows: `42px 1fr ${toolboxH}px 24px`, gridTemplateAreas: '"toolbar" "chart" "toolbox"' })
    : maximized
      ? { gridTemplateColumns: '1fr', gridTemplateRows: '42px 1fr 24px', gridTemplateAreas: '"toolbar" "main"' }
      : leftCollapsed
        // Left sidebar collapsed (#10): drop the 272px column → the chart (+ toolbox) span full width.
        ? (toolboxHidden
            ? { gridTemplateColumns: '1fr', gridTemplateRows: '42px 1fr 24px', gridTemplateAreas: '"toolbar" "chart"' }
            : { gridTemplateColumns: '1fr', gridTemplateRows: `42px 1fr ${toolboxH}px 24px`, gridTemplateAreas: '"toolbar" "chart" "toolbox"' })
      : toolboxHidden
        ? { gridTemplateColumns: '272px 1fr', gridTemplateRows: '42px 1fr 24px', gridTemplateAreas: '"toolbar toolbar" "left chart"' }
        : { gridTemplateColumns: '272px 1fr', gridTemplateRows: `42px 1fr ${toolboxH}px 24px`, gridTemplateAreas: '"toolbar toolbar" "left chart" "left toolbox"' };

  // Mobile bottom-nav → which panel shows. Trade/History also preselect the toolbox tab
  // (the nav tab is a shortcut to the toolbox at that tab); More opens it on 'journal'.
  const selectMobileView = (v: MobileView) => {
    if (v === 'trade') setToolboxTab('trade');
    else if (v === 'history') setToolboxTab('history');
    if (v !== 'chart') setMobileTfOpen(false); // the TF strip belongs to the chart view
    setMobileView(v);
  };

  // ── Panels extracted so the SAME instance can be placed either in the desktop grid
  // or, on web mobile/tablet, in a drawer/overlay (only one renders at a time). ──
  const marketWatchEl = splitLeft && activeAcct ? (
    <MarketWatch
      accts={connectedList}
      activeId={activeId!}
      onSetActive={setActive}
      acct={activeAcct}
      quotes={activeQuotes}
      activeSymbol={activeSymbol}
      onSelect={selectSymbol}
      onAdd={addWatch}
      onRemove={removeWatch}
      onNewOrder={(s) => setOrderFor(s)}
      onMaximize={() => toggleMax('left')}
      maximized={maximized === 'left'}
    />
  ) : null;

  const navigatorEl = (
    <Navigator
      accounts={accounts}
      connectedIds={new Set(Object.keys(connected))}
      connectingIds={connecting}
      activeId={activeId}
      onConnect={onConnect}
      onReconnect={onReconnect}
      onConnectCreds={onConnectCreds}
      onSetActive={setActive}
      onDisconnect={disconnect}
      onForget={forget}
      onRemove={removeAccount}
      onRefresh={() => void api.listAccounts().then(setAccounts).catch(() => {})}
      openNew={connectSignal}
      isWeb={vp.isWeb}
    />
  );

  const leftInner = (
    <>
      {marketWatchEl && (
        <div className="left-pane" style={{ flex: `${leftSplit} 1 0` }}>{marketWatchEl}</div>
      )}
      {splitLeft && <div className="left-split" onPointerDown={startLeftSplit} title="Drag to resize" />}
      <div className="left-pane" style={{ flex: splitLeft ? `${1 - leftSplit} 1 0` : '1 1 0' }}>{navigatorEl}</div>
    </>
  );

  const toolboxEl = (
    <Toolbox
      tab={toolboxTab}
      setTab={setToolboxTab}
      acct={activeAcctView}
      history={history}
      orders={orders}
      ordersAvailable={typeof api.ordersHistory === 'function'}
      deals={deals}
      dealsAvailable={typeof api.dealsHistory === 'function'}
      period={histPeriod}
      onPeriodChange={setHistPeriod}
      journal={journal}
      onClose={(t) => void closePosition(t)}
      pending={pending}
      pendingAvailable={typeof api.listPendingOrders === 'function'}
      onModifyPosition={(p) => setModifyTarget({ kind: 'position', position: p })}
      onModifyPending={(o) => setModifyTarget({ kind: 'pending', order: o })}
      onCancelPending={(t) => void cancelPending(t)}
      canTrade={tradingEnabled}
      accounts={connectedList}
      activeId={activeId}
      activeSymbol={activeSymbol}
    />
  );

  // The chart-area's grid cell per tier: mobile always 'main' (kept mounted beneath the
  // overlays); tablet always 'chart' (full width); desktop respects maximize.
  const chartAreaStyle: React.CSSProperties | undefined =
    isMobile ? { gridArea: 'main' }
      : isTablet ? undefined
        : maximized === 'chart' ? { gridArea: 'main' } : undefined;

  // Non-chart mobile views: the existing panel rendered as a full-screen overlay ON TOP
  // of the always-mounted chart (so the chart is never unmounted/resized). Quotes shows
  // just the watchlist (accounts moved to the ☰ drawer); Trade/History show the toolbox
  // at that tab. (Journal/Settings reach a sheet/overlay from the ☰ drawer.)
  // Tapping a symbol on a mobile list charts it AND switches to the Charts tab (MT5).
  const mobileSelectSymbol = (s: string) => { selectSymbol(s); setMobileView('chart'); };

  const mobileOverlay = !isMobile || mobileView === 'chart' ? null : (
    <div className="m-overlay">
      {mobileView === 'quotes' && (
        <MobileQuotes watch={activeAcct?.watch ?? []} quotes={activeQuotes} activeSymbol={activeSymbol} onSelect={mobileSelectSymbol} onRemove={removeWatch} />
      )}
      {mobileView === 'trade' && (
        <MobileTrade
          account={activeAcct?.info ?? null}
          positions={activeOpenPositions}
          pending={pending}
          pendingAvailable={typeof api.listPendingOrders === 'function'}
          onSelect={mobileSelectSymbol}
          onClose={(t) => void closePosition(t)}
          onModify={(p) => setModifyTarget({ kind: 'position', position: p })}
          onModifyPending={(o) => setModifyTarget({ kind: 'pending', order: o })}
          onCancelPending={(t) => void cancelPending(t)}
          canTrade={tradingEnabled}
        />
      )}
      {mobileView === 'history' && (
        <MobileHistory
          rows={history}
          period={histPeriod}
          orders={orders}
          ordersAvailable={typeof api.ordersHistory === 'function'}
          deals={deals}
          dealsAvailable={typeof api.dealsHistory === 'function'}
        />
      )}
    </div>
  );

  // Mobile full-screen sheet for the secondary surfaces reached from the ☰ drawer
  // (Journal / Alerts). Its own header with a back chevron; Settings uses its existing
  // overlay. The toolbox renders at the matching tab.
  const mobileSheetEl = !isMobile || !mobileSheet ? null : (
    <div className="m-sheet">
      <header className="m-head">
        <button className="m-head-menu" aria-label="Back" onClick={() => setMobileSheet(null)}>‹</button>
        {/* The title follows the ACTIVE inner toolbox tab — switching Journal→Alerts inside
            the sheet must update the header (it used to be pinned to the open reason). */}
        <span className="m-head-title">{toolboxTab === 'journal' ? 'Journal' : toolboxTab === 'alerts' ? 'Alerts' : toolboxTab === 'history' ? 'History' : 'Trade'}</span>
      </header>
      <section className="toolbox-area m-tb">{toolboxEl}</section>
    </div>
  );

  return (
    <div id="mt5" style={gridStyle} data-tier={effTier} data-draw={isMobile && mobileDrawOpen ? 'open' : undefined}
      data-mview={isMobile ? mobileView : undefined}
      data-orient={isMobile ? orientationOf(vp.width, vp.height) : undefined}
      data-compact={isMobile && vp.height <= 540 ? '1' : undefined}
      data-tfopen={isMobile && mobileTfOpen ? '1' : undefined}>
      {isMobile && streamDown && <div className="m-net" role="status">Reconnecting to live data…</div>}
      {isMobile && (
        <MobileHeader
          view={mobileView}
          canTrade={tradingEnabled}
          activeSymbol={activeSymbol}
          timeframe={timeframe}
          floatingPnl={sbFloatingPnl}
          hasConnection={!!activeAcct}
          onMenu={() => setDrawerLeft((v) => !v)}
          onNewOrder={() => { if (activeSymbol) setOrderFor(activeSymbol); }}
          onPickSymbol={() => setMobileSymPick(true)}
          onAddSymbol={() => setMobileAddOpen(true)}
          period={histPeriod}
          onPeriodChange={setHistPeriod}
          indicatorSlot={<IndicatorMenu accountId={activeId} symbol={activeSymbol} timeframe={timeframe} />}
        />
      )}
      {!isMobile && (
      <header className="toolbar" ref={toolbarRef}>
        <div className="tb-left">
          {isTablet && <button className="iconbtn m-burger" title="Menu" onClick={() => setDrawerLeft((v) => !v)}>☰</button>}
          {/* A partner host that stamps data-brand-hide-logo="true" renders its OWN navbar logo,
              so we suppress the bundle's mark to avoid a double logo (#3). Absent → shown. */}
          {!brand.hideBrandMark && (
          <button
            className="logo"
            type="button"
            title={vp.isWeb ? `Back to ${brand.productName} home` : `${brand.productName} Terminal`}
            onClick={goHome}
            style={vp.isWeb ? undefined : { cursor: 'default' }}
          ><BrandLogo /></button>
          )}
          {activeSymbol && <span className="active-sym">{activeSymbol}, {TF_LABEL[timeframe]}</span>}
        </div>
        <div className="tf-bar">
          {TIMEFRAMES.map((t) => (
            <button key={t.id} className={`tf ${timeframe === t.id ? 'on' : ''}`} disabled={!activeSymbol} onClick={() => changeTimeframe(t.id)}>{t.label}</button>
          ))}
        </div>
        <div className="tb-right">
          {vp.isWeb && <TierToggle variant="bar" />}
          {connecting.size > 0 && <span className="connecting-pill"><span className="spinner" />Connecting {connecting.size}…</span>}
          <IndicatorMenu accountId={activeId} symbol={activeSymbol} timeframe={timeframe} />
          {tradingEnabled && <button className="neworder" disabled={!activeAcct || !activeSymbol} onClick={() => activeSymbol && setOrderFor(activeSymbol)}>New Order</button>}
          <button className="iconbtn" title={bigPrice ? 'Hide big price' : 'Show big-price quote'} onClick={toggleBigPrice}>＄</button>
          <button className="iconbtn" title={toolboxHidden ? 'Show bottom panel' : 'Hide bottom panel'} onClick={toggleToolbox}>{toolboxHidden ? '⊞' : '⊟'}</button>
          <ThemeSwitcher />
          <button className="iconbtn" title="Settings" onClick={() => setShowSettings(true)}>⚙</button>
          <UserMenu user={user} onSettings={() => setShowSettings(true)} onHome={goHome} isWeb={vp.isWeb} onLogout={onLogout} />
        </div>
      </header>
      )}

      {effTier === 'desktop' && showLeft && !leftCollapsed && (
        <aside className="left" ref={leftRef} style={maximized === 'left' ? { gridArea: 'main' } : undefined}>
          {leftInner}
        </aside>
      )}

      {(isMobile || isTablet || showChart) && (
        <main className="chart-area" ref={areaRef} style={chartAreaStyle}
          onTouchStart={onChartTouchStart} onTouchMove={onChartTouchMove} onTouchEnd={onChartTouchEnd}>
          {/* Sidebar collapse pull-tab (#13 v2): on the chart's LEFT edge (the sidebar boundary),
              ALWAYS visible + tinted with the theme's secondary/gold highlight so it can't be missed
              (the earlier opacity-.5 version was invisible). ‹ hides, › shows. */}
          {effTier === 'desktop' && (
            <button
              className="sidebar-pull"
              title={leftCollapsed ? 'Show left sidebar' : 'Hide left sidebar'}
              aria-label={leftCollapsed ? 'Show left sidebar' : 'Hide left sidebar'}
              onClick={toggleLeftCollapsed}
            >{leftCollapsed ? '›' : '‹'}</button>
          )}
          {hasConnection && accountTabs.length > 0 && (
            <ChartTabs
              tabs={accountTabs}
              activeTabId={activeTabId}
              onActivate={activateTab}
              onClose={closeTab}
              onTogglePin={togglePin}
              onReorder={reorderTab}
              onAddChart={addChart}
              layout={chartLayout}
              onSetLayout={setLayout}
              maximized={maximized === 'chart'}
              onToggleMax={() => toggleMax('chart')}
              onStartTabDock={(id) => setDragSourceId(id)}
              shownIds={useMosaic && tree ? new Set(leaves(tree)) : undefined}
            />
          )}
          <div className="chart-body">
            {/* MOBILE radial TF selector (Item 3): a tap on the chart toggles this circular
                dial; pick a TF to switch + dismiss. Replaces the old header TF dropdown. */}
            {isMobile && mobileView === 'chart' && mobileTfOpen && activeSymbol && (
              <MobileTfRadial
                timeframe={timeframe}
                onPick={(id) => changeTimeframe(id)}
                onClose={() => setMobileTfOpen(false)}
              />
            )}
            {/* Draw mode (long-press) with NO tool armed → a tap OUTSIDE the toolbar dismisses
                it (Item 4). The scrim sits above the chart but below the .dtb toolbar + ✓ Done;
                it's hidden the moment a tool is armed so taps draw normally. */}
            {isMobile && mobileDrawOpen && !mobileDrawTool && (
              <div className="m-draw-scrim" onClick={closeMobileDraw} />
            )}
            {useMosaic ? (
              tree ? (
                <ChartMosaic
                  tree={tree}
                  tabs={accountTabs}
                  activeTabId={activeTabId}
                  layout={chartLayout}
                  onChange={setTree}
                  onActivate={(id) => { const t = tabs.find((x) => x.id === id); if (t) activateTab(t); }}
                  onClose={(id) => {
                    // Pane × REMOVES the chart from the LAYOUT but KEEPS the tab (closing the tab
                    // itself is the strip's ×). Keep at least one chart visible — the last pane
                    // can't be removed (switch to a single-chart layout instead).
                    const others = leaves(tree).filter((l) => l !== id);
                    if (others.length === 0) return;
                    if (id === maximizedTabId) setMaximizedTabId(null);
                    // Removing the ACTIVE pane: hand "active" to a remaining pane first, so trade
                    // focus + highlight follow a chart that's still on screen.
                    if (id === activeTabId) {
                      const nextTab = accountTabs.find((t) => t.id === others[0]);
                      if (nextTab) activateTab(nextTab);
                    }
                    setTree((prev) => removeLeaf(prev, id));
                  }}
                  onMaximize={(id) => setMaximizedTabId((prev) => (prev === id ? null : id))}
                  renderPane={renderPaneForTab}
                  dragSourceId={dragSourceId}
                  onStartDock={(id) => setDragSourceId(id)}
                  onDockEnd={() => setDragSourceId(null)}
                  maximizedId={maximizedTabId ?? undefined}
                />
              ) : null
            ) : (
              <ChartPane
                ref={chartPaneRef}
                accountId={activeId}
                symbol={activeSymbol}
                timeframe={timeframe}
                reloadKey={reloadKey}
                hasConnection={hasConnection}
                onLog={log}
                trade={tradeCtx}
                onPlaceOrder={(plan) => { if (activeSymbol) placePlannedTradeFor(activeSymbol, plan); }}
                onNewOrder={() => { if (activeSymbol) setOrderFor(activeSymbol); }}
                onOpenSettings={() => setShowSettings(true)}
                onConnect={openConnect}
                onActiveToolChange={setMobileDrawTool}
                trades={visibleTradesFor(activeId, activeSymbol)}
                positionSymbols={positionSymbolsFor(activeId)}
                isMobile={isMobile}
              />
            )}
            {bigPrice && hasConnection && <BigPrice symbol={activeSymbol} quote={activeSymbol ? activeQuotes[activeSymbol] : undefined} onClose={toggleBigPrice} />}
          </div>
          {isMobile && tradingEnabled && mobileView === 'chart' && activeSymbol && (
            <MobileTradeBand
              bid={activeQuotes[activeSymbol]?.bid ?? null}
              ask={activeQuotes[activeSymbol]?.ask ?? null}
              volume={bandVolume}
              onStep={stepBandVol}
              onSetVolume={setBandVolumeManual}
              onSell={() => bandOrder('SELL')}
              onBuy={() => bandOrder('BUY')}
              disabled={!activeAcct || orderBusy}
            />
          )}
          {isMobile && mobileDrawOpen && (
            <button className="m-draw-done" onClick={closeMobileDraw}>✓ Done</button>
          )}
        </main>
      )}

      {((effTier === 'desktop' && showToolbox) || (isTablet && !toolboxHidden)) && (
        <section className="toolbox-area" style={maximized === 'toolbox' ? { gridArea: 'main' } : undefined}>
          {!maximized && <div className="hsplit" onPointerDown={startToolboxDrag} title="Drag to resize" />}
          <button className="panel-max toolbox-max" title={maximized === 'toolbox' ? 'Restore panel' : 'Maximize panel'} onClick={() => toggleMax('toolbox')}>{maximized === 'toolbox' ? '⤡' : '⤢'}</button>
          {toolboxEl}
        </section>
      )}

      {/* Web mobile: non-chart views overlay the always-mounted chart. */}
      {mobileOverlay}
      {/* Web mobile: full-screen sheet (Journal / Alerts) reached from the ☰ drawer. */}
      {mobileSheetEl}

      {/* Web mobile: the add-symbol picker (Quotes header +). */}
      {isMobile && mobileAddOpen && activeAcct && (
        <MobileSymbolPicker
          symbols={activeAcct.symbols}
          watch={activeAcct.watch}
          onAdd={addWatch}
          onClose={() => setMobileAddOpen(false)}
        />
      )}

      {/* Web mobile: the chart symbol-SWITCH picker (tap the chart symbol → chart it). */}
      {isMobile && mobileSymPick && activeAcct && (
        <MobileSymbolPicker
          mode="switch"
          symbols={activeAcct.symbols}
          watch={activeAcct.watch}
          activeSymbol={activeSymbol}
          onSelect={(s) => selectSymbol(s)}
          onAdd={addWatch}
          onClose={() => setMobileSymPick(false)}
        />
      )}

      {/* Web mobile: the dedicated account-details view (Item 2, from the ☰ drawer). */}
      {isMobile && mobileAccountOpen && (
        <MobileAccountView
          info={activeAcct?.info ?? null}
          broker={accounts.find((a) => a.id === activeId) ?? null}
          connecting={activeId ? connecting.has(activeId) : false}
          floatingPnl={sbFloatingPnl}
          onClose={() => setMobileAccountOpen(false)}
        />
      )}

      {/* Web mobile: bottom tab bar (Quotes / Charts / Trade / History). */}
      {isMobile && <MobileNav view={mobileView} onSelect={selectMobileView} />}

      {/* Side drawer — tablet: the left sidebar; mobile: accounts + the secondary menu
          (Account / Settings / Journal / Alerts / layout), like MT5's ☰ menu. */}
      {(isMobile || isTablet) && (
        <>
          <div className={`m-drawer-scrim ${drawerLeft ? 'on' : ''}`} onClick={() => setDrawerLeft(false)} />
          <aside className={`m-drawer ${drawerLeft ? 'on' : ''} ${isMobile ? 'm-drawer-mobile' : ''}`}>
            {isMobile ? (
              <div className="m-drawer-inner">
                <div className="m-drawer-accts">{navigatorEl}</div>
                <nav className="m-menu">
                  {vp.isWeb && <button className="m-menu-item" onClick={() => { setDrawerLeft(false); goHome(); }}>⌂ {brand.productName} Home</button>}
                  <button className="m-menu-item" disabled={!activeAcct} onClick={() => { setMobileAccountOpen(true); setDrawerLeft(false); }}>ⓘ Account</button>
                  <button className="m-menu-item" onClick={() => { setShowSettings(true); setDrawerLeft(false); }}>⚙ Settings</button>
                  <button className="m-menu-item" onClick={() => { setToolboxTab('journal'); setMobileSheet('journal'); setDrawerLeft(false); }}>▤ Journal</button>
                  <button className="m-menu-item" onClick={() => { setToolboxTab('alerts'); setMobileSheet('alerts'); setDrawerLeft(false); }}>🔔 Alerts</button>
                  {/* Screen-size preview (web only) — force mobile/tablet/desktop or Auto.
                      Placed between Alerts and Chart layout (Miguel, 2026-10-17). */}
                  {vp.isWeb && <TierToggle variant="menu" />}
                  {/* Chart layout (Item: relocated from the tab strip so the symbol tabs keep
                      full width, but stays reachable on mobile). Single / side-by-side / stacked / grid. */}
                  <div className="m-menu-item m-menu-layout">
                    <span>Chart layout</span>
                    <div className="m-layout-pick">
                      {LAYOUTS.map(([l, ico, title]) => (
                        <button key={l} className={`m-layout-btn ${chartLayout === l ? 'on' : ''}`} title={title}
                          onClick={() => { setLayout(l); setMobileView('chart'); setDrawerLeft(false); }}>{ico}</button>
                      ))}
                    </div>
                  </div>
                  <div className="m-menu-item m-menu-theme"><span>Theme</span><ThemeSwitcher /></div>
                  <button className="m-menu-item" onClick={onLogout}>⎋ Sign out</button>
                </nav>
              </div>
            ) : leftInner}
          </aside>
        </>
      )}

      <StatusBar
        activeSymbol={activeSymbol}
        timeframe={timeframe}
        quote={activeSymbol ? activeQuotes[activeSymbol] : undefined}
        account={activeAcct?.info ?? null}
        floatingPnl={sbFloatingPnl}
        connection={sbConnection}
      />

      {showSettings && (
        <SettingsPage
          chartKey={activeId && activeSymbol ? `${activeId}:${activeSymbol}:${timeframe}` : null}
          onClose={() => setShowSettings(false)}
          onReloadChart={reloadChart}
          userEmail={user?.email}
          onLogout={onLogout}
        />
      )}

      {tradingEnabled && orderFor && activeAcct && (
        <OrderDialog
          acct={activeAcct}
          symbol={orderFor}
          quote={activeQuotes[orderFor]}
          quotesBySymbol={activeQuotes}
          busy={orderBusy}
          mobile={isMobile}
          onPlace={(req) => void placeOrder(req)}
          onClose={() => setOrderFor(null)}
        />
      )}

      {/* Modify a position's S/L · T/P, or a pending order's trigger price · S/L · T/P. */}
      {tradingEnabled && modifyTarget && (
        <ModifyDialog
          target={modifyTarget}
          busy={modifyBusy}
          onSubmit={(v) => void submitModify(v)}
          onClose={() => setModifyTarget(null)}
        />
      )}

      {/* Band order confirmation (MT5 confirms by default; one-click is opt-in). */}
      {isMobile && tradingEnabled && bandConfirm && activeSymbol && (
        <div className="m-confirm-back" onClick={() => setBandConfirm(null)}>
          <div className="m-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="m-confirm-h">Confirm order</div>
            <div className="m-confirm-body">
              <span className={bandConfirm === 'SELL' ? 'm-sell' : 'm-buy'}>{bandConfirm}</span>{' '}
              <b>{bandVolume.toFixed(2)}</b> {activeSymbol}
              {(() => { const p = bandConfirm === 'SELL' ? activeQuotes[activeSymbol]?.bid : activeQuotes[activeSymbol]?.ask;
                return p != null ? <div className="m-confirm-px">at {fmtPx(p)}</div> : null; })()}
            </div>
            <div className="m-confirm-btns">
              <button className="m-confirm-cancel" onClick={() => setBandConfirm(null)}>Cancel</button>
              <button className={`m-confirm-go ${bandConfirm === 'SELL' ? 'sell' : 'buy'}`}
                onClick={() => { const side = bandConfirm; setBandConfirm(null); placeOrder({ symbol: activeSymbol, side, volume: bandVolume, type: 'market' }); }}>
                {bandConfirm} by Market
              </button>
            </div>
          </div>
        </div>
      )}

      <CommandPalette />
    </div>
  );
}
