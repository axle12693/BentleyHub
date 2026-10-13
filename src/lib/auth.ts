'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { isConfigured, supabase } from './supabase';

const ACTIVE_KEY = 'bhh.household';

export const getActiveHousehold = (): string | null => {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
};
export const setActiveHousehold = (id: string) => {
  try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* storage unavailable */ }
};

/** Only allow same-site relative redirects. */
export const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

export const loginUrl = (next?: string) => (next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login');

/** Signs out and returns to the login screen. */
export function useSignOut() {
  const router = useRouter();
  return useCallback(async () => {
    await supabase().auth.signOut();
    router.replace('/login');
  }, [router]);
}

/** For pages outside the hub: true once a session exists, otherwise bounces to login (then back to `next`). */
export function useRequireSession(next: string): boolean {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (!isConfigured) return;
    let live = true;
    supabase().auth.getSession().then(({ data }) => {
      if (!live) return;
      if (data.session) setOk(true);
      else router.replace(loginUrl(next));
    });
    return () => { live = false; };
  }, [next, router]);
  return ok;
}
