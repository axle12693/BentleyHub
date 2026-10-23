import { describe, expect, it } from 'vitest';
import { isHidden, nextUnhideIn, refreshClock } from '../src/lib/hidden';

const at = (ms: number) => new Date(ms).toISOString();

describe('hidden tasks', () => {
  it('is hidden only while hidden_until is in the future', () => {
    expect(isHidden({ hidden_until: null }, 1000)).toBe(false);
    expect(isHidden({ hidden_until: at(2000) }, 1000)).toBe(true);
    expect(isHidden({ hidden_until: at(1000) }, 1000)).toBe(false);
  });
  it('advances a stale clock past a hide that expired meanwhile', () => {
    expect(refreshClock([{ hidden_until: at(2000) }], 1000, 5000)).toBe(5000);
    expect(refreshClock([{ hidden_until: at(2000) }], 1000, 1500)).toBe(1000); // still hidden: the timer handles it
    expect(refreshClock([{ hidden_until: at(500) }], 1000, 5000)).toBe(1000); // expired before the last tick
    expect(refreshClock([{ hidden_until: null }], 1000, 5000)).toBe(1000);
  });
  it('waits for the soonest hide that is still active', () => {
    expect(nextUnhideIn([], 1000)).toBeNull();
    expect(nextUnhideIn([{ hidden_until: at(500) }, { hidden_until: null }], 1000)).toBeNull();
    expect(nextUnhideIn([{ hidden_until: at(5000) }, { hidden_until: at(2000) }, { hidden_until: at(500) }], 1000)).toBe(1000);
  });
});
