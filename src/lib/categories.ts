export const DEFAULT_CATEGORIES = ['Chores', 'Animal care', 'Kitchen', 'Laundry', 'Outdoors', 'Kids', 'Errands', 'Other'];

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
