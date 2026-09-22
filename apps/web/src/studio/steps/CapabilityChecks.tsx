import { StatusDot } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import s from './steps.module.css';

/** Studio browser capability probe (SPEC §3.3). Missing critical capabilities are blockers. */
export function probeStudio(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!window.isSecureContext) missing.push('secure context');
  if (!navigator.mediaDevices?.getUserMedia) missing.push('getUserMedia');
  if (typeof RTCPeerConnection === 'undefined') missing.push('WebRTC');
  if (!('captureStream' in HTMLCanvasElement.prototype)) missing.push('canvas capture');
  if (typeof AudioWorkletNode === 'undefined') missing.push('AudioWorklet');
  return { ok: missing.length === 0, missing };
}

export function CapabilityChecks({
  cameraOk,
  audioOk,
  cameraDetail,
  audioDetail,
}: {
  cameraOk: boolean;
  audioOk: boolean;
  cameraDetail: string;
  audioDetail: string;
}) {
  const probe = probeStudio();
  return (
    <div className={s.checks}>
      <div className={s.check}>
        <StatusDot tone={cameraOk ? 'ready' : 'standby'} />
        <span className={s.checkLabel}>
          {cameraOk ? t('check.cameraPaired') : t('check.cameraNotPaired')}
        </span>
        <span className={s.checkDetail}>{cameraDetail}</span>
      </div>
      <div className={s.check}>
        <StatusDot tone={audioOk ? 'ready' : 'standby'} />
        <span className={s.checkLabel}>
          {audioOk ? t('check.mixerIn') : t('check.mixerNotSelected')}
        </span>
        <span className={s.checkDetail}>{audioDetail}</span>
      </div>
      <div className={s.check}>
        <StatusDot tone={probe.ok ? 'ready' : 'live'} />
        <span className={s.checkLabel}>
          {probe.ok ? t('check.browserOk') : t('check.browserMissing')}
        </span>
        <span className={s.checkDetail}>{probe.missing.join(', ')}</span>
      </div>
    </div>
  );
}
