export type RundownItem =
  | { id: string; type: 'lower_third'; title: string; line1: string; line2: string }
  | { id: string; type: 'text'; title: string; detail: string; reference?: string }
  | {
      id: string;
      type: 'image';
      title: string;
      fit: 'contain' | 'fill';
      /** Uploaded, checked image on the server (SPEC §10.6); null while uploading or if refused. */
      assetId: string | null;
      bitmap: ImageBitmap | null;
    };

/** Server form: images travel as asset references, never pixels. */
export function toServerRundown(items: RundownItem[]) {
  return items.map((i) =>
    i.type === 'image'
      ? { id: i.id, type: i.type, title: i.title, fit: i.fit, assetId: i.assetId }
      : i,
  );
}

/** Rebuild the rundown from the server; images decode afterwards (see `StudioRuntime.loadImages`). */
export function fromServerRundown(
  items: unknown[],
  bitmaps: Map<string, ImageBitmap>,
): RundownItem[] {
  return (items as RundownItem[]).map((i) =>
    i.type === 'image'
      ? { ...i, assetId: i.assetId ?? null, bitmap: bitmaps.get(i.id) ?? null }
      : i,
  );
}

export function newId(): string {
  return crypto.randomUUID();
}
