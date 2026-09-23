import { useState } from 'react';
import { Button, Card, Logo, TextField } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { api, ApiFailure, setCsrf } from '../lib/api.js';
import s from '../studio/StudioApp.module.css';

export interface Me {
  userId: string;
  name: string;
  email: string;
  role: 'owner' | 'operator';
  csrf: string;
}

/** Two steps: password, then a 6-digit authenticator code or a recovery code (SPEC §6.1). */
export function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (e: unknown) => setError(e instanceof ApiFailure ? e.message : t('signin.failed'));

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setChallenge(
        (await api<{ challenge: string }>('POST', '/api/auth/login', { email, password }))
          .challenge,
      );
      setPassword('');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ csrf: string; recoveryCodesLeft: number }>(
        'POST',
        '/api/auth/mfa',
        useRecovery
          ? { challenge, recoveryCode: code }
          : { challenge, code: code.replace(/\s/g, '') },
      );
      setCsrf(r.csrf);
      onDone();
    } catch (err) {
      // A failed code uses up the challenge: go back to the password step (brute-force protection).
      setChallenge(null);
      setCode('');
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={s.center} data-theme="light">
      <Card className={s.card}>
        <Logo ring={22} />
        <h1 className="rs-title">{t('signin.title')}</h1>
        {!challenge ? (
          <form onSubmit={submitPassword} className={s.form}>
            <TextField
              label={t('signin.email')}
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
            <TextField
              label={t('signin.password')}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              error={error}
            />
            <Button variant="primary" type="submit" disabled={busy || !email || !password}>
              {t('signin.continue')}
            </Button>
          </form>
        ) : (
          <form onSubmit={submitCode} className={s.form}>
            <p className={s.note}>
              {useRecovery ? t('signin.recoveryHelp') : t('signin.codeHelp')}
            </p>
            <TextField
              label={useRecovery ? t('signin.recoveryCode') : t('signin.code')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              mono
              autoFocus
              required
              maxLength={useRecovery ? 20 : 7}
              error={error}
            />
            <Button variant="primary" type="submit" disabled={busy || !code}>
              {t('signin.submit')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setUseRecovery(!useRecovery);
                setCode('');
              }}
            >
              {useRecovery ? t('signin.useCode') : t('signin.useRecovery')}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
