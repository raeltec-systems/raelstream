import { useEffect, useState } from 'react';
import { Button, Card, Logo, StatusDot } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { api, ApiFailure } from '../lib/api.js';
import { router } from '../lib/router.js';
import type { Me } from '../auth/SignIn.js';
import { ThemeEditor } from './ThemeEditor.js';
import { DestinationsEditor } from './DestinationsEditor.js';
import s from './StudioApp.module.css';

interface User {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'operator';
  disabled: boolean;
  mfaConfirmed: boolean;
}

/** Owner settings: operators and invites (SPEC §6.1–6.2), and the church's on-air look (§10.5). */
export function Settings({ me }: { me: Me }) {
  const [users, setUsers] = useState<User[]>([]);
  const [invite, setInvite] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api<User[]>('GET', '/api/users')
      .then(setUsers)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void load();
  }, []);

  async function toggle(u: User) {
    try {
      await api('POST', `/api/users/${u.id}/disable`, { disabled: !u.disabled });
      await load();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : String(e));
    }
  }

  return (
    <main className={s.center} data-theme="light">
      <Card className={`${s.card} ${s.wide}`}>
        <div className={s.top}>
          <Logo ring={22} />
          <span className={s.spacer} />
          <Button size="dense" onClick={() => router.go('/studio')}>
            {t('settings.back')}
          </Button>
        </div>
        <h1 className="rs-h1">{t('settings.title')}</h1>
        {error && (
          <p className={s.note} role="alert">
            {error}
          </p>
        )}
        <ul className={s.list} aria-label={t('settings.users')}>
          {users.map((u) => (
            <li key={u.id} className={s.row}>
              <StatusDot tone={u.disabled ? 'off' : u.mfaConfirmed ? 'ready' : 'standby'} />
              <span className={s.rowText}>
                <span className={s.rowTitle}>
                  {u.name} · {u.role === 'owner' ? t('settings.owner') : t('settings.operator')}
                </span>
                <span className={s.rowSub}>
                  {u.email} ·{' '}
                  {u.disabled
                    ? t('settings.disabled')
                    : u.mfaConfirmed
                      ? t('settings.active')
                      : t('settings.pendingMfa')}
                </span>
              </span>
              {u.id !== me.userId && (
                <Button
                  size="dense"
                  variant={u.disabled ? 'secondary' : 'dangerTrigger'}
                  onClick={() => void toggle(u)}
                >
                  {u.disabled ? t('settings.enable') : t('settings.disable')}
                </Button>
              )}
            </li>
          ))}
        </ul>
        <h2 className="rs-title">{t('settings.inviteTitle')}</h2>
        <p className={s.note}>{t('settings.inviteBody')}</p>
        {invite ? (
          <>
            <div className={s.linkBox} data-testid="invite-link">
              {invite.url}
            </div>
            <div className={s.top}>
              <Button
                size="dense"
                onClick={() =>
                  void navigator.clipboard?.writeText(invite.url).then(() => setCopied(true))
                }
              >
                {copied ? t('settings.copied') : t('settings.copy')}
              </Button>
              <span className={s.note}>
                {t('settings.expires', {
                  when: new Date(invite.expiresAt).toLocaleString('en-GB'),
                })}
              </span>
            </div>
          </>
        ) : (
          <Button
            variant="primary"
            onClick={() =>
              void api<{ url: string; expiresAt: string }>('POST', '/api/invites').then(setInvite)
            }
          >
            {t('settings.createInvite')}
          </Button>
        )}
      </Card>
      <Card className={`${s.card} ${s.wide}`}>
        <DestinationsEditor />
      </Card>
      <Card className={`${s.card} ${s.wide}`}>
        <ThemeEditor />
      </Card>
    </main>
  );
}
