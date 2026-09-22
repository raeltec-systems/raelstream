import type { ReactNode } from 'react';
import { cx } from './cx.js';
import { StatusDot } from './Status.js';
import s from './Banner.module.css';

/** Blocker/critical banner. Persistent; toasts never replace it (B§10.4). */
export function Banner({
  tone = 'live',
  title,
  children,
  actions,
}: {
  tone?: 'live' | 'standby';
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={cx(s.banner, s[tone])} role="alert">
      <StatusDot tone={tone} size={12} />
      <div className={s.text}>
        <div className={s.title}>{title}</div>
        {children && <div className={s.body}>{children}</div>}
      </div>
      {actions && <div className={s.actions}>{actions}</div>}
    </div>
  );
}
