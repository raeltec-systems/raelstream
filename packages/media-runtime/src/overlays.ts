import {
  type ProgrammeTheme,
  type SceneState,
  type TextCard,
  fitRect,
  shortenForAir,
} from './scenes.js';

/** Reference frame: everything is laid out at 1920×1080 and scaled to the profile (SPEC §10.2). */
export const REF_W = 1920;
export const REF_H = 1080;
const SAFE = 64;
const LOGO_MARGIN = 48;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Text card auto-fit (SPEC §10.3): body 64 px down to 36 px at 1080p, at most 10 lines. */
export const TEXT_MAX_PX = 64;
export const TEXT_MIN_PX = 36;
export const TEXT_MAX_LINES = 10;

export interface TextLayout {
  titlePx: number;
  bodyPx: number;
  lines: string[];
  fits: boolean;
}

/** Greedy word wrap; a single word longer than the width is split. */
export function wrapText(g: Ctx, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (g.measureText(next).width <= maxWidth) {
        line = next;
        continue;
      }
      if (line) out.push(line);
      if (g.measureText(w).width <= maxWidth) {
        line = w;
        continue;
      }
      let chunk = '';
      for (const ch of w) {
        if (g.measureText(chunk + ch).width > maxWidth && chunk) {
          out.push(chunk);
          chunk = ch;
        } else chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

export function layoutTextCard(g: Ctx, text: TextCard, font: string): TextLayout {
  const width = REF_W - SAFE * 2 - 120;
  let titlePx = 96;
  g.font = `700 ${titlePx}px ${font}`;
  while (titlePx > 56 && g.measureText(text.title).width > width) {
    titlePx -= 4;
    g.font = `700 ${titlePx}px ${font}`;
  }
  const body = text.detail.trim();
  if (!body) return { titlePx, bodyPx: TEXT_MAX_PX, lines: [], fits: true };
  const reserved = (text.title ? titlePx * 1.6 : 0) + (text.reference ? 90 : 0);
  const avail = REF_H - SAFE * 2 - 80 - reserved;
  for (let px = TEXT_MAX_PX; px >= TEXT_MIN_PX; px -= 4) {
    g.font = `400 ${px}px ${font}`;
    const lines = wrapText(g, body, width);
    if (lines.length <= TEXT_MAX_LINES && lines.length * px * 1.3 <= avail)
      return { titlePx, bodyPx: px, lines, fits: true };
  }
  g.font = `400 ${TEXT_MIN_PX}px ${font}`;
  return { titlePx, bodyPx: TEXT_MIN_PX, lines: wrapText(g, body, width), fits: false };
}

/** Whether a text card fits before it may be applied (SPEC §10.3: Apply is blocked otherwise). */
export function textCardFits(text: TextCard, font: string): boolean {
  const g = new OffscreenCanvas(8, 8).getContext('2d');
  return g ? layoutTextCard(g, text, font).fits : true;
}

function logoBox(th: ProgrammeTheme): { w: number; h: number } | null {
  if (!th.logo) return null;
  const w = REF_W * th.logoScale;
  return { w, h: Math.min((th.logo.height / th.logo.width) * w, REF_H * 0.25) };
}

function drawLogo(g: Ctx, th: ProgrammeTheme): void {
  const box = logoBox(th);
  if (!box || !th.logo) return;
  const { w, h } = box;
  const r = fitRect(th.logo.width, th.logo.height, w, h, 'contain');
  const right = th.logoCorner === 'tr' || th.logoCorner === 'br';
  const bottom = th.logoCorner === 'bl' || th.logoCorner === 'br';
  const x = right ? REF_W - LOGO_MARGIN - w : LOGO_MARGIN;
  const y = bottom ? REF_H - LOGO_MARGIN - h : LOGO_MARGIN;
  g.drawImage(th.logo, x + r.x, y + r.y, r.w, r.h);
}

/**
 * Static graphics for a scene, drawn once per change into a 1920×1080 layer (the compositor then
 * draws at most video + this layer per tick). Also used for previews in Settings.
 */
export function drawOverlay(g: Ctx, scene: SceneState, th: ProgrammeTheme): void {
  const font = th.font;
  if (scene.kind === 'slate') {
    g.fillStyle = th.background;
    g.fillRect(0, 0, REF_W, REF_H);
    if (th.holding) {
      const r = fitRect(th.holding.width, th.holding.height, REF_W, REF_H, 'contain');
      g.drawImage(th.holding, r.x, r.y, r.w, r.h);
      return; // the church's own holding image says it all
    }
    if (th.logo) {
      const r = fitRect(th.logo.width, th.logo.height, 260, 220, 'contain');
      g.drawImage(th.logo, (REF_W - 260) / 2 + r.x, 250 + r.y, r.w, r.h);
    }
    g.fillStyle = '#F7F6F0';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 124px ${font}`;
    g.fillText("We'll be right back", REF_W / 2, 580, REF_W - SAFE * 2);
    g.fillStyle = '#B9BFB9';
    g.font = `400 44px ${font}`;
    const sub = [th.churchName, th.serviceName].filter(Boolean).join(' · ');
    if (sub) g.fillText(sub, REF_W / 2, 690, REF_W - SAFE * 2);
    g.fillStyle = th.accent;
    g.fillRect(0, REF_H - 18, REF_W, 18);
    return;
  }
  if (scene.kind === 'camera_lower_third' && scene.lowerThird) {
    const l1 = shortenForAir(scene.lowerThird.line1);
    const l2 = shortenForAir(scene.lowerThird.line2);
    const x = REF_W * 0.06;
    // A bottom-left logo would sit under the bar: lift the bar above it.
    const logo = th.logoCorner === 'bl' ? logoBox(th) : null;
    const bottom = Math.min(REF_H * (1 - 0.09), logo ? REF_H - LOGO_MARGIN - logo.h - 24 : REF_H);
    g.font = `700 60px ${font}`;
    const w1 = g.measureText(l1).width;
    g.font = `700 38px ${font}`;
    const w2 = l2 ? g.measureText(l2).width : 0;
    const padX = 54;
    const barW = 22;
    const w = Math.min(Math.max(w1, w2) + padX * 2, REF_W - x - SAFE - barW);
    const h = l2 ? 170 : 118;
    const y = bottom - h;
    g.save();
    g.beginPath();
    g.roundRect(x, y, barW + w, h, 34);
    g.clip();
    g.fillStyle = th.accent;
    g.fillRect(x, y, barW, h);
    g.fillStyle = '#FFFFFF';
    g.fillRect(x + barW, y, w, h);
    g.restore();
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = th.secondary;
    g.font = `700 60px ${font}`;
    g.fillText(l1, x + barW + padX, y + (l2 ? 82 : 78), w - padX * 2);
    if (l2) {
      g.fillStyle = th.accent;
      g.font = `700 38px ${font}`;
      g.fillText(l2, x + barW + padX, y + 136, w - padX * 2);
    }
  } else if (scene.kind === 'text' && scene.text) {
    const t = scene.text;
    const lay = layoutTextCard(g, t, font);
    const lineH = lay.bodyPx * 1.3;
    const titleH = t.title ? lay.titlePx * 1.6 : 0;
    const refH = t.reference ? 90 : 0;
    const blockH = titleH + lay.lines.length * lineH + refH;
    let y = (REF_H - blockH) / 2;
    g.fillStyle = '#FFFFFF';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    if (t.title) {
      g.font = `700 ${lay.titlePx}px ${font}`;
      g.fillText(t.title, REF_W / 2, y, REF_W - SAFE * 2);
      y += titleH;
    }
    g.font = `400 ${lay.bodyPx}px ${font}`;
    for (const line of lay.lines) {
      g.fillText(line, REF_W / 2, y, REF_W - SAFE * 2);
      y += lineH;
    }
    if (t.reference) {
      g.globalAlpha = 0.85;
      g.font = `700 44px ${font}`;
      g.fillText(t.reference, REF_W / 2, y + 30, REF_W - SAFE * 2);
      g.globalAlpha = 1;
    }
  }
  drawLogo(g, th);
}
