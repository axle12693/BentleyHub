'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { rpc, SetupNeeded } from '@/lib/hub';
import { isConfigured, supabase } from '@/lib/supabase';

export default function Welcome() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('Bentley Family');
  const [me, setMe] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isConfigured) return;
    supabase().auth.getSession().then(({ data }) => {
      if (!data.session) router.replace('/login?next=/welcome');
      else setReady(true);
    });
  }, [router]);

  if (!isConfigured) return <SetupNeeded />;
  if (!ready) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'create') {
        const id = await rpc<string>('create_household', { p_name: name, p_display_name: me });
        try { localStorage.setItem('bhh.household', id); } catch { /* ignore */ }
      } else {
        const id = await rpc<string>('accept_invite', { p_code: code.trim(), p_display_name: me || null });
        try { localStorage.setItem('bhh.household', id); } catch { /* ignore */ }
      }
      router.replace('/');
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <main className="splash">
      <div className="splash-card">
        <div className="logo-mark">🌿</div>
        <h1>Welcome home</h1>
        <p className="muted">Start your household, or join one you’ve been invited to.</p>
        <div className="seg" style={{ margin: '16px 0 4px' }}>
          <button type="button" className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>Start a household</button>
          <button type="button" className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>I have a code</button>
        </div>
        <form onSubmit={submit}>
          {mode === 'create' ? (
            <>
              <label>Household name</label>
              <input required value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              <label>Your name</label>
              <input required value={me} maxLength={40} placeholder="e.g. Amanda" onChange={(e) => setMe(e.target.value)} />
            </>
          ) : (
            <>
              <label>Invite code</label>
              <input required value={code} placeholder="16-character code" autoCapitalize="none" autoCorrect="off" onChange={(e) => setCode(e.target.value)} />
              <label>Your name (optional — overrides the one in the invite)</label>
              <input value={me} maxLength={40} onChange={(e) => setMe(e.target.value)} />
            </>
          )}
          {error && <div className="error">{error}</div>}
          <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy}>
            {busy ? 'One moment…' : mode === 'create' ? 'Create household' : 'Join household'}
          </button>
        </form>
        <p style={{ textAlign: 'center' }}>
          <button className="btn ghost small" onClick={() => supabase().auth.signOut().then(() => router.replace('/login'))}>
            Sign out
          </button>
        </p>
      </div>
    </main>
  );
}
