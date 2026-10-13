'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { FormError } from '@/components/ui';
import { SetupNeeded, Splash } from '@/components/Splash';
import { safeNext } from '@/lib/auth';
import { isConfigured, supabase } from '@/lib/supabase';
import { useSubmit } from '@/lib/useSubmit';

type Mode = 'in' | 'up' | 'recover';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [info, setInfo] = useState('');
  const { busy, error, setError, run } = useSubmit();

  useEffect(() => {
    if (!isConfigured) return;
    const sb = supabase();
    // Arriving from a password-reset email: the link signs the user in, but they must set a new
    // password rather than be sent on to the app.
    const recovering = params.get('reset') === '1' || window.location.hash.includes('type=recovery');
    const { data: sub } = sb.auth.onAuthStateChange((evt) => {
      if (evt === 'PASSWORD_RECOVERY') setMode('recover');
    });
    if (recovering) setMode('recover');
    else sb.auth.getSession().then(({ data }) => data.session && router.replace(next));
    return () => sub.subscription.unsubscribe();
  }, [next, params, router]);

  if (!isConfigured) return <SetupNeeded />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setInfo('');
    await run(async () => {
      const sb = supabase();
      if (mode === 'in') {
        const { error: err } = await sb.auth.signInWithPassword({ email, password });
        if (err) throw err;
        router.replace(next);
      } else if (mode === 'up') {
        const { data, error: err } = await sb.auth.signUp({ email, password });
        if (err) throw err;
        if (data.session) router.replace(next);
        else setInfo('Check your email for a confirmation link, then come back and sign in.');
      } else {
        const { error: err } = await sb.auth.updateUser({ password });
        if (err) throw err;
        router.replace('/');
      }
    });
  }

  async function reset() {
    if (!email) return setError('Enter your email first.');
    const { error: err } = await supabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login?reset=1` });
    if (err) setError(err.message);
    else {
      setError('');
      setInfo('Password reset email sent.');
    }
  }

  const recover = mode === 'recover';
  return (
    <Splash>
      <p className="muted">{recover ? 'Choose a new password.' : 'Your family’s chores, pets, calendar and rewards.'}</p>
      {!recover && (
        <div className="seg" style={{ margin: '16px 0 4px' }}>
          <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>Sign in</button>
          <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>Create account</button>
        </div>
      )}
      <form onSubmit={submit}>
        {!recover && (
          <>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </>
        )}
        <label htmlFor="pw">{recover ? 'New password' : 'Password'}</label>
        <input
          id="pw"
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {mode !== 'in' && <p className="muted small">At least 8 characters.</p>}
        <FormError error={error} />
        {info && <div className="success">{info}</div>}
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy}>
          {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Save new password'}
        </button>
        {mode === 'in' && (
          <p style={{ textAlign: 'center' }}>
            <button type="button" className="btn ghost small" onClick={reset}>Forgot password?</button>
          </p>
        )}
      </form>
      {!recover && <p className="muted small">Have an invite from a family member or for pet-sitting? Create an account, then enter your invite code.</p>}
    </Splash>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
