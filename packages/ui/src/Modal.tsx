import type { ReactNode, RefObject } from 'react';
import { useEffect, useRef } from 'react';
import s from './Modal.module.css';

/**
 * Accessible modal: focus trap, Escape = onDismiss, initial focus on `initialFocus` (the safe action).
 * Enter never confirms: a keydown Enter on anything except the focused safe button is swallowed.
 */
export function Modal({
  title,
  children,
  actions,
  onDismiss,
  initialFocus,
  labelledBy = 'rs-modal-title',
}: {
  title: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  onDismiss: () => void;
  initialFocus: RefObject<HTMLElement | null>;
  labelledBy?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    initialFocus.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, [initialFocus]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onDismiss();
      return;
    }
    if (e.key === 'Enter' && document.activeElement !== initialFocus.current) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab' && box.current) {
      const f = box.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  return (
    <div className={s.backdrop}>
      <div
        ref={box}
        className={s.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        data-theme="light"
      >
        <h2 id={labelledBy} className={s.title}>
          {title}
        </h2>
        {children}
        <div className={s.actions}>{actions}</div>
      </div>
    </div>
  );
}
