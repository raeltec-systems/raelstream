/** Scene model shared by the studio UI and compositor (PLAN D-5: design's four scenes + rundown items). */
export type SceneKind = 'camera_lower_third' | 'camera' | 'text' | 'slate' | 'image';

export interface LowerThird {
  line1: string;
  line2: string;
}
export interface TextCard {
  title: string;
  detail: string;
}

export interface ProgrammeTheme {
  accent: string;
  accentDark: string;
  /** Font family for on-air graphics (church theme font). */
  font: string;
  background: string;
  churchName: string;
  serviceName: string;
  logo: ImageBitmap | null;
}

export interface SceneState {
  kind: SceneKind;
  lowerThird: LowerThird | null;
  text: TextCard | null;
  image: ImageBitmap | null;
  imageFit: 'contain' | 'fill';
  framing: 'contain' | 'fill';
}

export const DEFAULT_THEME: ProgrammeTheme = {
  accent: '#2F6FCF',
  accentDark: '#6EA2F0',
  font: "'Bricolage Grotesque Variable', 'Bricolage Grotesque', sans-serif",
  background: '#161A18',
  churchName: '',
  serviceName: '',
  logo: null,
};

/** Characters beyond this are shortened on air (design: Rundown helper). */
export const LOWER_THIRD_MAX = 40;

export function shortenForAir(text: string, max = LOWER_THIRD_MAX): string {
  const t = text.trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}

/** Contain/fill placement of a source rectangle into a destination rectangle. */
export function fitRect(sw: number, sh: number, dw: number, dh: number, mode: 'contain' | 'fill') {
  const scale = mode === 'contain' ? Math.min(dw / sw, dh / sh) : Math.max(dw / sw, dh / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}
