'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Splash, SetupNeeded } from '@/components/Splash';
import { errMsg, must, myMemberships } from './api';
import { getActiveHousehold, loginUrl, setActiveHousehold, useSignOut } from './auth';
import { isConfigured, supabase } from './supabase';
import type { CalEvent, Household, LedgerRow, Member, Pet, Redemption, Reward, Task } from './types';

type Membership = { household_id: string; role: Member['role']; name: string };

type HubData = {
  household: Household;
  me: Member;
  members: Member[]; // active, non-revoked
  family: Member[]; // members minus sitters — who can be assigned tasks and earn points
  pets: Pet[];
  tasks: Task[];
  rewards: Reward[];
  events: CalEvent[];
  redemptions: Redemption[];
  ledger: LedgerRow[];
  balances: { member: Record<string, number>; family: number };
  isAdult: boolean; // owner or adult
  isSitter: boolean;
};

type Hub = HubData & {
  userId: string;
  memberships: Membership[];
  /** Bumps whenever any synced table changes — pages depend on it to refetch. */
  rev: number;
  reload: () => Promise<void>;
  switchHousehold: (id: string) => void;
  memberById: (id: string | null | undefined) => Member | undefined;
};

const Ctx = createContext<Hub | null>(null);
export const useHub = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useHub outside provider');
  return v;
};

const REALTIME_TABLES = ['members', 'pets', 'tasks', 'occurrences', 'events', 'rewards', 'redemptions', 'points_ledger', 'pet_notes', 'households'];

async function loadHousehold(hid: string, uid: string): Promise<HubData> {
  const sb = supabase();
  const [household, members, pets, tasks, rewards, events, redemptions, ledger, bal] = await Promise.all([
    must<Household>(sb.from('households').select('id,name,family_bonus_pct,sitter_info').eq('id', hid).single()),
    must<Member[]>(sb.from('members').select('*').eq('household_id', hid).is('revoked_at', null).order('created_at')),
    must<Pet[]>(sb.from('pets').select('*').eq('household_id', hid).eq('archived', false).order('created_at')),
    must<Task[]>(sb.from('tasks').select('*').eq('household_id', hid).eq('archived', false).order('created_at')),
    must<Reward[]>(sb.from('rewards').select('*').eq('household_id', hid).eq('active', true).order('cost')),
    must<CalEvent[]>(sb.from('events').select('*').eq('household_id', hid).gte('starts_at', new Date(Date.now() - 45 * 864e5).toISOString()).order('starts_at')),
    must<Redemption[]>(sb.from('redemptions').select('*').eq('household_id', hid).order('created_at', { ascending: false }).limit(50)),
    must<LedgerRow[]>(sb.from('points_ledger').select('id,scope,member_id,delta,kind,note,created_at').eq('household_id', hid).order('created_at', { ascending: false }).limit(60)),
    must<{ scope: string; member_id: string | null; balance: number }[]>(sb.from('point_balances').select('scope,member_id,balance').eq('household_id', hid)),
  ]);
  const me = members.find((m) => m.user_id === uid);
  if (!me) throw new Error('You no longer have access to this household.');
  const balances = { member: {} as Record<string, number>, family: 0 };
  for (const b of bal) {
    if (b.scope === 'family') balances.family = b.balance;
    else if (b.member_id) balances.member[b.member_id] = b.balance;
  }
  return {
    household, me, members, family: members.filter((m) => m.role !== 'sitter'), pets, tasks, rewards, events, redemptions, ledger, balances,
    isAdult: me.role === 'owner' || me.role === 'adult',
    isSitter: me.role === 'sitter',
  };
}

/**
 * Gate for every signed-in page: requires a session and a household, loads all shared data,
 * and keeps it live through Supabase realtime.
 */
export function HubProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const signOut = useSignOut();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'ended'>('loading');
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [data, setData] = useState<HubData | null>(null);
  const [rev, setRev] = useState(0);
  const activeRef = useRef<string | null>(null);

  const boot = useCallback(async () => {
    try {
      const { data: sess } = await supabase().auth.getSession();
      const user = sess.session?.user;
      if (!user) {
        router.replace(loginUrl(pathname));
        return;
      }
      setUserId(user.id);
      const rows = await myMemberships();
      if (rows.length === 0) {
        router.replace('/welcome');
        return;
      }
      const ms: Membership[] = rows
        .filter((r) => r.active)
        .map((r) => ({ household_id: r.household_id, role: r.role as Member['role'], name: r.household_name }));
      if (ms.length === 0) {
        // Had a household, but a sitter window ended or access was revoked.
        setPhase('ended');
        return;
      }
      setMemberships(ms);
      const saved = getActiveHousehold();
      const hid = ms.find((m) => m.household_id === saved)?.household_id ?? ms[0].household_id;
      activeRef.current = hid;
      setActiveId(hid);
      setData(await loadHousehold(hid, user.id));
      setPhase('ready');
    } catch (e) {
      setError(errMsg(e) || 'Something went wrong');
      setPhase('error');
    }
    // Runs once on mount; later navigation must not re-boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isConfigured) boot();
  }, [boot]);

  // Sign-out in another tab, or an expired session, sends us back to login.
  useEffect(() => {
    if (!isConfigured) return;
    const { data: sub } = supabase().auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_OUT') router.replace('/login');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  // A failed refresh after boot usually means access ended; tell that apart from a real error.
  const handleLoadFailure = useCallback(async (e: unknown) => {
    try {
      const rows = await myMemberships();
      if (!rows.some((r) => r.household_id === activeRef.current && r.active)) {
        setPhase('ended');
        return;
      }
    } catch { /* fall through to the generic error */ }
    setError(errMsg(e) || 'Lost connection');
    setPhase('error');
  }, []);

  // Live sync: any change to this household's data re-pulls it (debounced).
  useEffect(() => {
    if (phase !== 'ready' || !activeId || !userId) return;
    const sb = supabase();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (activeRef.current !== activeId) return;
        try {
          setData(await loadHousehold(activeId, userId));
          setRev((r) => r + 1);
        } catch (e) {
          await handleLoadFailure(e);
        }
      }, 250);
    };
    const ch = sb.channel(`hub-${activeId}`);
    for (const table of REALTIME_TABLES) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: table === 'households' ? `id=eq.${activeId}` : `household_id=eq.${activeId}` }, refresh);
    }
    ch.subscribe();
    // Also refresh when the app returns to the foreground (phones suspend websockets).
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      sb.removeChannel(ch);
    };
  }, [phase, activeId, userId, handleLoadFailure]);

  // A sitter's access ends at a set time: cut the session off then, instead of waiting for the next sync.
  const sitterEnd = data?.me.role === 'sitter' ? data.me.sitter_end : null;
  useEffect(() => {
    if (!sitterEnd) return;
    const end = new Date(sitterEnd).getTime();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const left = end - Date.now();
      if (left <= 0) setPhase('ended');
      else timer = setTimeout(tick, Math.min(left, 2 ** 31 - 1)); // setTimeout caps at ~24.8 days
    };
    tick();
    return () => clearTimeout(timer);
  }, [sitterEnd]);

  const reload = useCallback(async () => {
    if (!activeRef.current || !userId) return;
    setData(await loadHousehold(activeRef.current, userId));
    setRev((r) => r + 1);
  }, [userId]);

  const switchHousehold = useCallback((id: string) => {
    setActiveHousehold(id);
    window.location.assign('/');
  }, []);

  const value = useMemo<Hub | null>(() => {
    if (!data) return null;
    const byId = new Map(data.members.map((m) => [m.id, m]));
    return {
      ...data, userId, memberships, rev, reload, switchHousehold,
      memberById: (id) => (id ? byId.get(id) : undefined),
    };
  }, [data, userId, memberships, rev, reload, switchHousehold]);

  if (!isConfigured) return <SetupNeeded />;
  if (phase === 'error')
    return (
      <Splash>
        <p>{error}</p>
        <button className="btn" onClick={signOut}>Sign out</button>
      </Splash>
    );
  if (phase === 'ended')
    return (
      <Splash>
        <p>Your access to this household has ended.</p>
        <p className="muted">If you have a new invite code, you can use it to join again.</p>
        <p><Link className="btn primary" href="/welcome">I have an invite code</Link></p>
        <button className="btn ghost" onClick={signOut}>Sign out</button>
      </Splash>
    );
  if (phase === 'loading' || !value)
    return (
      <Splash>
        <p className="muted">Loading your home…</p>
      </Splash>
    );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
