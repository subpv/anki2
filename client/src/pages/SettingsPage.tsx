import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Sparkles, Upload } from 'lucide-react';
import type { Settings } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useApp } from '../App.tsx';

interface DeckInfo { id: string; title: string; description: string; course: string; words: number; pictures: number }

interface Loaded { settings: Settings; optimized: boolean; reviews: number; minReviews: number }

/** Settings and Import share state and helpers; `section` picks which half is shown. */
export function SettingsPage({ section = 'settings' }: { section?: 'settings' | 'import' }) {
  const { courses, refresh } = useApp();
  const [info, setInfo] = useState<Loaded | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [optMsg, setOptMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [impMsg, setImpMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [importCourse, setImportCourse] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [decks, setDecks] = useState<DeckInfo[]>([]);
  const [deckTarget, setDeckTarget] = useState<Record<string, string>>({});
  const [deckMsg, setDeckMsg] = useState<{ ok: boolean; text: string; courseId?: number } | null>(null);
  const [words, setWords] = useState<File | null>(null);
  const [wordsCourse, setWordsCourse] = useState('');
  const [wordsMsg, setWordsMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api<Loaded>('/api/settings').then((r) => { setInfo(r); setS(r.settings); });
  useEffect(() => { load(); api<DeckInfo[]>('/api/decks').then(setDecks); }, []);
  useEffect(() => { if (!wordsCourse && courses?.length) setWordsCourse(String(courses[0].id)); }, [courses, wordsCourse]);
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

  const addDeck = async (d: DeckInfo) => {
    setBusy(`deck-${d.id}`); setDeckMsg(null);
    try {
      const target = deckTarget[d.id] ?? '';
      const r = await api<{ courseId: number; added: number; existing: number }>(`/api/decks/${d.id}/import`, { body: { courseId: target ? Number(target) : null } });
      await refresh();
      setDeckMsg({
        ok: true, courseId: r.courseId,
        text: r.added
          ? `Added ${r.added} words (${r.added * 2} cards)${r.existing ? `; ${r.existing} were already there` : ''}.`
          : 'All words are already in that course.',
      });
    } catch (err) { setDeckMsg({ ok: false, text: (err as Error).message }); }
    setBusy('');
  };
  const importWords = async () => {
    if (!words) return;
    setBusy('words'); setWordsMsg(null);
    try {
      const form = new FormData();
      form.append('file', words);
      const r = await api<{ added: number; existing: number; skipped: number }>(`/api/import/words?course=${wordsCourse}`, { form });
      setWordsMsg({ ok: true, text: `Added ${r.added} words${r.existing ? `, ${r.existing} were already there` : ''}${r.skipped ? `, skipped ${r.skipped} lines without a meaning` : ''}.` });
      setWords(null);
      await refresh();
    } catch (err) { setWordsMsg({ ok: false, text: (err as Error).message }); }
    setBusy('');
  };

  return (
    <div className="page narrow">
      {section === 'settings' ? (
        <>
          <h1>Settings</h1>
          <p className="sub">Scheduling uses FSRS, the same algorithm as current Anki.</p>
        </>
      ) : (
        <>
          <h1>Import</h1>
          <p className="sub">Add a ready-made deck, your own word list, or an Anki deck.</p>
        </>
      )}

      {section === 'settings' && (
        <>
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

        </>
      )}

      {section === 'import' && (
        <>
      <h2>Ready-made decks</h2>
      <div className="panel pad">
        {deckMsg && (
          <div className={deckMsg.ok ? 'notice' : 'error'}>
            {deckMsg.text} {deckMsg.courseId && <Link to={`/course/${deckMsg.courseId}`}>Open the course</Link>}
          </div>
        )}
        {decks.length === 0 && <p className="muted">No decks available.</p>}
        {decks.map((d) => (
          <div key={d.id} className="deck">
            <div className="deck-flag"><BookOpen size={30} /></div>
            <div className="grow">
              <h3>{d.title}</h3>
              <p className="muted" style={{ marginBottom: 4 }}>{d.description}</p>
              <p className="hint">{d.words} words, both directions · {d.pictures} with a picture</p>
              <div className="actions">
                <select value={deckTarget[d.id] ?? ''} onChange={(e) => setDeckTarget({ ...deckTarget, [d.id]: e.target.value })} aria-label="Course to add the deck to">
                  <option value="">{courses?.some((c) => c.name === d.course) ? `Course “${d.course}”` : `New course “${d.course}”`}</option>
                  {courses?.filter((c) => c.name !== d.course).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="btn primary" disabled={busy === `deck-${d.id}`} onClick={() => addDeck(d)}>
                  {busy === `deck-${d.id}` ? 'Adding…' : 'Add deck'}
                </button>
              </div>
            </div>
          </div>
        ))}
        <p className="hint" style={{ marginTop: 14 }}>Words are introduced in list order, most important first, at the course's new-cards-per-day rate. Adding a deck again only adds words that are missing.</p>
      </div>

      <h2>Import a word list</h2>
      <div className="panel pad">
        <Msg m={wordsMsg} />
        <p>A text or CSV file with one word per line: the word, its meaning, and optionally a picture (emoji or image link) and a note, separated by a tab, <code>|</code> or <code>;</code>. Each line becomes two cards, one for each direction.</p>
        <pre className="example">{'en hund | der Hund | 🐕 | Pl. hunde\nat spise | essen | 🍽️ | spiste, spist\ngod | gut'}</pre>
        {courses && courses.length === 0 ? <p className="muted">Create a course first to import into.</p> : (
          <div className="row">
            <label className="field"><span>Into course</span>
              <select value={wordsCourse} onChange={(e) => setWordsCourse(e.target.value)}>
                {courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="btn fit" style={{ marginBottom: 14 }}>
              <Upload size={16} /> {words ? words.name : 'Choose file'}
              <input type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" hidden onChange={(e) => setWords(e.target.files?.[0] ?? null)} />
            </label>
            <button className="btn primary fit" style={{ marginBottom: 14 }} disabled={!words || busy === 'words'} onClick={importWords}>{busy === 'words' ? 'Importing…' : 'Import'}</button>
          </div>
        )}
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
        </>
      )}
    </div>
  );
}
