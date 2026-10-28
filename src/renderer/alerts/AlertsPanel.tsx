/**
 * AlertsPanel — the minimal UI to manage price alerts (TERMINAL-ROADMAP area I, the
 * "alerts manager"). List / add (symbol + above|below + price) / remove /
 * enable-disable / re-arm. Theme-aware (every colour is a CSS var via the `.alerts-*`
 * rules in index.html; no hardcoded hexes).
 *
 * Self-contained: reads + writes the alerts store directly (which persists through
 * settings). It takes an optional `accounts` list (the connected accounts) so the add
 * form can offer an account + symbol dropdown; with none passed it falls back to free-
 * text symbol entry + the `defaultAccountId` (so it works as a Toolbox tab OR a bare
 * standalone panel). Nothing here touches the chart or the broker path.
 */

import { requestNotificationPermission } from './notify';
import { useMemo, useState } from 'react';
import type { PriceAlert } from '../../shared/settingsSchema';
import { useAlerts, addAlert, removeAlert, setEnabled, rearm } from './store';
import { usePushState, enableDevicePush, disableDevicePush } from './sync';

/** A connected account, the subset the add form needs (matches ConnAcct's shape). */
export interface AlertAccountOpt {
  id: string;
  label: string;
  symbols: string[];
}

export function AlertsPanel({
  accounts = [],
  defaultAccountId = null,
  defaultSymbol = null,
}: {
  /** Connected accounts → drive the account + symbol pickers. */
  accounts?: AlertAccountOpt[];
  /** Pre-select this account in the add form (e.g. the active chart's account). */
  defaultAccountId?: string | null;
  /** Pre-fill the symbol (e.g. the active chart's symbol). */
  defaultSymbol?: string | null;
}): JSX.Element {
  const alerts = useAlerts();
  const push = usePushState();
  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  // ── add-form state ──
  const firstAccId = defaultAccountId ?? accounts[0]?.id ?? '';
  const [accId, setAccId] = useState(firstAccId);
  const [symbol, setSymbol] = useState(defaultSymbol ?? '');
  const [op, setOp] = useState<'above' | 'below'>('above');
  const [priceStr, setPriceStr] = useState('');

  const effAccId = accId || firstAccId;
  const symOptions = accountById.get(effAccId)?.symbols ?? [];

  const price = Number(priceStr);
  const canAdd = effAccId.length > 0 && symbol.trim().length > 0 && Number.isFinite(price) && priceStr.trim() !== '';

  const submit = (): void => {
    // A tap on Add is the user gesture Android needs before it will show the permission prompt.
    void requestNotificationPermission();
    if (!canAdd) return;
    addAlert({ accountId: effAccId, symbol: symbol.trim(), op, price, enabled: true });
    setPriceStr(''); // keep account/symbol/op for quick successive alerts
  };

  return (
    <div className="alerts-panel">
      {/* Add form */}
      <div className="alerts-add">
        {accounts.length > 0 ? (
          <select className="al-acc" value={effAccId} onChange={(e) => { setAccId(e.target.value); setSymbol(''); }} title="Account">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        ) : null}

        {symOptions.length > 0 ? (
          <select className="al-sym" value={symbol} onChange={(e) => setSymbol(e.target.value)} title="Symbol">
            <option value="">— symbol —</option>
            {symOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : (
          <input
            className="al-sym"
            placeholder="Symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            spellCheck={false}
          />
        )}

        <select className="al-op" value={op} onChange={(e) => setOp(e.target.value as 'above' | 'below')} title="Condition">
          <option value="above">crosses above</option>
          <option value="below">crosses below</option>
        </select>

        <input
          className="al-price"
          type="number"
          step="any"
          placeholder="Price"
          value={priceStr}
          onChange={(e) => setPriceStr(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />

        <button className="primary sm" disabled={!canAdd} onClick={submit}>Add alert</button>
      </div>

      {push.available && (
        <div className="alerts-push tiny">
          <label>
            <input
              type="checkbox"
              checked={push.subscribed}
              disabled={push.busy}
              onChange={(e) => { void (e.target.checked ? enableDevicePush() : disableDevicePush()); }}
            />
            {' '}Notify this device when the app is closed
          </label>
          <span className="muted">
            {push.error ? push.error : push.subscribed ? 'On — alerts are checked on the server while the account is connected' : 'Alerts only fire while the app is open'}
          </span>
        </div>
      )}

      {/* List */}
      {alerts.length === 0 ? (
        <div className="muted tiny alerts-empty">No price alerts. Add one above — it fires once when the bid crosses your level.</div>
      ) : (
        <table className="al-table">
          <thead>
            <tr><th /><th>Account</th><th>Symbol</th><th>Condition</th><th className="num">Price</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <AlertRow key={a.id} a={a} accountLabel={accountById.get(a.accountId)?.label ?? a.accountId} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AlertRow({ a, accountLabel }: { a: PriceAlert; accountLabel: string }): JSX.Element {
  const triggered = a.triggeredAt != null;
  return (
    <tr className={`al-row ${a.enabled ? '' : 'al-off'} ${triggered ? 'al-fired' : ''}`}>
      <td className="al-en">
        <input
          type="checkbox"
          checked={a.enabled}
          onChange={(e) => setEnabled(a.id, e.target.checked)}
          title={a.enabled ? 'Enabled — uncheck to pause' : 'Paused — check to enable'}
        />
      </td>
      <td className="al-acc-cell tiny">{accountLabel}</td>
      <td className="sym">{a.symbol}</td>
      <td className={a.op === 'above' ? 'up' : 'down'}>{a.op === 'above' ? '↑ above' : '↓ below'}</td>
      <td className="num">{trimNum(a.price)}</td>
      <td className="al-status tiny">
        {triggered
          ? <span className="al-badge">fired {fmtWhen(a.triggeredAt!)}</span>
          : a.enabled ? <span className="muted">armed</span> : <span className="muted">paused</span>}
      </td>
      <td className="al-actions">
        {triggered && (
          <button className="linkbtn" title="Re-arm (fire again on the next crossing)" onClick={() => rearm(a.id)}>re-arm</button>
        )}
        <button className="rm" title="Delete alert" onClick={() => removeAlert(a.id)}>×</button>
      </td>
    </tr>
  );
}

/** Compact a price for display (strip trailing zeros). */
function trimNum(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, '');
}

/** A short "fired" timestamp (HH:MM). */
function fmtWhen(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}
