export type Role = 'owner' | 'adult' | 'child' | 'sitter';

export const roleLabel = (r: Role) => (r === 'owner' ? 'Owner' : r === 'adult' ? 'Adult' : r === 'child' ? 'Child' : 'Pet sitter');

export type Household = { id: string; name: string; family_bonus_pct: number; sitter_info: string };

export type Member = {
  id: string;
  household_id: string;
  user_id: string | null;
  display_name: string;
  role: Role;
  color: string;
  sitter_start: string | null;
  sitter_end: string | null;
  revoked_at: string | null;
};

export type Pet = {
  id: string;
  household_id: string;
  name: string;
  species: 'dog' | 'cat' | 'chicken' | 'other';
  breed: string;
  instructions: string;
  guest_visible: boolean;
  archived: boolean;
};

export type Recurrence =
  | { type: 'once' }
  | { type: 'daily' }
  | { type: 'weekdays'; days: number[] }
  | { type: 'interval'; every: number };

export type Task = {
  id: string;
  household_id: string;
  title: string;
  category: string;
  routine: 'morning' | 'evening' | null;
  assignee_member_id: string | null;
  pet_id: string | null;
  points: number;
  points_eligible: boolean;
  instructions: string;
  due_time: string | null;
  recurrence: Recurrence;
  /** When occurrences are missed: 'each' = every one must be done; 'catch_up' = one completion settles them all. */
  overdue_mode: 'each' | 'catch_up';
  start_date: string;
  end_date: string | null;
  /** Days before the due date that an occurrence starts showing as "Coming up"; null = only on its due date. 1–30. */
  visible_days_before: number | null;
  guest_visible: boolean;
  archived: boolean;
  /** Set by "Clear overdue": days up to here are never re-created. */
  reset_through: string | null;
};

export type Occurrence = {
  id: string;
  household_id: string;
  task_id: string;
  due_date: string;
  status: 'pending' | 'done' | 'covered';
  completed_by: string | null;
  completed_at: string | null;
  note: string | null;
  points_awarded: number;
  awarded_to: string | null;
};

export type CalEvent = {
  id: string;
  household_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  notes: string;
};

export type Reward = { id: string; household_id: string; title: string; cost: number; kind: 'individual' | 'family'; active: boolean };

export type Redemption = {
  id: string;
  household_id: string;
  reward_id: string;
  member_id: string | null;
  reward_title: string;
  cost: number;
  status: 'pending' | 'approved' | 'denied';
  requested_by: string | null;
  created_at: string;
};

export type LedgerRow = {
  id: string;
  scope: 'member' | 'family';
  member_id: string | null;
  delta: number;
  kind: 'earn' | 'family_bonus' | 'reverse' | 'redeem' | 'adjust';
  note: string | null;
  created_at: string;
};

export type PetNote = { id: string; pet_id: string; author_member_id: string; body: string; created_at: string };

export type OccWithTask = Occurrence & { task: Task };
