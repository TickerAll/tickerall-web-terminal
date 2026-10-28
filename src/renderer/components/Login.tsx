import { useState, type FormEvent } from 'react';
import type { AuthState } from '../../shared/types';
import { api, humanizeError } from '../api';
import { getBranding } from '../branding';

/** Product sign-in: email/password or Google (loopback OAuth via the main process). */
export function Login({ onAuthed }: { onAuthed: (s: AuthState) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<false | 'email' | 'google'>(false);
  const [error, setError] = useState('');
  const brand = getBranding();

  const run = async (kind: 'email' | 'google', fn: () => Promise<AuthState>) => {
    setBusy(kind);
    setError('');
    try {
      onAuthed(await fn());
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run('email', () => api.loginEmail(email.trim(), password));
  };

  return (
    <div className="login">
      <form className="card" onSubmit={onSubmit}>
        <h1>{brand.productName} <span>Terminal</span></h1>
        <p className="sub">Sign in to your {brand.productName} account to control your broker accounts.</p>

        <label>Email</label>
        <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />

        <button className="primary" type="submit" disabled={busy !== false}>
          {busy === 'email' ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="or">or</div>

        <button className="google" type="button" disabled={busy !== false}
          onClick={() => void run('google', () => api.loginGoogle())}>
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.2l7.9 6.1C12.2 13.2 17.6 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 2.9-2.2 5.4-4.7 7l7.3 5.7c4.3-4 6.8-9.9 6.8-17.2z"/>
            <path fill="#FBBC05" d="M10.4 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-2.9.8-4.3l-7.9-6.1C.9 16.7 0 20.2 0 24s.9 7.3 2.5 10.4l7.9-6.1z"/>
            <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.3-5.5l-7.3-5.7c-2 1.4-4.7 2.3-8 2.3-6.4 0-11.8-3.7-13.6-9l-7.9 6.1C6.4 42.6 14.6 48 24 48z"/>
          </svg>
          {busy === 'google' ? 'Opening browser…' : 'Sign in with Google'}
        </button>

        <div className="err">{error}</div>
      </form>
    </div>
  );
}
