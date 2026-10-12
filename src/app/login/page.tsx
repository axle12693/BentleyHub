'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { SetupNeeded } from '@/lib/hub';
import { isConfigured, supabase } from '@/lib/supabase';

/** Only allow same-site relative redirects. */
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (!isConfigured) return;
    supabase().auth.getSession().then(({ data }) => data.session && router.replace(next));
  }, [next, router]);

  if (!isConfigured) return <SetupNeeded />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    const sb = supabase();
    if (mode === 'in') {
      const { error: err } = await sb.auth.signInWithPassword({ email, password });
      if (err) setError(err.message);
      else router.replace(next);
    } else {
      const { data, error: err } = await sb.auth.signUp({ email, password });
      if (err) setError(err.message);
      else if (data.session) router.replace(next);
      else setInfo('Check your email for a confirmation link, then come back and sign in.');
    }
    setBusy(false);
  }

  async function reset() {
    if (!email) return setError('Enter your email first.');
    const { error: err } = await supabase().auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/login' });
    if (err) setError(err.message);
    else setInfo('Password reset email sent.');
  }

  return (
    <main className="splash">
      <div className="splash-card">
        <div className="logo-mark">🏡</div>
        <h1>Bentley Home Hub</h1>
        <p className="muted">Your family’s chores, pets, calendar and rewards.</p>
        <div className="seg" style={{ margin: '16px 0 4px' }}>
          <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Sign in</button>
          <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Create account</button>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <label htmlFor="pw">Password</label>
          <input
            id="pw"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'up' && <p className="muted small">At least 8 characters.</p>}
          {error && <div className="error">{error}</div>}
          {info && <div className="success">{info}</div>}
          <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy}>
            {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
          </button>
          {mode === 'in' && (
            <p style={{ textAlign: 'center' }}>
              <button type="button" className="btn ghost small" onClick={reset}>Forgot password?</button>
            </p>
          )}
        </form>
        <p className="muted small">Have an invite from a family member or for pet-sitting? Create an account, then enter your invite code.</p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
