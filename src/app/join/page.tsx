'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { FormError } from '@/components/ui';
import { SetupNeeded, Splash } from '@/components/Splash';
import { rpc } from '@/lib/api';
import { setActiveHousehold, useRequireSession } from '@/lib/auth';
import { isConfigured, supabase } from '@/lib/supabase';
import { roleLabel, type Role } from '@/lib/types';
import { useSubmit } from '@/lib/useSubmit';

type Peek = { household_name: string; role: Role; display_name: string };

function JoinInner() {
  const router = useRouter();
  const code = (useSearchParams().get('code') ?? '').trim();
  const signedIn = useRequireSession(`/join?code=${code}`);
  const [peek, setPeek] = useState<Peek | null | undefined>(undefined);
  const [name, setName] = useState('');
  const { busy, error, run } = useSubmit();

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    (async () => {
      const { data: rows } = await supabase().rpc('peek_invite', { p_code: code });
      const p = (rows as Peek[] | null)?.[0] ?? null;
      if (!live) return;
      setPeek(p);
      if (p) setName(p.display_name);
    })();
    return () => { live = false; };
  }, [signedIn, code]);

  if (!isConfigured) return <SetupNeeded />;

  async function accept() {
    const ok = await run(async () => {
      setActiveHousehold(await rpc<string>('accept_invite', { p_code: code, p_display_name: name }));
    });
    if (ok) router.replace('/');
  }

  const article = peek && /^[aeiou]/i.test(roleLabel(peek.role)) ? 'an' : 'a';
  return (
    <Splash logo="💌" title={peek === null ? 'Invite not valid' : peek ? `Join ${peek.household_name}` : ''}>
      {peek === undefined ? (
        <p className="muted">Checking your invite…</p>
      ) : peek === null ? (
        <>
          <p className="muted">This invite has expired or was already used. Ask for a new one.</p>
          <button className="btn" onClick={() => router.replace('/')}>Go home</button>
        </>
      ) : (
        <>
          <p className="muted">
            You’re invited as {article} {roleLabel(peek.role).toLowerCase()}.
            {peek.role === 'sitter' && ' You’ll only see the animal-care checklist and instructions you’ve been given access to.'}
          </p>
          <div style={{ textAlign: 'left' }}>
            <label>Your name</label>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </div>
          <FormError error={error} />
          <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy || !name.trim()} onClick={accept}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </>
      )}
    </Splash>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinInner />
    </Suspense>
  );
}
