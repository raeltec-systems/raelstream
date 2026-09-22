import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { cx } from './cx.js';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'dangerTrigger' | 'ghost';
export type ButtonSize = 'default' | 'top' | 'dense';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  keyHint?: string;
  children: ReactNode;
}

/** Pill buttons. Labels are verb + object, never "OK"/"Yes". A danger trigger outside a modal ends with "…". */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'default',
    keyHint,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx(s.btn, s[variant], s[size], className)} {...rest}>
      {children}
      {keyHint && <KeyChip>{keyHint}</KeyChip>}
    </button>
  );
});

export function KeyChip({ children }: { children: ReactNode }) {
  return (
    <kbd className={s.key} aria-hidden>
      {children}
    </kbd>
  );
}
