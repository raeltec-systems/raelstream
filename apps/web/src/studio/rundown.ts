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

/** Server form: images are kept in memory only until the asset pipeline (M6). */
export function toServerRundown(items: RundownItem[]) {
  return items.map((i) =>
    i.type === 'image' ? { id: i.id, type: i.type, title: i.title, fit: i.fit } : i,
  );
}

/** Rebuild the rundown from the server, reattaching any images already loaded in this tab. */
export function fromServerRundown(
  items: unknown[],
  bitmaps: Map<string, ImageBitmap>,
): RundownItem[] {
  return (items as RundownItem[]).map((i) =>
    i.type === 'image' ? { ...i, bitmap: bitmaps.get(i.id) ?? null } : i,
  );
}

export function newId(): string {
  return crypto.randomUUID();
}
