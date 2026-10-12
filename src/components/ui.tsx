'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { Member } from '@/lib/types';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Avatar({ member, large }: { member?: Pick<Member, 'display_name' | 'color'> | null; large?: boolean }) {
  if (!member) return <span className={`avatar ${large ? 'lg' : ''}`} style={{ background: '#b9b29c' }}>★</span>;
  return (
    <span className={`avatar ${large ? 'lg' : ''}`} style={{ background: member.color }} title={member.display_name}>
      {member.display_name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/* Tiny toast system: call toast('Saved') from anywhere. */
type ToastMsg = { id: number; text: string; err: boolean };
export function toast(text: string, err = false) {
  window.dispatchEvent(new CustomEvent('bhh-toast', { detail: { text, err } }));
}
export function ToastHost() {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { text: string; err: boolean };
      setMsg({ id: Date.now(), ...d });
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), d.err ? 4500 : 2200);
    };
    window.addEventListener('bhh-toast', on);
    return () => {
      window.removeEventListener('bhh-toast', on);
      clearTimeout(timer);
    };
  }, []);
  if (!msg) return null;
  return (
    <div className={`toast ${msg.err ? 'err' : ''}`} role="status">
      {msg.text}
    </div>
  );
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs an async action, surfacing failures as a toast. Returns true on success. */
export async function attempt(fn: () => Promise<unknown>, okMsg?: string): Promise<boolean> {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(errMsg(e), true);
    return false;
  }
}

export function SegControl<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} type="button" className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export const speciesEmoji = (s: string) => (s === 'dog' ? '🐕' : s === 'cat' ? '🐈' : s === 'chicken' ? '🐔' : '🐾');

export const roleLabel = (r: Member['role']) =>
  r === 'owner' ? 'Owner' : r === 'adult' ? 'Adult' : r === 'child' ? 'Child' : 'Pet sitter';
