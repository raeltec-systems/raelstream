import type { ReactNode } from 'react';
import { cx } from './cx.js';
import s from './Status.module.css';

export type Tone = 'live' | 'ready' | 'standby' | 'off' | 'accent';

/** Status is always dot + word; the dot never carries meaning alone. "off" is an outlined ring. */
export function StatusDot({ tone, size = 10 }: { tone: Tone; size?: number }) {
  return (
    <span
      className={cx(s.dot, s[`dot_${tone}`])}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

export function Pill({
  tone,
  children,
  strong = false,
}: {
  tone: Tone;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <span className={cx(s.pill, s[`pill_${tone}`], strong && s.strong)} role="status">
      <StatusDot tone={strong ? 'off' : tone} />
      {children}
    </span>
  );
}

export function StatusRow({
  tone,
  label,
  detail,
}: {
  tone: Tone;
  label: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className={s.row}>
      <StatusDot tone={tone} />
      <span className={s.rowLabel}>{label}</span>
      {detail !== undefined && <span className={cx(s.rowDetail, 'rs-mono')}>{detail}</span>}
    </div>
  );
}
