import { describe, expect, it } from 'vitest';
import { addDays, hhmm, iso, localToTs, parseISO, startOfMonthGrid, tsToDate } from '../src/lib/dates';
import { describeRecurrence } from '../src/lib/recurrence';

describe('dates', () => {
  it('round-trips local dates without UTC drift', () => {
    expect(iso(parseISO('2025-03-09'))).toBe('2025-03-09');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28');
  });
  it('month grid starts on the Sunday on/before the 1st', () => {
    expect(startOfMonthGrid('2025-06-15')).toBe('2025-06-01'); // 1 June 2025 is a Sunday
    expect(startOfMonthGrid('2025-07-10')).toBe('2025-06-29');
  });
  it('combines local date+time into a timestamp and back', () => {
    const ts = localToTs('2025-05-04', '13:45');
    expect(tsToDate(ts)).toBe('2025-05-04');
    expect(hhmm(new Date(ts))).toBe('13:45');
  });
});

describe('describeRecurrence', () => {
  it('summarises common patterns', () => {
    expect(describeRecurrence({ type: 'once' })).toBe('One time');
    expect(describeRecurrence({ type: 'daily' })).toBe('Every day');
    expect(describeRecurrence({ type: 'weekdays', days: [1, 2, 3, 4, 5] })).toBe('Weekdays');
    expect(describeRecurrence({ type: 'weekdays', days: [6, 0] })).toBe('Weekends');
    expect(describeRecurrence({ type: 'weekdays', days: [1, 3] })).toBe('Mon, Wed');
    expect(describeRecurrence({ type: 'interval', every: 3 })).toBe('Every 3 days');
  });
});
