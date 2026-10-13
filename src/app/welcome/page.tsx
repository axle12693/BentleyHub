'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormError } from '@/components/ui';
import { SetupNeeded, Splash } from '@/components/Splash';
import { rpc } from '@/lib/api';
import { setActiveHousehold, useRequireSession, useSignOut } from '@/lib/auth';
import { isConfigured } from '@/lib/supabase';
import { useSubmit } from '@/lib/useSubmit';

export default function Welcome() {
  const router = useRouter();
  const signedIn = useRequireSession('/welcome');
  const signOut = useSignOut();
  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('Bentley Family');
  const [me, setMe] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, run } = useSubmit();

  if (!isConfigured) return <SetupNeeded />;
  if (!signedIn) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(async () => {
      const id =
        mode === 'create'
          ? await rpc<string>('create_household', { p_name: name, p_display_name: me })
          : await rpc<string>('accept_invite', { p_code: code.trim(), p_display_name: me || null });
      setActiveHousehold(id);
    });
    if (ok) router.replace('/');
  }

  return (
    <Splash logo="🌿" title="Welcome home">
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
        <FormError error={error} />
        <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy}>
          {busy ? 'One moment…' : mode === 'create' ? 'Create household' : 'Join household'}
        </button>
      </form>
      <p style={{ textAlign: 'center' }}>
        <button className="btn ghost small" onClick={signOut}>Sign out</button>
      </p>
    </Splash>
  );
}
