import { useEffect, useState } from 'react';
import type { BrokerAccount, ConnectConfig } from '../../shared/types';
import { getBranding } from '../branding';

type ConnectOutcome = 'ok' | 'needs-password' | 'error';

/**
 * Navigator — the account roster (MT5's Navigator → Accounts). A hot account
 * connects in one click; a cold one re-warms with its remembered login, or
 * prompts for the broker password. New accounts are added with full creds.
 */
export function Navigator({
  accounts, connectedIds, connectingIds, activeId, onConnect, onReconnect, onConnectCreds, onSetActive, onDisconnect, onForget, onRemove, onRefresh, openNew, isWeb,
}: {
  accounts: BrokerAccount[];
  connectedIds: Set<string>;
  connectingIds: Set<string>;
  activeId: string | null;
  onConnect: (a: BrokerAccount) => Promise<ConnectOutcome>;
  onReconnect: (accountId: string, password: string, remember: boolean) => Promise<boolean>;
  onConnectCreds: (cfg: ConnectConfig) => Promise<boolean>;
  onSetActive: (id: string) => void;
  onDisconnect: (id: string) => void;
  onForget: (id: string) => void;
  /** Permanently remove the account from the roster (connected OR cold). */
  onRemove: (id: string) => void;
  onRefresh: () => void;
  /** Bumps to open the "New account" form from outside (e.g. the chart connect CTA). */
  openNew?: number;
  /** On web there's no saved broker password, so "forget login" is meaningless —
   *  hidden there in favour of Remove. */
  isWeb?: boolean;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pwdFor, setPwdFor] = useState<string | null>(null);   // account id with the open password prompt
  const [pwd, setPwd] = useState('');
  const [remember, setRemember] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null); // account id with the open remove-confirm
  const [err, setErr] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [nf, setNf] = useState({ broker: 'mt5' as 'mt4' | 'mt5', server: '', account: '', password: '', remember: true });

  // Open the New-account form when the parent bumps `openNew` (the chart connect CTA).
  useEffect(() => { if (openNew) { setShowNew(true); setErr(''); } }, [openNew]);

  const handleConnect = async (a: BrokerAccount) => {
    setErr(''); setBusyId(a.id);
    try {
      const outcome = await onConnect(a);
      if (outcome === 'needs-password') { setPwdFor(a.id); setPwd(''); setRemember(true); }
      else if (outcome === 'error') setErr(`Couldn't connect ${a.server}.`);
    } finally { setBusyId(null); }
  };

  // Cold roster account → re-warm with ONLY the password. the TickerAll API holds the real
  // number server-side (keyed by accountId); the user never types it.
  const submitPwd = async (a: BrokerAccount) => {
    if (!pwd) { setErr('Enter your broker password.'); return; }
    setErr(''); setBusyId(a.id);
    try {
      const ok = await onReconnect(a.id, pwd, remember);
      if (ok) { setPwdFor(null); setPwd(''); } else setErr('Reconnect failed — check the password.');
    } finally { setBusyId(null); }
  };

  const submitNew = async () => {
    if (!nf.server.trim() || !nf.account.trim()) { setErr('Fill in the server and account number.'); return; }
    setErr(''); setBusyId('new');
    try {
      const ok = await onConnectCreds({
        broker: nf.broker, server: nf.server.trim(), account: Number(nf.account.trim()), password: nf.password, remember: nf.remember,
      });
      if (ok) { setShowNew(false); setNf({ broker: 'mt5', server: '', account: '', password: '', remember: true }); }
      else setErr('Connect failed — check the server, number and password.');
    } finally { setBusyId(null); }
  };

  return (
    <div className="nav">
      <div className="panel-h">
        <span>Accounts</span>
        <button className="iconbtn" title="Refresh" onClick={onRefresh}>⟳</button>
      </div>

      <div className="nav-list">
        {accounts.length === 0 && <div className="muted tiny" style={{ padding: '8px' }}>No broker accounts yet — add one below.</div>}
        {accounts.map((a) => {
          const live = connectedIds.has(a.id);
          const isConnecting = !live && (connectingIds.has(a.id) || busyId === a.id);
          const badge = live ? 'live' : a.hot ? 'ready' : /REJECT/i.test(a.status) ? 'rejected' : 'offline';
          return (
            <div key={a.id} className={`nav-acct ${activeId === a.id ? 'active' : ''}`}>
              <div className="nav-acct-row" onClick={() => (live ? onSetActive(a.id) : isConnecting ? undefined : void handleConnect(a))}>
                <span className={`dot ${isConnecting ? 'connecting' : badge}`} />
                <div className="nav-acct-info">
                  <div className="nav-acct-srv">{a.server}</div>
                  <div className="nav-acct-sub muted tiny">
                    {a.accountNumber} · {a.isDemo ? 'demo' : 'real'} · {a.broker.toUpperCase()}
                    {a.remembered ? ' · saved' : ''}
                  </div>
                </div>
                {live
                  ? <button className="rm" title="Disconnect" onClick={(e) => { e.stopPropagation(); onDisconnect(a.id); }}>×</button>
                  : isConnecting
                    ? <span className="tiny connecting-text"><span className="spinner" />connecting…</span>
                    : <span className="tiny connect-hint">connect</span>}
                {/* Remove from roster — on EVERY row (connected or cold), distinct from the
                    × Disconnect. Opens an inline confirm (re-addable, but guard against a slip). */}
                <button className="nav-rm-acct" title="Remove account from roster" aria-label={`Remove ${a.server}`}
                  onClick={(e) => { e.stopPropagation(); setPwdFor(null); setConfirmRemove((cur) => (cur === a.id ? null : a.id)); }}>
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2.5 4h11M6 4V2.6h4V4M4 4.6l.55 9h6.9l.55-9" />
                  </svg>
                </button>
              </div>

              {pwdFor === a.id && !live && (
                <div className="nav-pwd" onClick={(e) => e.stopPropagation()}>
                  <div className="muted tiny" style={{ marginBottom: 6 }}>Enter your broker password to reconnect. {getBranding().productName} already knows this account — you never type the number.</div>
                  <input className="readonly-num" value={a.accountNumber} disabled readOnly title={`your account (held by ${getBranding().productName} — not editable)`} />
                  <input type="password" placeholder="password" autoFocus value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submitPwd(a); }} />
                  <label className="chk"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> remember on this device</label>
                  <div className="nav-pwd-actions">
                    <button className="primary sm" disabled={busyId === a.id} onClick={() => void submitPwd(a)}>{busyId === a.id ? 'Reconnecting…' : 'Reconnect'}</button>
                    <button className="linkbtn" onClick={() => setPwdFor(null)}>cancel</button>
                  </div>
                </div>
              )}

              {a.remembered && !live && !isWeb && (
                <button className="linkbtn tiny forget" onClick={(e) => { e.stopPropagation(); onForget(a.id); }}>forget login</button>
              )}

              {confirmRemove === a.id && (
                <div className="nav-confirm-rm" onClick={(e) => e.stopPropagation()}>
                  <div className="muted tiny" style={{ marginBottom: 6 }}>
                    Remove <b>{a.server}</b> from your roster?{live ? ' It’ll be disconnected first.' : ''} You can re-add it anytime.
                  </div>
                  <div className="nav-pwd-actions">
                    <button className="danger sm" onClick={() => { setConfirmRemove(null); onRemove(a.id); }}>Remove</button>
                    <button className="linkbtn" onClick={() => setConfirmRemove(null)}>cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {err && <div className="nav-err tiny">{err}</div>}

      {showNew ? (
        <div className="nav-new">
          <div className="panel-h sub"><span>New account</span><button className="iconbtn" onClick={() => setShowNew(false)}>×</button></div>
          <div className="row">
            <select value={nf.broker} onChange={(e) => setNf({ ...nf, broker: e.target.value as 'mt4' | 'mt5' })}>
              <option value="mt5">MT5</option><option value="mt4">MT4</option>
            </select>
            <input placeholder="Server (e.g. FBS-Demo)" value={nf.server} onChange={(e) => setNf({ ...nf, server: e.target.value })} />
          </div>
          <input placeholder="Account number" value={nf.account} onChange={(e) => setNf({ ...nf, account: e.target.value })} />
          <input type="password" placeholder="Password" value={nf.password} onChange={(e) => setNf({ ...nf, password: e.target.value })} />
          <label className="chk"><input type="checkbox" checked={nf.remember} onChange={(e) => setNf({ ...nf, remember: e.target.checked })} /> remember on this device</label>
          <button className="primary sm" disabled={busyId === 'new'} onClick={() => void submitNew()}>{busyId === 'new' ? 'Connecting…' : 'Connect'}</button>
        </div>
      ) : (
        <button className="nav-add linkbtn" onClick={() => { setShowNew(true); setErr(''); }}>+ Connect a new account</button>
      )}
    </div>
  );
}
