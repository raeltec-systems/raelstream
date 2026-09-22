import { useEffect, useState } from 'react';
import type { SessionSnapshot } from '@raelstream/contracts';
import { Button, Card, Logo, TextField } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { api, ApiFailure, setCsrf } from '../lib/api.js';
import { router } from '../lib/router.js';
import { studioRuntime } from './runtime.js';
import { Preparation } from './Preparation.js';
import { Live } from './Live.js';
import s from './StudioApp.module.css';

type Me = { name: string; csrf: string; devAuth: boolean };

export function StudioApp({ path }: { path: string }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [session, setSession] = useState<SessionSnapshot | null | undefined>(undefined);

  useEffect(() => {
    api<Me>('GET', '/api/auth/me')
      .then((m) => {
        setCsrf(m.csrf);
        setMe(m);
      })
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!me) return;
    api<SessionSnapshot | null>('GET', '/api/sessions/active').then((snap) => {
      setSession(snap);
      if (snap) void studioRuntime().attach(snap);
    });
  }, [me]);

  if (me === undefined) return null;
  if (me === null) return <DevLogin onDone={setMe} />;
  if (session === undefined) return null;
  if (session === null)
    return (
      <NewService
        operator={me.name}
        onCreated={(snap) => {
          setSession(snap);
          void studioRuntime().attach(snap);
        }}
      />
    );
  return path.startsWith('/studio/live') ? <Live /> : <Preparation operator={me.name} />;
}

function DevLogin({ onDone }: { onDone: (m: Me) => void }) {
  const [name, setName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await api<{ name: string; csrf: string }>('POST', '/api/dev/login', {
        name,
        passphrase,
      });
      setCsrf(r.csrf);
      onDone({ ...r, devAuth: true });
    } catch (err) {
      setError(
        err instanceof ApiFailure && err.status === 404
          ? t('login.devDisabled')
          : t('login.failed'),
      );
    }
  }
  return (
    <main className={s.center} data-theme="light">
      <Card className={s.card}>
        <Logo ring={22} />
        <h1 className="rs-title">{t('login.title')}</h1>
        <p className={s.note}>{t('login.devNote')}</p>
        <form onSubmit={submit} className={s.form}>
          <TextField
            label={t('login.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
            maxLength={40}
          />
          <TextField
            label={t('login.passphrase')}
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            required
            autoComplete="current-password"
            error={error}
          />
          <Button variant="primary" type="submit" disabled={!name.trim() || !passphrase}>
            {t('login.submit')}
          </Button>
        </form>
      </Card>
    </main>
  );
}

function NewService({
  operator,
  onCreated,
}: {
  operator: string;
  onCreated: (s: SessionSnapshot) => void;
}) {
  const [name, setName] = useState(t('home.defaultName'));
  const [error, setError] = useState<string | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      onCreated(await api<SessionSnapshot>('POST', '/api/sessions', { name }));
      router.go('/studio');
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : t('home.createFailed'));
    }
  }
  return (
    <main className={s.center} data-theme="light">
      <Card className={s.card}>
        <Logo ring={22} />
        <div className="rs-overline">{t('home.signedInAs', { name: operator })}</div>
        <h1 className="rs-h1">{t('home.title')}</h1>
        <p className={s.note}>{t('home.noBroadcast')}</p>
        <form onSubmit={create} className={s.form}>
          <TextField
            label={t('home.serviceName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            error={error}
          />
          <Button variant="primary" type="submit" disabled={!name.trim()}>
            {t('home.start')}
          </Button>
        </form>
      </Card>
    </main>
  );
}
