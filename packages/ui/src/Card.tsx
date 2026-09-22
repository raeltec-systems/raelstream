import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx.js';
import s from './Card.module.css';

export function Card({
  ring,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { ring?: 'standby' | 'live' | 'accent'; children: ReactNode }) {
  return (
    <div className={cx(s.card, ring && s[ring], className)} {...rest}>
      {children}
    </div>
  );
}

export function Panel({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cx(s.panel, className)} {...rest}>
      {children}
    </div>
  );
}
