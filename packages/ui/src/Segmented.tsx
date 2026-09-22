import { cx } from './cx.js';
import s from './Segmented.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  grow?: number;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  height = 44,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  height?: number;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={s.track}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          className={cx(s.seg, o.value === value && s.selected)}
          style={{ height, flex: o.grow ?? 1 }}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
