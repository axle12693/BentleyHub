export const FALLBACK_CATEGORY = 'Other';
export const DEFAULT_CATEGORY = 'Chores';
export const PET_CATEGORY = 'Animal care';
export const MAX_CATEGORY_LENGTH = 40;
export const DEFAULT_CATEGORIES = [DEFAULT_CATEGORY, PET_CATEGORY, 'Kitchen', 'Laundry', 'Outdoors', 'Kids', 'Errands', FALLBACK_CATEGORY];

// Case-insensitive de-dupe; first spelling wins.
export function uniqueCategories(list: string[]) {
  const seen = new Map<string, string>();
  for (const c of list) {
    const v = c.trim();
    if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
  }
  return [...seen.values()];
}

// Maps a raw category to the matching option's spelling (or its trimmed self).
export function canonicalCategory(raw: string, options: string[]) {
  const v = raw.trim();
  return options.find((c) => c.toLowerCase() === v.toLowerCase()) ?? v;
}
