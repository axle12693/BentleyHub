import { DAY_NAMES } from './dates';
import type { Recurrence } from './types';

export function describeRecurrence(r: Recurrence): string {
  switch (r.type) {
    case 'once':
      return 'One time';
    case 'daily':
      return 'Every day';
    case 'weekdays': {
      const days = [...r.days].sort();
      if (days.length === 7) return 'Every day';
      if (days.length === 5 && !days.includes(0) && !days.includes(6)) return 'Weekdays';
      if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends';
      return days.map((d) => DAY_NAMES[d]).join(', ') || 'No days selected';
    }
    case 'interval':
      return r.every === 1 ? 'Every day' : `Every ${r.every} days`;
  }
}
