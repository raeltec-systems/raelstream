import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CHURCH_THEME,
  MIN_TEXT_CONTRAST,
  THEME_FONTS,
  contrastRatio,
  type Theme,
  type ThemeFont,
} from '@raelstream/contracts';
import {
  DEFAULT_THEME,
  REF_H,
  REF_W,
  drawLowerThird,
  drawOverlay,
  lowerThirdInMs,
  lowerThirdMotion,
  type SceneState,
} from '@raelstream/media-runtime';
import { Button, Segmented, TextField } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { api, ApiFailure, uploadAsset } from '../lib/api.js';
import { assetBitmap, programmeTheme } from '../lib/theme.js';
import { studioRuntime } from './runtime.js';
import s from './StudioApp.module.css';

type PreviewScene = 'camera_lower_third' | 'text' | 'slate';

const FONT_LABEL: Record<ThemeFont, string> = {
  inter: 'Inter',
  source_serif_4: 'Source Serif',
  atkinson: 'Atkinson',
};

const SAMPLE: Record<PreviewScene, SceneState> = {
  camera_lower_third: {
    kind: 'camera_lower_third',
    lowerThird: { line1: 'Pastor Mwansa Banda', line2: 'Sunday sermon · Psalm 23' },
    text: null,
    image: null,
    imageFit: 'contain',
    framing: 'contain',
  },
  text: {
    kind: 'text',
    lowerThird: null,
    text: {
      title: 'Psalm 23',
      detail:
        'The Lord is my shepherd; I shall not want. He makes me lie down in green pastures. He leads me beside still waters.',
      reference: 'Psalm 23:1–2',
    },
    image: null,
    imageFit: 'contain',
    framing: 'contain',
  },
  slate: {
    kind: 'slate',
    lowerThird: null,
    text: null,
    image: null,
    imageFit: 'contain',
    framing: 'contain',
  },
};

/**
 * The church's on-air look (SPEC §10.5): logo, colours, font and holding image. The UI chrome stays
 * neutral; this only changes what viewers see. The preview uses the programme's own drawing code.
 */
export function ThemeEditor() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_CHURCH_THEME);
  const [saved, setSaved] = useState<Theme | null>(null);
  const [scene, setScene] = useState<PreviewScene>('camera_lower_third');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'logo' | 'holding' | 'save'>(null);
  // Bumped to play the lower-third animation again in the preview.
  const [replay, setReplay] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    void api<Theme>('GET', '/api/theme').then((th) => {
      setTheme(th);
      setSaved(th);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    void programmeTheme(theme).then((pt) => {
      const c = canvas.current;
      if (cancelled || !c) return;
      const g = c.getContext('2d')!;
      const th = { ...DEFAULT_THEME, ...pt, serviceName: 'Sunday Service' };
      // The lower third on its own layer, animated in the chosen style, as on air.
      const layer = new OffscreenCanvas(REF_W, REF_H);
      const bounds = drawLowerThird(layer.getContext('2d')!, SAMPLE[scene], th);
      const started = performance.now();
      const paint = () => {
        g.setTransform(c.width / REF_W, 0, 0, c.height / REF_H, 0, 0);
        // Stand-in for the camera picture under the lower third.
        g.fillStyle = scene === 'text' ? theme.primaryColor : '#5b6660';
        g.fillRect(0, 0, REF_W, REF_H);
        if (scene === 'camera_lower_third') {
          g.fillStyle = '#7d8a83';
          g.beginPath();
          g.arc(REF_W / 2, REF_H * 0.42, 190, 0, Math.PI * 2);
          g.fill();
          g.fillRect(REF_W / 2 - 330, REF_H * 0.62, 660, 420);
        }
        const since = performance.now() - started;
        if (bounds) {
          const m = lowerThirdMotion(since, false, theme.lowerThirdMotion);
          g.save();
          g.globalAlpha = m.alpha;
          g.beginPath();
          g.rect(bounds.x, bounds.y - 2, bounds.w * m.reveal, bounds.h + 4);
          g.clip();
          g.drawImage(layer, m.dx, 0);
          g.restore();
        }
        drawOverlay(g, SAMPLE[scene], th, false);
        if (bounds && since < lowerThirdInMs(theme.lowerThirdMotion))
          frame = requestAnimationFrame(paint);
      };
      paint();
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [theme, scene, replay]);

  const contrast = contrastRatio(theme.primaryColor, '#FFFFFF');
  const readable = contrast >= MIN_TEXT_CONTRAST;
  const dirty = JSON.stringify(theme) !== JSON.stringify(saved);

  async function pick(kind: 'logo' | 'holding', file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(kind);
    try {
      const a = await uploadAsset(file);
      await assetBitmap(a.id);
      setTheme((th) => ({ ...th, [kind === 'logo' ? 'logoAssetId' : 'holdingAssetId']: a.id }));
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : t('rundown.imageUploadFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setError(null);
    setBusy('save');
    try {
      const th = await api<Theme>('PUT', '/api/theme', theme);
      setSaved(th);
      setTheme(th);
      await studioRuntime().loadTheme(); // the programme picks it up at once
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="rs-theme-title" className={s.themeEditor}>
      <h2 className="rs-title" id="rs-theme-title">
        {t('theme.title')}
      </h2>
      <p className={s.note}>{t('theme.body')}</p>
      <div className={s.themeGrid}>
        <div className={s.themeForm}>
          <TextField
            label={t('theme.churchName')}
            value={theme.churchName}
            maxLength={60}
            onChange={(e) => setTheme({ ...theme, churchName: e.target.value })}
          />
          <div>
            <div className={s.fieldLabel}>{t('theme.logo')}</div>
            <div className={s.top}>
              <label className={s.fileButton}>
                {busy === 'logo'
                  ? t('rundown.imageChecking')
                  : theme.logoAssetId
                    ? t('theme.replace')
                    : t('theme.upload')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={t('theme.logo')}
                  onChange={(e) => {
                    void pick('logo', e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {theme.logoAssetId && (
                <Button size="dense" onClick={() => setTheme({ ...theme, logoAssetId: null })}>
                  {t('theme.remove')}
                </Button>
              )}
            </div>
            <p className={s.note}>{t('theme.logoHelp')}</p>
          </div>
          {theme.logoAssetId && (
            <>
              <Segmented<Theme['logoCorner']>
                label={t('theme.corner')}
                value={theme.logoCorner}
                onChange={(logoCorner) => setTheme({ ...theme, logoCorner })}
                options={[
                  { value: 'tl', label: t('theme.corner.tl') },
                  { value: 'tr', label: t('theme.corner.tr') },
                  { value: 'bl', label: t('theme.corner.bl') },
                  { value: 'br', label: t('theme.corner.br') },
                ]}
              />
              <label className={s.fieldLabel} htmlFor="rs-logo-size">
                {t('theme.size', { pct: Math.round(theme.logoScale * 100) })}
              </label>
              <input
                id="rs-logo-size"
                type="range"
                min={6}
                max={15}
                step={1}
                value={Math.round(theme.logoScale * 100)}
                onChange={(e) => setTheme({ ...theme, logoScale: Number(e.target.value) / 100 })}
              />
            </>
          )}
          <div className={s.colours}>
            <label className={s.colour}>
              <input
                type="color"
                value={theme.primaryColor}
                onChange={(e) => setTheme({ ...theme, primaryColor: e.target.value.toUpperCase() })}
              />
              <span>{t('theme.primary')}</span>
            </label>
            <label className={s.colour}>
              <input
                type="color"
                value={theme.secondaryColor}
                onChange={(e) =>
                  setTheme({ ...theme, secondaryColor: e.target.value.toUpperCase() })
                }
              />
              <span>{t('theme.secondary')}</span>
            </label>
            <label className={s.colour}>
              <input
                type="color"
                value={theme.backgroundColor}
                onChange={(e) =>
                  setTheme({ ...theme, backgroundColor: e.target.value.toUpperCase() })
                }
              />
              <span>{t('theme.background')}</span>
            </label>
          </div>
          <p className={readable ? s.note : s.warnText} role={readable ? undefined : 'alert'}>
            {t(readable ? 'theme.contrastOk' : 'theme.contrastLow', {
              ratio: contrast.toFixed(1),
            })}
          </p>
          <Segmented<Theme['lowerThirdMotion']>
            label={t('theme.lowerThirdMotion')}
            value={theme.lowerThirdMotion}
            onChange={(lowerThirdMotion) => {
              setTheme({ ...theme, lowerThirdMotion });
              setScene('camera_lower_third');
            }}
            options={[
              { value: 'slide', label: t('theme.motion.slide') },
              { value: 'wipe', label: t('theme.motion.wipe') },
              { value: 'fade', label: t('theme.motion.fade') },
              { value: 'none', label: t('theme.motion.none') },
            ]}
          />
          <Segmented<ThemeFont>
            label={t('theme.font')}
            value={theme.font}
            onChange={(font) => setTheme({ ...theme, font })}
            options={THEME_FONTS.map((f) => ({ value: f, label: FONT_LABEL[f] }))}
          />
          <div>
            <div className={s.fieldLabel}>{t('theme.holding')}</div>
            <div className={s.top}>
              <label className={s.fileButton}>
                {busy === 'holding'
                  ? t('rundown.imageChecking')
                  : theme.holdingAssetId
                    ? t('theme.replace')
                    : t('theme.upload')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={t('theme.holding')}
                  onChange={(e) => {
                    void pick('holding', e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {theme.holdingAssetId && (
                <Button size="dense" onClick={() => setTheme({ ...theme, holdingAssetId: null })}>
                  {t('theme.remove')}
                </Button>
              )}
            </div>
            <p className={s.note}>{t('theme.holdingHelp')}</p>
          </div>
        </div>
        <div>
          <Segmented<PreviewScene>
            label={t('theme.preview')}
            value={scene}
            onChange={setScene}
            options={[
              { value: 'camera_lower_third', label: t('scene.cameraLowerThird') },
              { value: 'text', label: t('scene.textCard') },
              { value: 'slate', label: t('scene.slate') },
            ]}
          />
          <canvas
            ref={canvas}
            width={640}
            height={360}
            className={s.themePreview}
            data-testid="theme-preview"
            aria-label={t('theme.previewLabel')}
          />
          {scene === 'camera_lower_third' && theme.lowerThirdMotion !== 'none' && (
            <Button size="dense" onClick={() => setReplay((n) => n + 1)}>
              {t('theme.replay')}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className={s.warnText} role="alert">
          {error}
        </p>
      )}
      <div className={s.top}>
        <Button
          variant="primary"
          disabled={!dirty || !readable || busy !== null}
          onClick={() => void save()}
        >
          {busy === 'save' ? t('theme.saving') : dirty ? t('theme.save') : t('theme.saved')}
        </Button>
      </div>
    </section>
  );
}
