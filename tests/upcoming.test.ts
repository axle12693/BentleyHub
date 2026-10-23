import { describe, expect, it } from 'vitest';
import { MAX_VISIBLE_DAYS, doneOn, maxLead, upcomingOccs } from '../src/lib/upcoming';

const task = (o: Record<string, unknown> = {}) => ({ id: 't1', title: 'T', due_time: null, visible_days_before: 3, overdue_mode: 'each', ...o }) as any;
const occ = (due_date: string, t = task(), status = 'pending') => ({ id: `${t.id}-${due_date}`, task_id: t.id, due_date, status, task: t }) as any;
const byTime = () => 0;

describe('upcoming', () => {
  it('skips tasks that already have a row today', () => {
    expect(upcomingOccs([occ('2025-01-01'), occ('2025-01-02')], '2025-01-01', byTime)).toEqual([]);
  });
  it('shows only the next occurrence per task inside the lead window', () => {
    const rows = [occ('2025-01-02'), occ('2025-01-03'), occ('2025-01-05'), occ('2025-01-10')];
    expect(upcomingOccs(rows, '2025-01-01', byTime).map((r) => r.due_date)).toEqual(['2025-01-02']);
  });
  it('with `after`, skips days already listed and surfaces the next occurrence beyond them', () => {
    const t = task({ visible_days_before: 10 });
    const rows = [occ('2025-01-02', t), occ('2025-01-07', t)];
    expect(upcomingOccs(rows, '2025-01-01', byTime, '2025-01-03').map((r) => r.due_date)).toEqual(['2025-01-07']);
  });
  it('ignores today, done and tasks without a lead, but includes catch_up', () => {
    const cu = task({ id: 'c', overdue_mode: 'catch_up' });
    const none = task({ id: 'n', visible_days_before: null });
    const rows = [occ('2025-01-01'), occ('2025-01-02', task({ id: 'd' }), 'done'), occ('2025-01-02', none)];
    expect(upcomingOccs(rows, '2025-01-01', byTime)).toEqual([]);
    expect(upcomingOccs([occ('2025-01-02', cu)], '2025-01-01', byTime)).toHaveLength(1);
  });
  it('maxLead caps at 30', () => {
    expect(maxLead([task({ visible_days_before: 5 }), task({ visible_days_before: 20, overdue_mode: 'catch_up' })])).toBe(20);
    expect(maxLead([task({ visible_days_before: 99 })])).toBe(30);
    expect(maxLead([task({ visible_days_before: 9, archived: true })])).toBe(0);
    expect(maxLead([])).toBe(0);
  });
});

describe('doneOn', () => {
  it('uses completion day, else due date', () => {
    expect(doneOn({ due_date: '2025-01-01', completed_at: null } as any)).toBe('2025-01-01');
    expect(doneOn({ due_date: '2025-01-01', completed_at: new Date(2025, 0, 5, 12).toISOString() } as any)).toBe('2025-01-05');
  });
});

describe('MAX_VISIBLE_DAYS', () => {
  it('matches the cap in migration 0011', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync(new URL('../supabase/migrations/0011_visible_before_due.sql', import.meta.url), 'utf8');
    expect(sql).toContain(`between 1 and ${MAX_VISIBLE_DAYS})`);
  });
});
