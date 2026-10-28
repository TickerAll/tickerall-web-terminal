import { useEffect, useState } from 'react';
import type { AuthState } from '../shared/types';
import { api } from './api';
import { Login } from './components/Login';
import { Terminal } from './components/Terminal';
import { ThemeProvider } from './theme/ThemeProvider';
import { Toasts } from './components/Toasts';

/** The login/terminal gate (kept separate so the ThemeProvider can wrap it). */
function Root() {
  const [auth, setAuth] = useState<AuthState | null>(null);

  useEffect(() => {
    void api.authStatus().then(setAuth);
    api.onAuthChange(setAuth); // main pushes auth:change (e.g. on logout)
  }, []);

  if (auth === null) return <div className="center muted">Loading…</div>;
  if (!auth.authed) return <Login onAuthed={setAuth} />;
  return <Terminal user={auth.user} onLogout={() => void api.logout()} />;
}

/** Root: applies the active theme (Foundation 2) around the login-gated terminal.
 *  ThemeProvider must wrap the WHOLE tree (incl. the Login screen) so the active
 *  theme — and the byte-identical dark default — applies everywhere from first paint. */
export function App() {
  return (
    <ThemeProvider>
      <Root />
      <Toasts />
    </ThemeProvider>
  );
}
