import { useEffect, useState } from 'react';
import { Button, Card, Meter, Segmented, StatusDot, Toggle } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { DELAY_MAX_MS, meterPosition, type RoutingMode } from '@raelstream/media-runtime';
import { useStore } from '../../lib/useStore.js';
import { studioRuntime } from '../runtime.js';
import { SyncTool } from './SyncTool.js';
import s from './steps.module.css';

/** Select value for the camera phone's sound (device IDs are opaque strings, never this). */
const PHONE = 'rs:phone';

const MODE_LABEL: Record<RoutingMode, string> = {
  in1_both: 'audio.mode.in1',
  in2_both: 'audio.mode.in2',
  stereo_12: 'audio.mode.stereo',
  mono_blend: 'audio.mode.blend',
};

export function AudioStep() {
  const rt = studioRuntime();
  const st = useStore(rt);
  const [savedToPreset, setSavedToPreset] = useState(false);
  const a = useStore(rt.audio);
  const cam = useStore(rt.camera);
  const phoneConnected = cam.connection === 'connected';
  const phoneAudio = cam.camState?.audio?.state ?? 'off';
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState('');
  const [access, setAccess] = useState<'unknown' | 'denied' | 'unavailable'>('unknown');
  // Without microphone permission the browser lists anonymous inputs that cannot be selected.
  const needsAccess = devices.length === 0 || devices.some((d) => !d.deviceId || !d.label);

  async function refresh() {
    setDevices(await rt.audio.listInputs());
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- list devices once on mount
  }, []);

  async function allow() {
    const r = await rt.audio.requestAccess();
    if (r !== 'granted') setAccess(r);
    await refresh();
  }

  async function choose(id: string) {
    setSelected(id);
    if (id === PHONE) rt.usePhoneAudio();
    else if (id) {
      await rt.selectAudioDevice(id);
      await refresh(); // labels appear after permission is granted
    }
  }
  const value = a.source === 'phone' || selected === PHONE ? PHONE : selected;

  const hasSignal = a.soundRecent;

  return (
    <>
      <h1 className="rs-h1">{t('audio.title')}</h1>
      <Card>
        <label className={s.headTitle} htmlFor="rs-audio-device">
          {t('audio.input')}
        </label>
        {needsAccess && (
          <div className={s.row}>
            <p className={s.muted} style={{ flex: 1 }}>
              {access === 'denied'
                ? t('audio.accessDenied')
                : access === 'unavailable'
                  ? t('audio.noInputs')
                  : t('audio.accessNeeded')}
            </p>
            <Button variant="primary" onClick={() => void allow()}>
              {t('audio.allowAccess')}
            </Button>
          </div>
        )}
        <div className={s.row}>
          <select
            id="rs-audio-device"
            className={s.select}
            value={value}
            onChange={(e) => void choose(e.target.value)}
            style={{ flex: 1 }}
          >
            <option value="">{t('audio.choose')}</option>
            {devices
              .filter((d) => d.deviceId)
              .map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || t('audio.unnamedInput', { n: i + 1 })}
                </option>
              ))}
            {(phoneConnected || value === PHONE) && (
              <option value={PHONE}>
                {t('audio.phoneOption', { name: rt.admittedSource?.label ?? t('audio.phone') })}
              </option>
            )}
          </select>
          {a.status === 'running' && (
            <span className={`${s.chip} ${hasSignal ? s.chipReady : s.chipStandby}`}>
              <StatusDot tone={hasSignal ? 'ready' : 'standby'} size={8} />
              {hasSignal ? t('audio.soundDetected') : t('audio.noSound')}
            </span>
          )}
        </div>
        {value === PHONE && phoneAudio === 'starting' && (
          <p className={s.muted}>{t('audio.phoneWaiting')}</p>
        )}
        {value === PHONE &&
          (phoneAudio === 'denied' || phoneAudio === 'unavailable' || phoneAudio === 'error') && (
            <p className={s.warn}>{t(`audio.phone.${phoneAudio}` as never)}</p>
          )}
        {value === PHONE && <p className={s.muted}>{t('audio.phoneNote')}</p>}
        {a.status === 'device_lost' && (
          <p className={s.warn}>
            {a.source === 'phone' ? t('audio.phoneLost') : t('audio.deviceLost')}
          </p>
        )}
        {a.deviceBack && (
          <div className={s.row}>
            <Button variant="primary" onClick={() => void rt.reconnectAudio()}>
              {t('audio.deviceBack', { label: a.deviceBack.label })}
            </Button>
          </div>
        )}
        {a.silent && (
          <div className={s.row}>
            <p className={s.warn} style={{ flex: 1 }}>
              {t('audio.silent')}
            </p>
            <Button size="dense" onClick={() => rt.audio.acknowledgeSilence()}>
              {t('audio.silentIntentional')}
            </Button>
          </div>
        )}
        {a.status === 'error' && <p className={s.warn}>{t('audio.captureError')}</p>}
        {a.processingNotDisabled.length > 0 && (
          <p className={s.warn}>
            {t('audio.processingOn', { list: a.processingNotDisabled.join(', ') })}
          </p>
        )}
        {a.channelCount === 1 && <p className={s.muted}>{t('audio.oneChannel')}</p>}
        <Segmented<RoutingMode>
          label={t('audio.routing')}
          value={a.mode}
          onChange={(m) => rt.audio.setMode(m)}
          options={(Object.keys(MODE_LABEL) as RoutingMode[]).map((m) => ({
            value: m,
            label: t(MODE_LABEL[m] as never),
            disabled: !a.availableModes.includes(m),
          }))}
        />
        <div className={s.meters}>
          {(['L', 'R'] as const).map((ch, i) => (
            <div key={ch} className={s.meterRow}>
              <span>{ch}</span>
              <Meter
                height={18}
                level={meterPosition(a.programme.holdDb[i]!)}
                marker={0.9}
                label={t('audio.meter', { ch })}
              />
              <span>{t('audio.peak', { db: Math.round(a.programme.holdDb[i]!) })}</span>
            </div>
          ))}
        </div>
        <p className={s.muted}>
          {t('audio.aim')}{' '}
          {a.clipCount > 0 && <b className={s.warn}>{t('audio.clipped', { n: a.clipCount })}</b>}
        </p>
        <label className={s.headTitle} htmlFor="rs-gain">
          {t('audio.gain', { db: a.gainDb })}
        </label>
        <input
          id="rs-gain"
          className={s.slider}
          type="range"
          min={-24}
          max={12}
          step={1}
          value={a.gainDb}
          onChange={(e) => rt.audio.setGainDb(Number(e.target.value))}
        />
        <p className={s.muted}>{t('audio.channelTest')}</p>
        {st.savedAudioDevice && a.status !== 'running' && (
          <p className={s.muted}>{t('audio.lastUsed', { label: st.savedAudioDevice })}</p>
        )}
        {st.presetId && (
          <div className={s.row}>
            <Button
              size="dense"
              onClick={() => void rt.saveAudio(true).then(() => setSavedToPreset(true))}
            >
              {savedToPreset
                ? t('preset.saved')
                : t('preset.saveAudio', { name: st.presetName ?? '' })}
            </Button>
          </div>
        )}
      </Card>
      <div className={s.grid2}>
        <Card>
          <Toggle
            label={t('audio.lowCut')}
            description={t('audio.lowCutDesc')}
            checked={a.hpf}
            onChange={(v) => rt.audio.setHpf(v)}
          />
        </Card>
        <Card>
          <Toggle
            label={t('audio.compressor')}
            description={t('audio.compressorDesc')}
            checked={a.compressor}
            onChange={(v) => rt.audio.setCompressor(v)}
          />
        </Card>
        <Card>
          <Toggle
            label={t('audio.listen')}
            description={t('audio.listenDesc')}
            checked={a.monitor}
            onChange={(v) => rt.audio.setMonitor(v)}
          />
        </Card>
      </div>
      <LipSync />
    </>
  );
}

function LipSync() {
  const rt = studioRuntime();
  const a = useStore(rt.audio);
  const [draft, setDraft] = useState(String(a.delayMs));
  useEffect(() => setDraft(String(a.delayMs)), [a.delayMs]);
  const apply = (v: number) => rt.audio.setDelayMs(v);
  return (
    <Card>
      <div className={s.headTitle}>{t('sync.title')}</div>
      <p className={s.muted}>{t('sync.rule')}</p>
      <div className={s.delay}>
        <Button size="dense" onClick={() => apply(a.delayMs - 50)}>
          −50
        </Button>
        <Button size="dense" onClick={() => apply(a.delayMs - 10)}>
          −10
        </Button>
        <input
          aria-label={t('sync.inputLabel')}
          className={s.delayInput}
          inputMode="numeric"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => apply(Number(draft))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply(Number(draft));
          }}
        />
        <span className={s.mono}>{t('units.ms')}</span>
        <Button size="dense" onClick={() => apply(a.delayMs + 10)}>
          +10
        </Button>
        <Button size="dense" onClick={() => apply(a.delayMs + 50)}>
          +50
        </Button>
        <Button size="dense" variant="ghost" onClick={() => apply(0)}>
          {t('sync.reset')}
        </Button>
      </div>
      <p className={s.mono}>{t('sync.applied', { ms: a.delayMs, max: DELAY_MAX_MS })}</p>
      <p className={s.muted}>{t('sync.method')}</p>
      <SyncTool />
    </Card>
  );
}
