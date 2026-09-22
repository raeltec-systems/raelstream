import { useId } from 'react';
import s from './Toggle.module.css';

export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={s.row}>
      <div className={s.text}>
        <label htmlFor={id} className={s.label}>
          {label}
        </label>
        {description && <div className={s.desc}>{description}</div>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={s.track}
        onClick={() => onChange(!checked)}
      >
        <span className={s.knob} />
      </button>
    </div>
  );
}
