import { useState } from 'react';
import { Button, Card, Segmented, TextArea, TextField, cx } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { LOWER_THIRD_MAX, textCardFits } from '@raelstream/media-runtime';
import { ApiFailure, uploadAsset } from '../../lib/api.js';
import { FONT_FAMILY, assetBitmap } from '../../lib/theme.js';
import { useStore } from '../../lib/useStore.js';
import { studioRuntime } from '../runtime.js';
import { newId, type RundownItem } from '../rundown.js';
import s from './steps.module.css';

const MAX_ITEMS = 40;
type Kind = RundownItem['type'];

export function typeLabel(k: Kind): string {
  return t(
    k === 'lower_third'
      ? 'rundown.type.lowerThird'
      : k === 'text'
        ? 'rundown.type.text'
        : 'rundown.type.image',
  );
}

export function RundownStep() {
  const rt = studioRuntime();
  const { rundown, presetId, presetName, churchTheme } = useStore(rt);
  const [savedToPreset, setSavedToPreset] = useState(false);
  const [upload, setUpload] = useState<
    { state: 'idle' | 'checking' } | { state: 'error'; message: string }
  >({ state: 'idle' });
  const font = FONT_FAMILY[churchTheme?.font ?? 'inter'];
  const [sel, setSel] = useState(0);
  const item = rundown[sel];

  function update(next: RundownItem) {
    rt.setRundown(rundown.map((x, i) => (i === sel ? next : x)));
  }
  function add() {
    if (rundown.length >= MAX_ITEMS) return;
    rt.setRundown([
      ...rundown,
      { id: newId(), type: 'lower_third', title: t('rundown.newItem'), line1: '', line2: '' },
    ]);
    setSel(rundown.length);
  }
  function move(d: -1 | 1) {
    const j = sel + d;
    if (j < 0 || j >= rundown.length) return;
    const copy = [...rundown];
    [copy[sel], copy[j]] = [copy[j]!, copy[sel]!];
    rt.setRundown(copy);
    setSel(j);
  }
  function remove() {
    rt.setRundown(rundown.filter((_, i) => i !== sel));
    setSel(Math.max(0, sel - 1));
  }
  function changeType(k: Kind) {
    if (!item || item.type === k) return;
    const base = { id: item.id, title: item.title };
    update(
      k === 'lower_third'
        ? { ...base, type: k, line1: item.title, line2: '' }
        : k === 'text'
          ? { ...base, type: k, detail: '' }
          : { ...base, type: k, fit: 'contain', assetId: null, bitmap: null },
    );
  }

  return (
    <>
      <h1 className="rs-h1">{t('rundown.title')}</h1>
      <div className={s.rundownGrid}>
        <ol className={s.list} aria-label={t('rundown.listLabel')}>
          {rundown.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                className={cx(s.item, i === sel && s.itemSelected)}
                onClick={() => setSel(i)}
                aria-current={i === sel}
              >
                <span className={s.itemIndex}>{String(i + 1).padStart(2, '0')}</span>
                <span className={s.itemTitle}>{r.title || t('rundown.untitled')}</span>
                <span className={s.typeChip}>{typeLabel(r.type)}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={cx(s.add)}
              style={{ width: '100%' }}
              onClick={add}
              disabled={rundown.length >= MAX_ITEMS}
            >
              {t('rundown.add')}
            </button>
          </li>
        </ol>
        {item ? (
          <Card>
            <Segmented<Kind>
              label={t('rundown.typeLabel')}
              value={item.type}
              onChange={changeType}
              options={[
                { value: 'lower_third', label: t('rundown.type.lowerThird') },
                { value: 'text', label: t('rundown.type.text') },
                { value: 'image', label: t('rundown.type.image') },
              ]}
            />
            <TextField
              label={t('rundown.itemTitle')}
              value={item.title}
              maxLength={60}
              onChange={(e) => update({ ...item, title: e.target.value })}
            />
            {item.type === 'lower_third' && (
              <>
                <TextField
                  label={t('rundown.name')}
                  value={item.line1}
                  maxLength={64}
                  onChange={(e) => update({ ...item, line1: e.target.value })}
                  helper={
                    item.line1.length > LOWER_THIRD_MAX
                      ? t('rundown.tooLong', { n: LOWER_THIRD_MAX })
                      : t('rundown.fits', { n: LOWER_THIRD_MAX })
                  }
                />
                <TextField
                  label={t('rundown.secondLine')}
                  value={item.line2}
                  maxLength={64}
                  onChange={(e) => update({ ...item, line2: e.target.value })}
                  helper={
                    item.line2.length > LOWER_THIRD_MAX
                      ? t('rundown.tooLong', { n: LOWER_THIRD_MAX })
                      : undefined
                  }
                />
              </>
            )}
            {item.type === 'text' && (
              <>
                <TextArea
                  label={t('rundown.detail')}
                  value={item.detail}
                  maxLength={600}
                  onChange={(e) => update({ ...item, detail: e.target.value })}
                  error={textCardFits(item, font) ? null : t('rundown.textTooLong')}
                  helper={t('rundown.detailHelp', { n: 600 - item.detail.length })}
                />
                <TextField
                  label={t('rundown.reference')}
                  value={item.reference ?? ''}
                  maxLength={60}
                  onChange={(e) => update({ ...item, reference: e.target.value })}
                />
              </>
            )}
            {item.type === 'image' && (
              <>
                <label className={s.headTitle} htmlFor="rs-img">
                  {t('rundown.image')}
                </label>
                <input
                  id="rs-img"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    // The server checks and re-encodes the image; the programme only ever shows that copy.
                    setUpload({ state: 'checking' });
                    try {
                      const a = await uploadAsset(f);
                      const bitmap = await assetBitmap(a.id);
                      update({ ...item, assetId: a.id, bitmap });
                      setUpload({ state: 'idle' });
                    } catch (err) {
                      setUpload({
                        state: 'error',
                        message:
                          err instanceof ApiFailure ? err.message : t('rundown.imageUploadFailed'),
                      });
                    }
                  }}
                />
                {upload.state === 'error' ? (
                  <p className={s.warn} role="alert">
                    {upload.message}
                  </p>
                ) : (
                  <p className={s.muted}>
                    {upload.state === 'checking'
                      ? t('rundown.imageChecking')
                      : item.bitmap
                        ? t('rundown.imageReady', { w: item.bitmap.width, h: item.bitmap.height })
                        : item.assetId
                          ? t('rundown.imageLoading')
                          : t('rundown.imageNotLoaded')}
                  </p>
                )}
                <Segmented<'contain' | 'fill'>
                  label={t('rundown.imageFit')}
                  value={item.fit}
                  onChange={(fit) => update({ ...item, fit })}
                  options={[
                    { value: 'contain', label: t('devices.framingFit') },
                    { value: 'fill', label: t('devices.framingFill') },
                  ]}
                />
              </>
            )}
            <div className={s.row}>
              <Button size="dense" onClick={() => move(-1)} disabled={sel === 0}>
                {t('rundown.up')}
              </Button>
              <Button size="dense" onClick={() => move(1)} disabled={sel === rundown.length - 1}>
                {t('rundown.down')}
              </Button>
              <Button size="dense" onClick={remove}>
                {t('rundown.remove')}
              </Button>
            </div>
          </Card>
        ) : (
          <Card>
            <p className={s.muted}>{t('rundown.empty')}</p>
          </Card>
        )}
      </div>
      <div className={s.row}>
        <p className={s.muted}>{t('rundown.footnote', { n: rundown.length })}</p>
        {presetId && (
          <Button
            size="dense"
            onClick={() => void rt.saveRundown(true).then(() => setSavedToPreset(true))}
          >
            {savedToPreset
              ? t('preset.saved')
              : t('preset.saveRundown', { name: presetName ?? '' })}
          </Button>
        )}
      </div>
    </>
  );
}
