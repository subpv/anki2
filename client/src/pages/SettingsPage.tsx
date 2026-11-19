import { useEffect, useState } from 'react';
import { Sparkles, Upload } from 'lucide-react';
import type { Settings } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useApp } from '../App.tsx';

interface Loaded { settings: Settings; optimized: boolean; reviews: number; minReviews: number }

export function SettingsPage() {
  const { courses, refresh } = useApp();
  const [info, setInfo] = useState<Loaded | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [optMsg, setOptMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [impMsg, setImpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [importCourse, setImportCourse] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const load = () => api<Loaded>('/api/settings').then((r) => { setInfo(r); setS(r.settings); });
  useEffect(() => { load(); }, []);
  useEffect(() => { if (!importCourse && courses?.length) setImportCourse(String(courses[0].id)); }, [courses, importCourse]);
  if (!s || !info) return <div className="page narrow" />;

  const Msg = ({ m }: { m: { ok: boolean; text: string } | null }) => (m ? <div className={m.ok ? 'notice' : 'error'}>{m.text}</div> : null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('/api/settings', { method: 'PUT', body: s }); setMsg({ ok: true, text: 'Saved. Changes apply from your next review.' }); }
    catch (err) { setMsg({ ok: false, text: (err as Error).message }); }
  };
  const optimize = async () => {
    setBusy('opt'); setOptMsg(null);
    try {
      const r = await api<{ reviews: number }>('/api/fsrs/optimize', { method: 'POST' });
      setOptMsg({ ok: true, text: `Scheduler fitted to your ${r.reviews} reviews.` });
      await load();
    } catch (err) { setOptMsg({ ok: false, text: (err as Error).message }); }
    setBusy('');
  };
  const doImport = async () => {
    if (!file) return;
    setBusy('imp'); setImpMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await api<{ notes: number; cards: number; media: number; skipped: number }>(`/api/import/apkg?course=${importCourse}`, { form });
      setImpMsg({ ok: true, text: `Imported ${r.notes} notes (${r.cards} cards, ${r.media} images)${r.skipped ? `, skipped ${r.skipped} empty notes` : ''}.` });
      setFile(null);
      await refresh();
    } catch (err) { setImpMsg({ ok: false, text: (err as Error).message }); }
    setBusy('');
  };

  return (
    <div className="page narrow">
      <h1>Settings</h1>
      <p className="sub">Scheduling uses FSRS, the same algorithm as current Anki.</p>

      <h2>Scheduling</h2>
      <form className="panel pad" onSubmit={save}>
        <Msg m={msg} />
        <div className="row">
          <label className="field"><span>Desired retention: {Math.round(s.retention * 100)} %</span>
            <input type="range" min={0.7} max={0.97} step={0.01} value={s.retention} onChange={(e) => setS({ ...s, retention: Number(e.target.value) })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </label>
          <label className="field"><span>Maximum interval (days)</span>
            <input type="number" min={1} value={s.maxInterval} onChange={(e) => setS({ ...s, maxInterval: Number(e.target.value) })} />
          </label>
        </div>
        <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>The chance you still remember a card when it comes up. Higher means more reviews; 90 % is a good default.</p>
        <div className="row">
          <label className="field"><span>Learning steps</span>
            <input type="text" value={s.learningSteps} onChange={(e) => setS({ ...s, learningSteps: e.target.value })} placeholder="1m 10m" />
          </label>
          <label className="field"><span>Relearning steps</span>
            <input type="text" value={s.relearningSteps} onChange={(e) => setS({ ...s, relearningSteps: e.target.value })} placeholder="10m" />
          </label>
        </div>
        <div className="row">
          <label className="field"><span>Daily goal (cards)</span>
            <input type="number" min={1} value={s.dailyGoal} onChange={(e) => setS({ ...s, dailyGoal: Number(e.target.value) })} />
          </label>
          <label className="field"><span>Answer timer (seconds, 0 = off)</span>
            <input type="number" min={0} value={s.answerSeconds} onChange={(e) => setS({ ...s, answerSeconds: Number(e.target.value) })} />
          </label>
        </div>
        <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>The timer bar drains while a card is open and shows the answer when it runs out. This is the time for a plain recall card; code and numeric cards get 3×, parametrised problems and derivations 4×.</p>
        <button className="btn primary" type="submit">Save</button>
      </form>

      <h2>Fit the scheduler to your memory</h2>
      <div className="panel pad">
        <Msg m={optMsg} />
        <p>FSRS starts with parameters that fit an average learner. With enough of your own review history it can be fitted to how you actually forget.</p>
        <p className="muted">
          {info.optimized ? 'You are using fitted parameters. ' : 'You are using the default parameters. '}
          {info.reviews < info.minReviews
            ? `Fitting needs ${info.minReviews} reviews; you have ${info.reviews}.`
            : `You have ${info.reviews} reviews.`}
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={busy === 'opt' || info.reviews < info.minReviews} onClick={optimize}>
            <Sparkles size={16} /> {busy === 'opt' ? 'Fitting…' : info.optimized ? 'Fit again' : 'Fit to my reviews'}
          </button>
          {info.optimized && (
            <button className="btn ghost" onClick={async () => { await api('/api/fsrs/optimize', { method: 'DELETE' }); setOptMsg({ ok: true, text: 'Back to the default parameters.' }); load(); }}>
              Reset to defaults
            </button>
          )}
        </div>
      </div>

      <h2>Import from Anki</h2>
      <div className="panel pad">
        <Msg m={impMsg} />
        <p>Import an Anki deck package (<code>.apkg</code>). Notes come in as Basic or Cloze cards with their images and tags. They start as new cards; Anki's review history is not carried over.</p>
        {courses && courses.length === 0 ? <p className="muted">Create a course first to import into.</p> : (
          <div className="row">
            <label className="field"><span>Into course</span>
              <select value={importCourse} onChange={(e) => setImportCourse(e.target.value)}>
                {courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="btn fit" style={{ marginBottom: 14 }}>
              <Upload size={16} /> {file ? file.name : 'Choose .apkg file'}
              <input type="file" accept=".apkg,.colpkg" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <button className="btn primary fit" style={{ marginBottom: 14 }} disabled={!file || busy === 'imp'} onClick={doImport}>{busy === 'imp' ? 'Importing…' : 'Import'}</button>
          </div>
        )}
      </div>
    </div>
  );
}
