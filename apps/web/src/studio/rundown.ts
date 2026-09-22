export type RundownItem =
  | { id: string; type: 'lower_third'; title: string; line1: string; line2: string }
  | { id: string; type: 'text'; title: string; detail: string }
  | {
      id: string;
      type: 'image';
      title: string;
      fit: 'contain' | 'fill';
      bitmap: ImageBitmap | null;
    };

const KEY = 'rs.rundown.v1';

/** Convenience persistence only (SPEC: presets move to the server in WP1). Images are not persisted. */
export function loadRundown(): RundownItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const items = JSON.parse(raw) as RundownItem[];
    return items.map((i) => (i.type === 'image' ? { ...i, bitmap: null } : i));
  } catch {
    return [];
  }
}

export function saveRundown(items: RundownItem[]): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(items.map((i) => (i.type === 'image' ? { ...i, bitmap: null } : i))),
    );
  } catch {
    /* storage unavailable */
  }
}

export function newId(): string {
  return crypto.randomUUID();
}
