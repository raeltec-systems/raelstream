import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button, Card, Logo, TextField } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { api, ApiFailure, setCsrf } from '../lib/api.js';
import s from '../studio/StudioApp.module.css';

interface Enrolment {
  secret: string;
  otpauthUri: string;
  recoveryCodes: string[];
}

/**
 * Operator invite: details → authenticator enrolment (QR, key, recovery codes shown once) → first code
 * confirms the authenticator and signs the operator in (SPEC §6.1).
 */
export function InviteApp() {
  // Read the secret once (a state initialiser survives React's dev double-mount), then clear it from
  // the address bar in the effect.
  const [token] = useState(() => /^#t=([A-Za-z0-9_-]{43})$/.exec(location.hash)?.[1] ?? null);
  const [invitedBy, setInvitedBy] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [enrol, setEnrol] = useState<{ challenge: string; enrolment: Enrolment } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return setInvalid(true);
    history.replaceState(null, '', location.pathname);
    api<{ invitedBy: string }>('POST', '/api/invites/preview', { token })
      .then((r) => setInvitedBy(r.invitedBy))
      .catch(() => setInvalid(true));
  }, [token]);

  useEffect(() => {
    if (enrol)
      void QRCode.toDataURL(enrol.enrolment.otpauthUri, { margin: 1, width: 360 }).then(setQr);
  }, [enrol]);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm) return setError(t('invite.mismatch'));
    try {
      setEnrol(
        await api('POST', '/api/invites/accept', {
          token,
          name: form.name,
          email: form.email,
          password: form.password,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : t('signin.failed'));
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ csrf: string }>('POST', '/api/auth/mfa', {
        challenge: enrol!.challenge,
        code: code.replace(/\s/g, ''),
      });
      setCsrf(r.csrf);
      window.location.assign('/studio');
    } catch {
      setError(t('invite.codeFailed'));
    }
  }

  return (
    <main className={s.center} data-theme="light">
      <Card className={s.card}>
        <Logo ring={22} />
        {invalid && (
          <>
            <h1 className="rs-title">{t('invite.invalidTitle')}</h1>
            <p className={s.note}>{t('invite.invalidBody')}</p>
          </>
        )}
        {!invalid && !enrol && invitedBy && (
          <form onSubmit={accept} className={s.form}>
            <h1 className="rs-title">{t('invite.title')}</h1>
            <p className={s.note}>{t('invite.body', { name: invitedBy })}</p>
            <TextField
              label={t('invite.name')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              maxLength={60}
              autoComplete="name"
            />
            <TextField
              label={t('signin.email')}
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              autoComplete="username"
            />
            <TextField
              label={t('invite.password')}
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              autoComplete="new-password"
              helper={t('invite.passwordHelp')}
            />
            <TextField
              label={t('invite.confirm')}
              type="password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              required
              autoComplete="new-password"
              error={error}
            />
            <Button variant="primary" type="submit">
              {t('invite.create')}
            </Button>
          </form>
        )}
        {enrol && (
          <form onSubmit={confirm} className={s.form}>
            <h1 className="rs-title">{t('invite.enrolTitle')}</h1>
            <p className={s.note}>{t('invite.enrolBody')}</p>
            {qr && <img className={s.qr} src={qr} alt={t('invite.qrAlt')} />}
            <div className={s.mono} data-testid="totp-secret">
              {enrol.enrolment.secret.replace(/(.{4})/g, '$1 ').trim()}
            </div>
            <div className={s.recovery}>
              <b>{t('invite.recoveryTitle')}</b>
              <p className={s.note}>{t('invite.recoveryBody')}</p>
              <ol className={s.codes} data-testid="recovery-codes">
                {enrol.enrolment.recoveryCodes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ol>
              <label className={s.check}>
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(e) => setSaved(e.target.checked)}
                />{' '}
                {t('invite.saved')}
              </label>
            </div>
            <TextField
              label={t('signin.code')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              mono
              maxLength={7}
              required
              error={error}
            />
            <Button variant="primary" type="submit" disabled={!saved || !code}>
              {t('invite.finish')}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
