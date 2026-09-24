import { useEffect, useState } from 'react';
import type { SessionSnapshot } from '@raelstream/contracts';
import { Button, Card, Logo, StatusDot, TextField } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { api, ApiFailure } from '../lib/api.js';
import { router } from '../lib/router.js';
import type { Me } from '../auth/SignIn.js';
import s from './StudioApp.module.css';

interface Preset {
  id: string;
  name: string;
  updatedAt: string;
  rundown: unknown[];
}

/** S01 Service home: presets, start a service, no automatic broadcasting (B§10.1). */
export function Home({
  me,
  onStarted,
  onSignOut,
}: {
  me: Me;
  onStarted: (s: SessionSnapshot) => void;
  onSignOut: () => void;
}) {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<Preset[]>('GET', '/api/presets')
      .then(setPresets)
      .catch(() => setPresets([]));
  useEffect(() => {
    void load();
  }, []);

  const date = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date());

  async function start(p: Preset | null) {
    setError(null);
    try {
      onStarted(
        await api<SessionSnapshot>(
          'POST',
          '/api/sessions',
          p
            ? { name: `${p.name} · ${date}`, presetId: p.id }
            : { name: `${t('home.defaultName')} · ${date}` },
        ),
      );
      router.go('/studio');
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : t('home.createFailed'));
    }
  }

  async function createPreset(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    await api('POST', '/api/presets', { name: newName.trim() });
    setNewName('');
    await load();
  }

  return (
    <main className={s.center} data-theme="light">
      <Card className={`${s.card} ${s.wide}`}>
        <div className={s.top}>
          <Logo ring={22} />
          <span className={s.spacer} />
          {me.role === 'owner' && (
            <Button size="dense" onClick={() => router.go('/studio/settings')}>
              {t('home.settings')}
            </Button>
          )}
          <Button size="dense" variant="ghost" onClick={onSignOut}>
            {t('home.signOut')}
          </Button>
        </div>
        <div className="rs-overline">{t('home.signedInAs', { name: me.name })}</div>
        <h1 className="rs-h1">{t('home.title')}</h1>
        <p className={s.note}>{t('home.noBroadcast')}</p>
        {error && (
          <p className={s.note} role="alert">
            {error}
          </p>
        )}
        <ul className={s.list} aria-label={t('home.presets')}>
          {presets?.map((p) => (
            <li key={p.id} className={s.row}>
              <span className={s.rowText}>
                <span className={s.rowTitle}>{p.name}</span>
                <span className={s.rowSub}>
                  {t('home.presetMeta', {
                    n: p.rundown.length,
                    date: new Date(p.updatedAt).toLocaleDateString('en-GB'),
                  })}
                </span>
              </span>
              <Button variant="primary" size="dense" onClick={() => void start(p)}>
                {t('home.startFrom')}
              </Button>
            </li>
          ))}
          {presets?.length === 0 && <li className={s.note}>{t('home.noPresets')}</li>}
        </ul>
        <form onSubmit={createPreset} className={s.top}>
          <TextField
            label={t('home.newPreset')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={80}
            className={s.spacer}
          />
          <Button type="submit" disabled={!newName.trim()}>
            {t('home.addPreset')}
          </Button>
        </form>
        <Button variant="ghost" onClick={() => void start(null)}>
          {t('home.startBlank')}
        </Button>
        <RecentServices />
      </Card>
    </main>
  );
}

interface Recent {
  id: string;
  name: string;
  lifecycle: string;
  createdAt: string;
  wasLive: boolean;
}

/** The last services and how they ended, each with its report (S01, SPEC §9.1). */
function RecentServices() {
  const [recent, setRecent] = useState<Recent[]>([]);
  useEffect(() => {
    void api<Recent[]>('GET', '/api/sessions/recent')
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);
  if (recent.length === 0) return null;
  return (
    <>
      <h2 className="rs-title">{t('home.recent')}</h2>
      <ul className={s.list} aria-label={t('home.recent')}>
        {recent.map((r) => (
          <li key={r.id} className={s.row}>
            <StatusDot tone={r.lifecycle === 'ENDED' ? 'ready' : 'live'} />
            <span className={s.rowText}>
              <span className={s.rowTitle}>{r.name}</span>
              <span className={s.rowSub}>
                {t(r.lifecycle === 'ENDED' ? 'home.outcome.ended' : 'home.outcome.interrupted', {
                  date: new Date(r.createdAt).toLocaleDateString('en-GB'),
                })}
              </span>
            </span>
            <Button size="dense" onClick={() => router.go(`/studio/report/${r.id}`)}>
              {t('home.report')}
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
