import { useEffect, useState } from 'react';
import { KeyRound, Sparkles } from 'lucide-react';
import type { Settings } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { lang, setLang, t } from '../i18n.ts';
import { useApp } from '../App.tsx';

interface Loaded { settings: Settings; optimized: boolean; reviews: number; minReviews: number }
type Msg = { ok: boolean; text: string } | null;

export const MsgBox = ({ m }: { m: Msg }) => (m ? <div className={m.ok ? 'notice' : 'error'} role={m.ok ? 'status' : 'alert'}>{m.text}</div> : null);

function LoginPassword() {
  const { me, reloadMe } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [current, setCurrent] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  useEffect(() => { if (me) setUsername(me.username || (me.email.split('@')[0] ?? '').toLowerCase()); }, [me]);
  if (!me) return null;
  const needCurrent = me.hasPassword && me.loginMethod === 'password';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== password2) return setMsg({ ok: false, text: t('The passwords do not match') });
    try {
      await api('/api/account/password', { method: 'PUT', body: { username, password, currentPassword: current } });
      setPassword(''); setPassword2(''); setCurrent('');
      setMsg({ ok: true, text: t('Saved. You can now log in with {u} and this password.', { u: username.toLowerCase() }) });
      reloadMe();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  };
  const remove = async () => {
    try {
      await api('/api/account/password', { method: 'DELETE' });
      setMsg({ ok: true, text: t('Password login removed.') });
      reloadMe();
    } catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  };

  return (
    <form className="panel pad" onSubmit={save}>
      <MsgBox m={msg} />
      <p>{me.hasPassword
        ? t('You can log in as {u} with your password, without Authentik.', { u: me.username ?? '' })
        : t('Set a username and password to log in without Authentik, e.g. when Authentik is down.')}</p>
      <div className="row">
        <label className="field"><span>{t('Username')}</span>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required />
        </label>
      </div>
      {needCurrent && (
        <label className="field"><span>{t('Current password')}</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
      )}
      <div className="row">
        <label className="field"><span>{me.hasPassword ? t('New password') : t('Password')}</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required />
        </label>
        <label className="field"><span>{t('Repeat password')}</span>
          <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} autoComplete="new-password" minLength={10} required />
        </label>
      </div>
      <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>{t('At least 10 characters. After a change, other password logins are signed out.')}</p>
      <div className="sticky-actions" style={{ marginTop: 0 }}>
        <button className="btn primary" type="submit"><KeyRound size={16} /> {me.hasPassword ? t('Change password') : t('Set password')}</button>
        {me.hasPassword && me.loginMethod !== 'password' && <button className="btn ghost danger" type="button" onClick={remove}>{t('Remove password login')}</button>}
      </div>
    </form>
  );
}

export function SettingsPage() {
  const [info, setInfo] = useState<Loaded | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [optMsg, setOptMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Loaded>('/api/settings').then((r) => { setInfo(r); setS(r.settings); });
  useEffect(() => { load(); }, []);
  if (!s || !info) return <div className="page narrow" />;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/api/settings', { method: 'PUT', body: s }); setMsg({ ok: true, text: t('Saved. Changes apply from your next review.') }); }
    catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  };
  const optimize = async () => {
    setBusy(true); setOptMsg(null);
    try {
      const r = await api<{ reviews: number }>('/api/fsrs/optimize', { method: 'POST' });
      setOptMsg({ ok: true, text: t('Scheduler fitted to your {n} reviews.', { n: r.reviews }) });
      await load();
    } catch (err) { setOptMsg({ ok: false, text: (err as Error).message }); }
    setBusy(false);
  };
  const changeLanguage = async (l: 'de' | 'en') => {
    await api('/api/me/language', { method: 'PUT', body: { language: l } });
    setLang(l);
  };

  return (
    <div className="page narrow">
      <h1>{t('Settings')}</h1>
      <p className="sub">{t('Scheduling uses FSRS, the same algorithm as current Anki.')}</p>

      <h2>{t('Language')}</h2>
      <div className="panel pad">
        <div className="seg" role="radiogroup" aria-label={t('Language')}>
          <button role="radio" aria-checked={lang === 'de'} className={lang === 'de' ? 'on' : ''} onClick={() => changeLanguage('de')}>Deutsch</button>
          <button role="radio" aria-checked={lang === 'en'} className={lang === 'en' ? 'on' : ''} onClick={() => changeLanguage('en')}>English</button>
        </div>
      </div>

      <h2>{t('Scheduling')}</h2>
      <form className="panel pad" onSubmit={save}>
        <MsgBox m={msg} />
        <div className="row wrap">
          <label className="field"><span>{t('Desired retention: {n} %', { n: Math.round(s.retention * 100) })}</span>
            <input type="range" min={0.7} max={0.97} step={0.01} value={s.retention} onChange={(e) => setS({ ...s, retention: Number(e.target.value) })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </label>
          <label className="field"><span>{t('Maximum interval (days)')}</span>
            <input type="number" min={1} value={s.maxInterval} onChange={(e) => setS({ ...s, maxInterval: Number(e.target.value) })} />
          </label>
        </div>
        <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>{t('The chance you still remember a card when it comes up. Higher means more reviews; 90 % is a good default.')}</p>
        <div className="row wrap">
          <label className="field"><span>{t('Learning steps')}</span>
            <input type="text" value={s.learningSteps} onChange={(e) => setS({ ...s, learningSteps: e.target.value })} placeholder="1m 10m" />
          </label>
          <label className="field"><span>{t('Relearning steps')}</span>
            <input type="text" value={s.relearningSteps} onChange={(e) => setS({ ...s, relearningSteps: e.target.value })} placeholder="10m" />
          </label>
        </div>
        <div className="row wrap">
          <label className="field"><span>{t('Daily goal (cards)')}</span>
            <input type="number" min={1} value={s.dailyGoal} onChange={(e) => setS({ ...s, dailyGoal: Number(e.target.value) })} />
          </label>
          <label className="field"><span>{t('Answer timer (seconds, 0 = off)')}</span>
            <input type="number" min={0} value={s.answerSeconds} onChange={(e) => setS({ ...s, answerSeconds: Number(e.target.value) })} />
          </label>
        </div>
        <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>{t('The timer bar drains while a card is open and shows the answer when it runs out. This is the time for a plain recall card; code and numeric cards get 3×, parametrised problems and derivations 4×.')}</p>
        <button className="btn primary" type="submit">{t('Save')}</button>
      </form>

      <h2>{t('Login without Authentik')}</h2>
      <LoginPassword />

      <h2>{t('Fit the scheduler to your memory')}</h2>
      <div className="panel pad">
        <MsgBox m={optMsg} />
        <p>{t('FSRS starts with parameters that fit an average learner. With enough of your own review history it can be fitted to how you actually forget.')}</p>
        <p className="muted">
          {info.optimized ? t('You are using fitted parameters.') : t('You are using the default parameters.')}{' '}
          {info.reviews < info.minReviews
            ? t('Fitting needs {a} reviews; you have {b}.', { a: info.minReviews, b: info.reviews })
            : t('You have {n} reviews.', { n: info.reviews })}
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" disabled={busy || info.reviews < info.minReviews} onClick={optimize}>
            <Sparkles size={16} /> {busy ? t('Fitting…') : info.optimized ? t('Fit again') : t('Fit to my reviews')}
          </button>
          {info.optimized && (
            <button className="btn ghost" onClick={async () => { await api('/api/fsrs/optimize', { method: 'DELETE' }); setOptMsg({ ok: true, text: t('Back to the default parameters.') }); load(); }}>
              {t('Reset to defaults')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
