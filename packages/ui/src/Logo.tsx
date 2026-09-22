import { t } from '@raelstream/i18n';
import s from './Logo.module.css';

/** Ring + wordmark lockup. The ring takes the accent; the wordmark stays ink/paper (design §Logo). */
export function Logo({ ring = 20, wordmark = true }: { ring?: number; wordmark?: boolean }) {
  return (
    <span className={s.lockup} style={{ gap: Math.round(ring * 0.5) }} aria-label={t('brand.name')}>
      <span
        className={s.ring}
        style={{ width: ring, height: ring, borderWidth: Math.max(2, Math.round(ring / 5)) }}
        aria-hidden
      />
      {wordmark && (
        <span className={s.word} style={{ fontSize: Math.round(ring * 1.1) }} aria-hidden>
          {t('brand.name')}
        </span>
      )}
    </span>
  );
}
