import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import { cx } from './cx.js';
import s from './Field.module.css';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  helper?: ReactNode;
  error?: string | null;
  mono?: boolean;
}

export function TextField({ label, helper, error, mono, className, ...rest }: TextFieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className={cx(s.field, className)}>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={helper || error ? helpId : undefined}
        className={cx(s.input, mono && s.mono, error && s.error)}
        {...rest}
      />
      {(error || helper) && (
        <div id={helpId} className={cx(s.helper, error && s.helperError)}>
          {error ?? helper}
        </div>
      )}
    </div>
  );
}

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  helper?: ReactNode;
  error?: string | null;
}

/** Multi-line text (announcements, scripture passages). */
export function TextArea({ label, helper, error, className, ...rest }: TextAreaProps) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className={cx(s.field, className)}>
      <label htmlFor={id} className={s.label}>
        {label}
      </label>
      <textarea
        id={id}
        rows={5}
        aria-invalid={!!error}
        aria-describedby={helper || error ? helpId : undefined}
        className={cx(s.input, s.textarea, error && s.error)}
        {...rest}
      />
      {(error || helper) && (
        <div id={helpId} className={cx(s.helper, error && s.helperError)}>
          {error ?? helper}
        </div>
      )}
    </div>
  );
}

/** Write-only secret field: shows only a mask (prefix + last 4) and a Paste action (design: Inputs · Secret). */
export function SecretField({
  label,
  masked,
  placeholder,
  helper,
  error,
  onPaste,
  pasteLabel,
}: {
  label: string;
  masked: string | null;
  placeholder: string;
  helper?: ReactNode;
  error?: string | null;
  onPaste: (value: string) => void;
  pasteLabel: string;
}) {
  const id = useId();
  async function paste() {
    try {
      const v = await navigator.clipboard.readText();
      if (v) onPaste(v.trim());
    } catch {
      const v = window.prompt(label);
      if (v) onPaste(v.trim());
    }
  }
  return (
    <div className={s.field}>
      <div id={id} className={s.label}>
        {label}
      </div>
      <div
        className={cx(s.secret, !masked && s.secretEmpty, error && s.error)}
        aria-labelledby={id}
      >
        <span className={cx(s.secretValue, !masked && s.placeholder)}>{masked ?? placeholder}</span>
        <button type="button" className={cx(s.inline, !masked && s.inlinePrimary)} onClick={paste}>
          {pasteLabel}
        </button>
      </div>
      {(error || helper) && (
        <div className={cx(s.helper, error && s.helperError)}>{error ?? helper}</div>
      )}
    </div>
  );
}
