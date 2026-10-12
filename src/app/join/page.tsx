'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { rpc, SetupNeeded } from '@/lib/hub';
import { isConfigured, supabase } from '@/lib/supabase';

type Peek = { household_name: string; role: string; display_name: string };

function JoinInner() {
  const router = useRouter();
  const code = (useSearchParams().get('code') ?? '').trim();
  const [peek, setPeek] = useState<Peek | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isConfigured) return;
    (async () => {
      const sb = supabase();
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        router.replace(`/login?next=${encodeURIComponent('/join?code=' + code)}`);
        return;
      }
      const { data: rows } = await sb.rpc('peek_invite', { p_code: code });
      const p = (rows as Peek[] | null)?.[0] ?? null;
      setPeek(p);
      if (p) setName(p.display_name);
    })();
  }, [code, router]);

  if (!isConfigured) return <SetupNeeded />;

  async function accept() {
    setBusy(true);
    setError('');
    try {
      const id = await rpc<string>('accept_invite', { p_code: code, p_display_name: name });
      try { localStorage.setItem('bhh.household', id); } catch { /* ignore */ }
      router.replace('/');
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <main className="splash">
      <div className="splash-card">
        <div className="logo-mark">💌</div>
        {peek === undefined ? (
          <p className="muted">Checking your invite…</p>
        ) : peek === null ? (
          <>
            <h1>Invite not valid</h1>
            <p className="muted">This invite has expired or was already used. Ask for a new one.</p>
            <button className="btn" onClick={() => router.replace('/')}>Go home</button>
          </>
        ) : (
          <>
            <h1>Join {peek.household_name}</h1>
            <p className="muted">
              You’re invited as {peek.role === 'sitter' ? 'a pet sitter' : peek.role === 'child' ? 'a child' : 'an adult'}.
              {peek.role === 'sitter' && ' You’ll only see the animal-care checklist and instructions you’ve been given access to.'}
            </p>
            <div style={{ textAlign: 'left' }}>
              <label>Your name</label>
              <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </div>
            {error && <div className="error">{error}</div>}
            <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim()} onClick={accept}>
              {busy ? 'Joining…' : 'Join'}
            </button>
          </>
        )}
      </div>
    </main>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinInner />
    </Suspense>
  );
}
