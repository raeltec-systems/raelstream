import { useEffect, useState } from 'react';
import { Button, Card, Logo, StatusDot, type Tone } from '@raelstream/ui';
import { t } from '@raelstream/i18n';
import { api, ApiFailure } from '../lib/api.js';
import { router } from '../lib/router.js';
import s from './StudioApp.module.css';

type CheckStatus = 'Passed' | 'Failed' | 'Not tested' | 'Inconclusive';
interface Stat {
  min: number;
  avg: number;
  max: number;
  windows: number;
}
interface Report {
  service: {
    name: string;
    lifecycle: string;
    profile: string | null;
    createdAt: string;
    startedAt: string | null;
    endedAt: string | null;
    endReason: string | null;
  };
  checks: Array<{ name: string; status: CheckStatus; detail: string }>;
  destinations: Array<{
    platform: string;
    label: string;
    finalState: string;
    reconnects: number | null;
    failure: string | null;
    liveConfirmation: { by: string; at: string } | null;
  }>;
  stats: Record<string, Stat | number | null>;
  qualityChanges: Array<{ at: string; kind: string; data: Record<string, unknown> }>;
  recordings: Array<{ name: string; url: string; bytes: number; expiresAt: string }>;
  timeline: Array<{ at: string; kind: string; severity: string; actor: string }>;
}

const TONE: Record<CheckStatus, Tone> = {
  Passed: 'ready',
  Failed: 'live',
  'Not tested': 'off',
  Inconclusive: 'standby',
};
const STAT_LABEL: Record<string, string> = {
  cameraFps: 'report.stat.cameraFps',
  cameraLossPct: 'report.stat.cameraLoss',
  cameraRttMs: 'report.stat.cameraRtt',
  uploadMbps: 'report.stat.upload',
  uploadRttMs: 'report.stat.uploadRtt',
  encodeFps: 'report.stat.encodeFps',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB') : '—');

/**
 * Service report (S06, SPEC §19). Every check says Passed, Failed, Not tested or Inconclusive in
 * words; a missing measurement is "unavailable", never a green default (A45).
 */
export function ServiceReport({ id }: { id: string }) {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Report>('GET', `/api/sessions/${id}/report`)
      .then(setR)
      .catch((e) => setError(e instanceof ApiFailure ? e.message : String(e)));
  }, [id]);

  function download() {
    if (!r) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `raelstream-report-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className={s.center} data-theme="light">
      <Card className={`${s.card} ${s.wide}`}>
        <div className={s.top}>
          <Logo ring={22} />
          <span className={s.spacer} />
          <Button size="dense" onClick={download} disabled={!r}>
            {t('report.download')}
          </Button>
          <Button size="dense" onClick={() => router.go('/studio')}>
            {t('settings.back')}
          </Button>
        </div>
        {error && (
          <p className={s.warnText} role="alert">
            {error}
          </p>
        )}
        {r && (
          <>
            <h1 className="rs-h1">{r.service.name}</h1>
            <p className={s.note}>
              {t('report.summary', {
                state: r.service.lifecycle,
                started: when(r.service.startedAt),
                ended: when(r.service.endedAt),
                profile: r.service.profile ?? '—',
              })}
            </p>

            <h2 className="rs-title">{t('report.checks')}</h2>
            <ul className={s.list} data-testid="report-checks">
              {r.checks.map((c) => (
                <li key={c.name} className={s.row}>
                  <StatusDot tone={TONE[c.status]} />
                  <span className={s.rowText}>
                    <span className={s.rowTitle}>{c.name}</span>
                    <span className={s.rowSub}>{c.detail}</span>
                  </span>
                  <b>{t(`report.status.${c.status.replace(' ', '')}` as never)}</b>
                </li>
              ))}
            </ul>

            {r.destinations.length > 0 && (
              <>
                <h2 className="rs-title">{t('report.destinations')}</h2>
                <ul className={s.list}>
                  {r.destinations.map((d) => (
                    <li key={d.label} className={s.row}>
                      <span className={s.rowText}>
                        <span className={s.rowTitle}>{d.label}</span>
                        <span className={s.rowSub}>
                          {t('report.destLine', {
                            state: d.finalState,
                            reconnects: d.reconnects ?? '—',
                            checked: d.liveConfirmation
                              ? t('report.checkedBy', {
                                  by: d.liveConfirmation.by,
                                  at: when(d.liveConfirmation.at),
                                })
                              : t('report.notChecked'),
                          })}
                          {d.failure ? ` · ${d.failure}` : ''}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h2 className="rs-title">{t('report.measurements')}</h2>
            <ul className={s.list} data-testid="report-stats">
              {Object.entries(STAT_LABEL).map(([k, label]) => {
                const v = r.stats[k] as Stat | null;
                return (
                  <li key={k} className={s.row}>
                    <span className={s.rowText}>
                      <span className={s.rowTitle}>{t(label as never)}</span>
                    </span>
                    <span>
                      {v
                        ? t('report.minAvgMax', { min: v.min, avg: v.avg, max: v.max })
                        : t('report.unavailable')}
                    </span>
                  </li>
                );
              })}
            </ul>

            {r.qualityChanges.length > 0 && (
              <>
                <h2 className="rs-title">{t('report.qualityChanges')}</h2>
                <ul className={s.list}>
                  {r.qualityChanges.map((q) => (
                    <li key={q.at + q.kind} className={s.row}>
                      <span className={s.rowSub}>{when(q.at)}</span>
                      <span className={s.rowText}>
                        {t(`event.${q.kind}` as never, q.data as never)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {r.recordings.length > 0 && (
              <>
                <h2 className="rs-title">{t('rec.title')}</h2>
                <ul className={s.list}>
                  {r.recordings.map((f) => (
                    <li key={f.url} className={s.row}>
                      <a href={f.url} download className={s.rowText}>
                        {f.name}
                      </a>
                      <span className={s.rowSub}>
                        {t('report.expires', {
                          when: new Date(f.expiresAt).toLocaleDateString('en-GB'),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h2 className="rs-title">{t('report.timeline')}</h2>
            <ol className={s.list}>
              {r.timeline.map((e, i) => (
                <li key={i} className={s.row}>
                  <span className={s.rowSub}>{when(e.at)}</span>
                  <span className={s.rowText}>
                    {t('report.timelineRow', { kind: e.kind, actor: e.actor })}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </Card>
    </main>
  );
}
