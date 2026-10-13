export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const FULL_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local clock time as HH:MM (the format of <input type=time> and task due times). */
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Local calendar date (YYYY-MM-DD) of an ISO timestamp. */
export const tsToDate = (ts: string) => iso(new Date(ts));

/** Combine a local YYYY-MM-DD and HH:MM into an ISO timestamp. */
export function localToTs(day: string, time = '00:00'): string {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

/** Local calendar date as YYYY-MM-DD (not UTC). */
export function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export const today = () => iso(new Date());
export function addDays(s: string, n: number): string {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}
export function startOfMonthGrid(s: string): string {
  const d = parseISO(s);
  d.setDate(1);
  d.setDate(1 - d.getDay());
  return iso(d);
}
export function fmtDate(s: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' }) {
  return parseISO(s).toLocaleDateString(undefined, opts);
}
/** '07:30:00' -> '7:30 AM' */
export function fmtTime(t: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function fmtDateTime(ts: string) {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
/** Local start/end-of-day as ISO timestamps for a YYYY-MM-DD pair (sitter windows). */
export const dayStartTs = (s: string) => parseISO(s).toISOString();
export const dayEndTs = (s: string) => {
  const d = parseISO(s);
  d.setHours(23, 59, 59, 0);
  return d.toISOString();
};

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
