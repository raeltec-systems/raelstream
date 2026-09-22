import s from './Meter.module.css';

/** Horizontal level meter. `level` is 0..1 of the dBFS scale; marker at the amber line (~−6 dB). */
export function Meter({
  level,
  label,
  height = 10,
  marker,
}: {
  level: number;
  label: string;
  height?: number;
  marker?: number;
}) {
  const pct = Math.max(0, Math.min(1, level)) * 100;
  const clip = level >= 0.999;
  return (
    <div
      className={s.track}
      style={{ height }}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div
        className={s.fill}
        style={{ width: `${pct}%`, background: clip ? 'var(--rs-live)' : undefined }}
      />
      {marker !== undefined && <div className={s.marker} style={{ left: `${marker * 100}%` }} />}
    </div>
  );
}
