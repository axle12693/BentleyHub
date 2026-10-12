'use client';

import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isConfigured, supabase } from './supabase';
import type { CalEvent, Household, LedgerRow, Member, OccWithTask, Pet, Redemption, Reward, Task } from './types';

type Membership = { household_id: string; role: Member['role']; name: string };

type Hub = {
  userId: string;
  memberships: Membership[];
  household: Household;
  me: Member;
  members: Member[]; // active, non-revoked
  pets: Pet[];
  tasks: Task[];
  rewards: Reward[];
  events: CalEvent[];
  redemptions: Redemption[];
  ledger: LedgerRow[];
  balances: { member: Record<string, number>; family: number };
  isAdult: boolean; // owner or adult
  isSitter: boolean;
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

const ACTIVE_KEY = 'bhh.household';
const readActive = () => {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
};

function Splash({ children }: { children: ReactNode }) {
  return (
    <main className="splash">
      <div className="splash-card">
        <div className="logo-mark">🏡</div>
        <h1>Bentley Home Hub</h1>
        {children}
      </div>
    </main>
  );
}

export function SetupNeeded() {
  return (
    <Splash>
      <p>This site isn’t connected to a database yet.</p>
      <p className="muted">
        Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your environment,
        then reload. See the README for the 5-minute Supabase setup.
      </p>
    </Splash>
  );
}

/**
 * Gate for every signed-in page: requires a session and a household, loads all shared data,
 * and keeps it live through Supabase realtime.
 */
export function HubProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [userId, setUserId] = useState('');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [data, setData] = useState<Omit<Hub, 'userId' | 'memberships' | 'reload' | 'switchHousehold' | 'memberById' | 'rev'> | null>(null);
  const [rev, setRev] = useState(0);
  const activeRef = useRef<string | null>(null);

  const loadHousehold = useCallback(async (hid: string, uid: string) => {
    const sb = supabase();
    const q = <T,>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) =>
      Promise.resolve(p).then((r) => {
        if (r.error) throw new Error(r.error.message);
        return r.data as T;
      });
    const [household, members, pets, tasks, rewards, events, redemptions, ledger, bal] = await Promise.all([
      q<Household>(sb.from('households').select('id,name,family_bonus_pct,sitter_info').eq('id', hid).single()),
      q<Member[]>(sb.from('members').select('*').eq('household_id', hid).is('revoked_at', null).order('created_at')),
      q<Pet[]>(sb.from('pets').select('*').eq('household_id', hid).eq('archived', false).order('created_at')),
      q<Task[]>(sb.from('tasks').select('*').eq('household_id', hid).eq('archived', false).order('created_at')),
      q<Reward[]>(sb.from('rewards').select('*').eq('household_id', hid).eq('active', true).order('cost')),
      q<CalEvent[]>(sb.from('events').select('*').eq('household_id', hid).gte('starts_at', new Date(Date.now() - 45 * 864e5).toISOString()).order('starts_at')),
      q<Redemption[]>(sb.from('redemptions').select('*').eq('household_id', hid).order('created_at', { ascending: false }).limit(50)),
      q<LedgerRow[]>(sb.from('points_ledger').select('id,scope,member_id,delta,kind,note,created_at').eq('household_id', hid).order('created_at', { ascending: false }).limit(60)),
      q<{ scope: string; member_id: string | null; balance: number }[]>(sb.from('point_balances').select('scope,member_id,balance').eq('household_id', hid)),
    ]);
    const me = members.find((m) => m.user_id === uid);
    if (!me) throw new Error('You no longer have access to this household.');
    const balances = { member: {} as Record<string, number>, family: 0 };
    for (const b of bal) {
      if (b.scope === 'family') balances.family = b.balance;
      else if (b.member_id) balances.member[b.member_id] = b.balance;
    }
    setData({
      household, me, members, pets, tasks, rewards, events, redemptions, ledger, balances,
      isAdult: me.role === 'owner' || me.role === 'adult',
      isSitter: me.role === 'sitter',
    });
  }, []);

  const boot = useCallback(async () => {
    try {
      const sb = supabase();
      const { data: sess } = await sb.auth.getSession();
      const user = sess.session?.user;
      if (!user) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setUserId(user.id);
      const { data: rows, error: e } = await sb
        .from('members')
        .select('household_id, role, households(name)')
        .eq('user_id', user.id)
        .is('revoked_at', null);
      if (e) throw e;
      const ms: Membership[] = (rows ?? []).map((r: any) => ({
        household_id: r.household_id,
        role: r.role,
        name: r.households?.name ?? 'Household',
      }));
      if (ms.length === 0) {
        router.replace('/welcome');
        return;
      }
      setMemberships(ms);
      const saved = readActive();
      const hid = ms.find((m) => m.household_id === saved)?.household_id ?? ms[0].household_id;
      activeRef.current = hid;
      setActiveId(hid);
      await loadHousehold(hid, user.id);
      setPhase('ready');
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong');
      setPhase('error');
    }
  }, [loadHousehold, pathname, router]);

  useEffect(() => {
    if (isConfigured) boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sign-out in another tab, or an expired session, sends us back to login.
  useEffect(() => {
    if (!isConfigured) return;
    const { data: sub } = supabase().auth.onAuthStateChange((evt) => {
      if (evt === 'SIGNED_OUT') router.replace('/login');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

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
          await loadHousehold(activeId, userId);
          setRev((r) => r + 1);
        } catch (e: any) {
          // Most likely access was revoked / sitter window ended.
          setError(e?.message ?? 'Lost access');
          setPhase('error');
        }
      }, 250);
    };
    const ch = sb.channel(`hub-${activeId}`);
    for (const table of ['members', 'pets', 'tasks', 'occurrences', 'events', 'rewards', 'redemptions', 'points_ledger', 'households']) {
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
  }, [phase, activeId, userId, loadHousehold]);

  const reload = useCallback(async () => {
    if (!activeRef.current || !userId) return;
    await loadHousehold(activeRef.current, userId);
    setRev((r) => r + 1);
  }, [loadHousehold, userId]);

  const switchHousehold = useCallback((id: string) => {
    try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* ignore */ }
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
        <button className="btn" onClick={() => supabase().auth.signOut().then(() => router.replace('/login'))}>
          Sign out
        </button>
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

/** Occurrences (with their tasks) between two dates, kept fresh via realtime. */
export function useOccurrences(from: string, to: string) {
  const { household, tasks, rev } = useHub();
  const [rows, setRows] = useState<OccWithTask[]>([]);
  const [loading, setLoading] = useState(true);
  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  useEffect(() => {
    let live = true;
    (async () => {
      const sb = supabase();
      await sb.rpc('ensure_occurrences', { p_household: household.id, p_from: from, p_to: to });
      const { data } = await sb
        .from('occurrences')
        .select('*')
        .eq('household_id', household.id)
        .gte('due_date', from)
        .lte('due_date', to);
      if (!live) return;
      const out: OccWithTask[] = [];
      for (const o of data ?? []) {
        const t = tasksById.get(o.task_id);
        if (t) out.push({ ...o, task: t });
      }
      setRows(out);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, [household.id, from, to, rev, tasksById]);

  return { rows, loading };
}

export const rpc = async <T = unknown,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};
