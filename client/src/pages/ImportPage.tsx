import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ClipboardPaste, FileUp, Upload } from 'lucide-react';
import { api, ApiError } from '../api.ts';
import { lang, t, tn } from '../i18n.ts';
import { useApp } from '../App.tsx';
import { MsgBox } from './SettingsPage.tsx';

interface DeckInfo {
  id: string; title: string; description: string; titleDe: string; descriptionDe: string; course: string; words: number; pictures: number;
}
interface Problem { index: number; type: string; code: string; field?: string }
type Msg = { ok: boolean; text: string; courseId?: number } | null;

/** Explain one problem of a JSON import in the interface language. */
function problemText(p: Problem): string {
  const f = p.field ?? '';
  const what = (() => {
    switch (p.code) {
      case 'invalid-json': return t('This is not valid JSON ({x}).', { x: f });
      case 'no-notes': return t('No "notes" list found.');
      case 'not-object': return t('Not a card object.');
      case 'unknown-type': return t('Unknown card type "{x}".', { x: f });
      case 'missing': return t('Field "{x}" is missing or empty.', { x: f });
      case 'no-cloze': return t('No cloze deletion like {{c1::…}} in "{x}".', { x: f });
      case 'not-number': return t('"{x}" must be a number.', { x: f });
      case 'not-list': return t('"{x}" is missing or not a valid list.', { x: f });
      case 'bad-var': return t('Variable "{x}" needs a name (letters/digits) and numbers min ≤ max and step.', { x: f });
      case 'bad-url': return t('"{x}" must start with http:// or https://.', { x: f });
      case 'no-cards': return t('This would not create any cards.');
      default: return p.code;
    }
  })();
  return p.index > 0 ? `${t('Card {n}', { n: p.index })}${p.type ? ` (${p.type})` : ''}: ${what}` : what;
}

export function ImportPage() {
  const { courses, refresh } = useApp();
  const [busy, setBusy] = useState('');

  // Paste or load text
  const [text, setText] = useState('');
  const [target, setTarget] = useState('new');
  const [newName, setNewName] = useState('');
  const [textMsg, setTextMsg] = useState<Msg>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Ready-made decks
  const [decks, setDecks] = useState<DeckInfo[]>([]);
  const [deckTarget, setDeckTarget] = useState<Record<string, string>>({});
  const [deckMsg, setDeckMsg] = useState<Msg>(null);

  // Anki
  const [apkg, setApkg] = useState<File | null>(null);
  const [apkgCourse, setApkgCourse] = useState('');
  const [apkgMsg, setApkgMsg] = useState<Msg>(null);

  useEffect(() => { api<DeckInfo[]>('/api/decks').then(setDecks); }, []);
  useEffect(() => { if (!apkgCourse && courses?.length) setApkgCourse(String(courses[0].id)); }, [courses, apkgCourse]);

  // Suggest the course name from pasted JSON.
  const jsonCourse = (() => {
    const s = text.trim();
    if (!s.startsWith('{')) return '';
    const m = s.match(/"course"\s*:\s*"([^"]{1,80})"/);
    return m ? m[1] : '';
  })();
  const kind = /^\s*(\{|\[|```)/.test(text) ? 'json' : text.trim() ? 'words' : '';

  const importText = async () => {
    setBusy('text'); setTextMsg(null); setProblems([]);
    try {
      const body = target === 'new' ? { text, newCourse: newName || jsonCourse } : { text, courseId: Number(target) };
      const r = await api<{ kind: string; courseId: number; added: number; cards?: number; existing?: number; skipped?: number; repaired?: number }>('/api/import/text', { body });
      await refresh();
      const parts = r.kind === 'json'
        ? [tn(r.added, 'Imported {n} note', 'Imported {n} notes') + ` (${tn(r.cards ?? 0, '{n} card', '{n} cards')}).`]
        : [tn(r.added, 'Added {n} word', 'Added {n} words') + '.'];
      if (r.existing) parts.push(tn(r.existing, '{n} was already there.', '{n} were already there.'));
      if (r.skipped) parts.push(tn(r.skipped, 'Skipped {n} line without a meaning.', 'Skipped {n} lines without a meaning.'));
      if (r.repaired) parts.push(tn(r.repaired, 'Fixed {n} LaTeX backslash.', 'Fixed {n} LaTeX backslashes.'));
      setTextMsg({ ok: true, text: parts.join(' '), courseId: r.courseId });
      setText('');
    } catch (err) {
      const e = err as ApiError;
      if (e.data?.problems) setProblems(e.data.problems);
      setTextMsg({ ok: false, text: e.data?.problems ? t('Nothing was imported. Fix these problems and try again:') : e.message });
    }
    setBusy('');
  };

  const loadFile = (f?: File) => {
    if (!f) return;
    if (f.name.toLowerCase().endsWith('.apkg') || f.name.toLowerCase().endsWith('.colpkg')) {
      setApkg(f);
      document.getElementById('anki')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    f.text().then((s) => { setText(s); setTextMsg(null); setProblems([]); });
  };

  const addDeck = async (d: DeckInfo) => {
    setBusy(`deck-${d.id}`); setDeckMsg(null);
    try {
      const sel = deckTarget[d.id] ?? '';
      const r = await api<{ courseId: number; added: number; existing: number }>(`/api/decks/${d.id}/import`, { body: { courseId: sel ? Number(sel) : null } });
      await refresh();
      setDeckMsg({
        ok: true, courseId: r.courseId,
        text: r.added
          ? `${t('Added {a} words ({b} cards).', { a: r.added, b: r.added * 2 })}${r.existing ? ' ' + tn(r.existing, '{n} was already there.', '{n} were already there.') : ''}`
          : t('All words are already in that course.'),
      });
    } catch (err) { setDeckMsg({ ok: false, text: (err as Error).message }); }
    setBusy('');
  };

  const importApkg = async () => {
    if (!apkg) return;
    setBusy('apkg'); setApkgMsg(null);
    try {
      const form = new FormData();
      form.append('file', apkg);
      const r = await api<{ notes: number; cards: number; media: number; skipped: number }>(`/api/import/apkg?course=${apkgCourse}`, { form });
      setApkgMsg({ ok: true, text: t('Imported {a} notes ({b} cards, {c} images).', { a: r.notes, b: r.cards, c: r.media }) + (r.skipped ? ' ' + t('Skipped {n} empty notes.', { n: r.skipped }) : '') });
      setApkg(null);
      await refresh();
    } catch (err) { setApkgMsg({ ok: false, text: (err as Error).message }); }
    setBusy('');
  };

  const CourseLink = ({ m }: { m: Msg }) => (m?.ok && m.courseId ? <> <Link to={`/course/${m.courseId}`}>{t('Open the course')}</Link></> : null);

  return (
    <div className="page narrow">
      <h1>{t('Import')}</h1>
      <p className="sub">{t('Paste cards written by an AI, load a word list, add a ready-made deck or bring your Anki decks.')}</p>

      <h2>{t('Paste text')}</h2>
      <div className="panel pad">
        {textMsg && <div className={textMsg.ok ? 'notice' : 'error'} role={textMsg.ok ? 'status' : 'alert'}>{textMsg.text}<CourseLink m={textMsg} /></div>}
        {problems.length > 0 && (
          <ul className="problems">{problems.map((p, i) => <li key={i}>{problemText(p)}</li>)}</ul>
        )}
        <p>{t('Paste the JSON an AI wrote for you, or a word list.')} <Link to="/wiki#ai">{t('How to let an AI write cards')}</Link></p>
        <textarea className="paste" rows={9} value={text} onChange={(e) => { setText(e.target.value); setProblems([]); }}
          placeholder={'{ "notes": [ { "type": "basic", "front": "…", "back": "…" } ] }\n\nen hund | der Hund | 🐕'} spellCheck={false}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); }} />
        <div className="paste-meta">
          {kind && <span className="badge">{kind === 'json' ? t('JSON cards') : t('Word list')}</span>}
          <button type="button" className="btn ghost small" onClick={() => fileRef.current?.click()}><FileUp size={15} /> {t('Load file')}</button>
          <input ref={fileRef} type="file" hidden accept=".json,.txt,.csv,.tsv,.md,.apkg,.colpkg,application/json,text/plain,text/csv" onChange={(e) => loadFile(e.target.files?.[0])} />
        </div>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <label className="field"><span>{t('Into course')}</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="new">{t('New course')}</option>
              {courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {target === 'new' && (
            <label className="field"><span>{t('Name of the new course')}</span>
              <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={jsonCourse || t('e.g. Fluids')} />
            </label>
          )}
        </div>
        <button className="btn primary" disabled={!text.trim() || busy === 'text' || (target === 'new' && !newName.trim() && !jsonCourse)} onClick={importText}>
          <ClipboardPaste size={16} /> {busy === 'text' ? t('Importing…') : t('Import')}
        </button>
      </div>

      <h2>{t('Ready-made decks')}</h2>
      <div className="panel pad">
        {deckMsg && <div className={deckMsg.ok ? 'notice' : 'error'}>{deckMsg.text}<CourseLink m={deckMsg} /></div>}
        {decks.length === 0 && <p className="muted">{t('No decks available.')}</p>}
        {decks.map((d) => (
          <div key={d.id} className="deck">
            <div className="deck-flag"><BookOpen size={30} /></div>
            <div className="grow">
              <h3>{(lang === 'de' && d.titleDe) || d.title}</h3>
              <p className="muted" style={{ marginBottom: 4 }}>{(lang === 'de' && d.descriptionDe) || d.description}</p>
              <p className="hint">{t('{a} words, both directions · {b} with a picture', { a: d.words, b: d.pictures })}</p>
              <div className="actions">
                <select value={deckTarget[d.id] ?? ''} onChange={(e) => setDeckTarget({ ...deckTarget, [d.id]: e.target.value })} aria-label={t('Course to add the deck to')}>
                  <option value="">{courses?.some((c) => c.name === d.course) ? t('Course “{x}”', { x: d.course }) : t('New course “{x}”', { x: d.course })}</option>
                  {courses?.filter((c) => c.name !== d.course).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button className="btn primary" disabled={busy === `deck-${d.id}`} onClick={() => addDeck(d)}>
                  {busy === `deck-${d.id}` ? t('Adding…') : t('Add deck')}
                </button>
              </div>
            </div>
          </div>
        ))}
        <p className="hint" style={{ marginTop: 14 }}>{t("Words are introduced in list order, most important first, at the course's new-cards-per-day rate. Adding a deck again only adds words that are missing.")}</p>
      </div>

      <h2 id="anki">{t('Import from Anki')}</h2>
      <div className="panel pad">
        <MsgBox m={apkgMsg} />
        <p>{t("Import an Anki deck package (.apkg). Notes come in as Basic or Cloze cards with their images and tags. They start as new cards; Anki's review history is not carried over.")}</p>
        {courses && courses.length === 0 ? <p className="muted">{t('Create a course first to import into.')}</p> : (
          <div className="row wrap">
            <label className="field"><span>{t('Into course')}</span>
              <select value={apkgCourse} onChange={(e) => setApkgCourse(e.target.value)}>
                {courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="btn fit" style={{ marginBottom: 14 }}>
              <Upload size={16} /> {apkg ? apkg.name : t('Choose .apkg file')}
              <input type="file" accept=".apkg,.colpkg" hidden onChange={(e) => setApkg(e.target.files?.[0] ?? null)} />
            </label>
            <button className="btn primary fit" style={{ marginBottom: 14 }} disabled={!apkg || busy === 'apkg'} onClick={importApkg}>{busy === 'apkg' ? t('Importing…') : t('Import')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
