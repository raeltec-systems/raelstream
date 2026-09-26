import { useEffect, useState } from 'react';
import type { DestinationInput, DestinationSummary } from '@raelstream/contracts';
import { Button, SecretField, Segmented, StatusDot, TextField } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { api, ApiFailure } from '../lib/api.js';
import { studioRuntime } from './runtime.js';
import s from './StudioApp.module.css';

type Platform = DestinationInput['platform'];
interface Server {
  platform: Platform;
  url: string;
}
type Draft = Omit<DestinationInput, 'watchUrl'> & { watchUrl: string };

function blank(platform: Platform, servers: Server[]): Draft {
  return {
    platform,
    label: platform === 'facebook' ? 'Facebook Page' : 'YouTube',
    serverUrl: servers.find((x) => x.platform === platform)?.url ?? '',
    // Defaults per platform (SPEC §13.1): Facebook issues a new key per event (I-13).
    keyMode: platform === 'facebook' ? 'per_event' : 'persistent',
    autoPublishesOnIngest: 'unknown',
    watchUrl: '',
    eventReference: '',
  };
}

/** Owner: where services can go (SPEC §13.1). Keys are write-only: replaced, never revealed. */
export function DestinationsEditor() {
  const [list, setList] = useState<DestinationSummary[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft; key: string } | null>(
    null,
  );
  const [status, setStatus] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setList(await api<DestinationSummary[]>('GET', '/api/destinations'));
    void studioRuntime().loadDestinations();
  };
  useEffect(() => {
    void load();
    void api<Server[]>('GET', '/api/destinations/servers').then(setServers);
  }, []);

  async function save() {
    if (!editing) return;
    setError(null);
    const { id, draft, key } = editing;
    try {
      if (id) {
        await api('PATCH', `/api/destinations/${id}`, draft);
        if (key) await api('PUT', `/api/destinations/${id}/key`, { key });
      } else {
        await api('POST', '/api/destinations', {
          ...draft,
          ...(key && draft.keyMode === 'persistent' ? { key } : {}),
        });
      }
      setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : String(e));
    }
  }

  async function check(d: DestinationSummary) {
    setStatus((x) => ({ ...x, [d.id]: t('destEdit.checking') }));
    try {
      await api('POST', `/api/destinations/${d.id}/validate`);
      setStatus((x) => ({ ...x, [d.id]: t('destEdit.reachable') }));
    } catch (e) {
      setStatus((x) => ({ ...x, [d.id]: e instanceof ApiFailure ? e.message : String(e) }));
    }
  }

  async function remove(d: DestinationSummary) {
    if (!window.confirm(t('destEdit.removeConfirm', { name: d.label }))) return;
    await api('DELETE', `/api/destinations/${d.id}`);
    await load();
  }

  const draft = editing?.draft;
  const set = (p: Partial<Draft>) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...p } } : e));

  return (
    <section aria-labelledby="rs-dest-title" className={s.themeEditor}>
      <h2 className="rs-title" id="rs-dest-title">
        {t('destEdit.title')}
      </h2>
      <p className={s.note}>{t('destEdit.body')}</p>
      <ul className={s.list}>
        {list.map((d) => (
          <li key={d.id} className={s.row}>
            <StatusDot tone={d.keyMode === 'per_event' || d.keyLast4 ? 'ready' : 'standby'} />
            <span className={s.rowText}>
              <span className={s.rowTitle}>
                {d.label} · {d.platform === 'facebook' ? 'Facebook' : 'YouTube'}
              </span>
              <span className={s.rowSub}>
                {d.keyMode === 'per_event'
                  ? t('destEdit.perEvent')
                  : d.keyLast4
                    ? t('destEdit.keySaved', { last4: d.keyLast4 })
                    : t('destEdit.noKey')}
                {' · '}
                {t(`destEdit.auto.${d.autoPublishesOnIngest}`)}
                {status[d.id] ? ` · ${status[d.id]}` : ''}
              </span>
            </span>
            <Button size="dense" onClick={() => void check(d)}>
              {t('destEdit.check')}
            </Button>
            <Button
              size="dense"
              onClick={() =>
                setEditing({
                  id: d.id,
                  key: '',
                  draft: {
                    platform: d.platform,
                    label: d.label,
                    serverUrl: d.serverUrl,
                    keyMode: d.keyMode,
                    autoPublishesOnIngest: d.autoPublishesOnIngest,
                    watchUrl: d.watchUrl ?? '',
                    eventReference: d.eventReference,
                  },
                })
              }
            >
              {t('destEdit.edit')}
            </Button>
            <Button size="dense" variant="dangerTrigger" onClick={() => void remove(d)}>
              {t('destEdit.remove')}
            </Button>
          </li>
        ))}
      </ul>
      {!editing && (
        <div className={s.top}>
          <Button
            onClick={() => setEditing({ id: null, key: '', draft: blank('youtube', servers) })}
          >
            {t('destEdit.addYoutube')}
          </Button>
          <Button
            onClick={() => setEditing({ id: null, key: '', draft: blank('facebook', servers) })}
          >
            {t('destEdit.addFacebook')}
          </Button>
        </div>
      )}
      {editing && draft && (
        <div className={s.themeForm} data-testid="dest-form">
          <TextField
            label={t('destEdit.label')}
            value={draft.label}
            maxLength={60}
            onChange={(e) => set({ label: e.target.value })}
          />
          <label className={s.fieldLabel} htmlFor="rs-dest-server">
            {t('destEdit.server')}
          </label>
          <select
            id="rs-dest-server"
            className={s.select}
            value={draft.serverUrl}
            onChange={(e) => set({ serverUrl: e.target.value })}
          >
            {servers
              .filter((x) => x.platform === draft.platform)
              .map((x) => (
                <option key={x.url} value={x.url}>
                  {x.url}
                </option>
              ))}
          </select>
          <Segmented<Draft['keyMode']>
            label={t('destEdit.keyMode')}
            value={draft.keyMode}
            onChange={(keyMode) => set({ keyMode })}
            options={[
              { value: 'per_event', label: t('destEdit.keyMode.perEvent') },
              { value: 'persistent', label: t('destEdit.keyMode.persistent') },
            ]}
          />
          {draft.keyMode === 'persistent' ? (
            <SecretField
              label={t('destEdit.key')}
              masked={editing.key ? `••••${editing.key.slice(-4)}` : null}
              placeholder={editing.id ? t('destEdit.keyKeep') : t('destEdit.keyPaste')}
              pasteLabel={t('prep.dest.paste')}
              helper={t('destEdit.keyHelp')}
              onPaste={(key) => setEditing((e) => (e ? { ...e, key } : e))}
            />
          ) : (
            <p className={s.note}>{t('destEdit.perEventHelp')}</p>
          )}
          <Segmented<Draft['autoPublishesOnIngest']>
            label={t('destEdit.autoPublishes')}
            value={draft.autoPublishesOnIngest}
            onChange={(autoPublishesOnIngest) => set({ autoPublishesOnIngest })}
            options={[
              { value: 'no', label: t('destEdit.auto.no') },
              { value: 'yes', label: t('destEdit.auto.yes') },
              { value: 'unknown', label: t('destEdit.auto.unknown') },
            ]}
          />
          <p className={s.note}>
            {draft.platform === 'youtube' ? t('destEdit.autoHelpYt') : t('destEdit.autoHelpFb')}
          </p>
          <TextField
            label={t('destEdit.watchUrl')}
            value={draft.watchUrl}
            maxLength={300}
            placeholder="https://"
            onChange={(e) => set({ watchUrl: e.target.value })}
          />
          <TextField
            label={t('destEdit.eventReference')}
            value={draft.eventReference}
            maxLength={120}
            onChange={(e) => set({ eventReference: e.target.value })}
          />
          {error && (
            <p className={s.warnText} role="alert">
              {error}
            </p>
          )}
          <div className={s.top}>
            <Button variant="primary" onClick={() => void save()}>
              {t('destEdit.save')}
            </Button>
            <Button onClick={() => setEditing(null)}>{t('destEdit.cancel')}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
