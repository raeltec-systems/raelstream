import { useState } from 'react';
import { Button, Logo, StatusDot, cx } from '@raelstream/ui';
import { t, type MessageKey } from '@raelstream/i18n';
import { useStore } from '../lib/useStore.js';
import { router } from '../lib/router.js';
import { studioRuntime } from './runtime.js';
import { DevicesStep } from './steps/DevicesStep.js';
import { AudioStep } from './steps/AudioStep.js';
import { RundownStep } from './steps/RundownStep.js';
import { DestinationsStep } from './steps/DestinationsStep.js';
import { UplinkStep } from './steps/UplinkStep.js';
import { LeaseBanner } from './LeaseBanner.js';
import s from './Preparation.module.css';

const STEPS = ['devices', 'uplink', 'destinations', 'rundown', 'audio'] as const;
type Step = (typeof STEPS)[number];

export function Preparation({
  operator,
  role,
  onSignOut,
}: {
  operator: string;
  role: 'owner' | 'operator';
  onSignOut: () => void;
}) {
  const rt = studioRuntime();
  const st = useStore(rt);
  const cam = useStore(rt.camera);
  const audio = useStore(rt.audio);
  const [step, setStep] = useState<Step>('devices');

  const cameraOk = cam.connection === 'connected';
  // A ticked destination without a key blocks readiness (B§16.4); untick it or paste the key.
  const destinationsOk = st.destinations
    .filter((d) => st.selectedDestinationIds.includes(d.id))
    .every((d) => rt.destinationHasKey(d));
  const audioOk = audio.status === 'running';
  const done: Record<Step, boolean | null> = {
    devices: cameraOk,
    uplink: st.uplink.result ? true : null,
    destinations: destinationsOk && st.selectedDestinationIds.length > 0 ? true : null,
    rundown: st.rundown.length > 0,
    audio: audioOk,
  };
  const left: MessageKey[] = [];
  if (!cameraOk) left.push('prep.left.camera');
  if (!audioOk) left.push('prep.left.audio');
  // Not blocking: the Studio can open to rehearse; Go live will not offer a destination without a key.
  const reminders: MessageKey[] = destinationsOk ? [] : ['prep.left.destKey'];
  const idx = STEPS.indexOf(step);
  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  return (
    <div className={s.frame} data-theme="light">
      <nav className={s.sidebar} aria-label={t('prep.stepsLabel')}>
        <Logo ring={22} />
        <ol className={s.steps}>
          {STEPS.map((k, i) => (
            <li key={k}>
              <button
                type="button"
                className={cx(s.step, k === step && s.current)}
                aria-current={k === step ? 'step' : undefined}
                onClick={() => setStep(k)}
              >
                <span
                  className={cx(s.num, done[k] === true && s.numDone, k === step && s.numCurrent)}
                >
                  {i + 1}
                </span>
                <span className={s.stepLabel}>{t(`prep.step.${k}` as MessageKey)}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className={s.who}>
          {t('prep.signedInAs', { name: operator })}
          <br />
          {role === 'owner' ? t('settings.owner') : t('prep.volunteerOperator')}
          <br />
          <Button size="dense" variant="ghost" onClick={onSignOut}>
            {t('home.signOut')}
          </Button>
        </div>
      </nav>
      <div className={s.main}>
        <div className={s.content}>
          <LeaseBanner />
          <div className="rs-overline">{`${st.session?.name ?? ''} · ${date}`.toUpperCase()}</div>
          {step === 'devices' && <DevicesStep />}
          {step === 'uplink' && <UplinkStep />}
          {step === 'destinations' && <DestinationsStep />}
          {step === 'rundown' && <RundownStep />}
          {step === 'audio' && <AudioStep />}
        </div>
        <footer className={s.footer}>
          <div className={s.status} role="status">
            <StatusDot tone={left.length ? 'standby' : 'ready'} />
            {left.length ? (
              <span>
                <b>{t('prep.thingsLeft', { count: left.length })}</b>{' '}
                {left.map((k) => t(k)).join(' ')}
                {reminders.length > 0 && ` ${reminders.map((k) => t(k)).join(' ')}`}
              </span>
            ) : (
              <span>
                <b>{t('prep.allReady')}</b> {t('prep.allReadyDetail')}
                {reminders.length > 0 && ` ${reminders.map((k) => t(k)).join(' ')}`}
              </span>
            )}
          </div>
          {idx > 0 && <Button onClick={() => setStep(STEPS[idx - 1]!)}>{t('prep.back')}</Button>}
          {idx < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => setStep(STEPS[idx + 1]!)}>
              {t('prep.continueTo', {
                step: t(`prep.step.${STEPS[idx + 1]!}` as MessageKey).toLowerCase(),
              })}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={left.length > 0}
              onClick={() => router.go('/studio/live')}
            >
              {t('prep.openStudio')}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
