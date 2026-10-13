'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { errMsg } from '@/lib/api';
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

export const MEMBER_COLORS = ['#8BA888', '#C9A87C', '#9BB5C9', '#C99BA8', '#B0A1CC', '#D6B05E', '#7FB3A6'];

export function ColorPick({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="row wrap">
      {MEMBER_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={c}
          onClick={() => onChange(c)}
          style={{ width: 34, height: 34, borderRadius: '50%', background: c, border: value === c ? '3px solid var(--ink)' : '3px solid transparent', cursor: 'pointer' }}
        />
      ))}
    </div>
  );
}

/** "First day / Last day" pair of date inputs (the end can't precede the start). */
export function DateRangeFields({ start, end, onStart, onEnd }: { start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void }) {
  return (
    <div className="two">
      <div><label>First day</label><input type="date" required value={start} onChange={(e) => onStart(e.target.value)} /></div>
      <div><label>Last day</label><input type="date" required value={end} min={start} onChange={(e) => onEnd(e.target.value)} /></div>
    </div>
  );
}

export const FormError = ({ error }: { error: string }) => (error ? <div className="error">{error}</div> : null);
