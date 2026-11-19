import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Languages, Braces, Calculator, Dices, ImagePlus, Image as ImageIcon, ListOrdered, Plus, Sigma, SquareStack, TextCursorInput, Trash2,
} from 'lucide-react';
import { cardOrds, NOTE_TYPE_LABELS, type Note, type NoteType } from '../../../shared/types.ts';
import { fmtNum } from '../../../shared/units.ts';
import { api, uploadImage } from '../api.ts';
import { useApp } from '../App.tsx';
import { CardView, evalFormula, rollParams } from '../components/CardView.tsx';
import { OcclusionEditor } from '../components/OcclusionEditor.tsx';
import { LANGUAGES } from '../md.ts';

const ICONS: Record<NoteType, React.ReactNode> = {
  basic: <SquareStack size={20} />, cloze: <TextCursorInput size={20} />, numeric: <Calculator size={20} />,
  param: <Dices size={20} />, formula: <Sigma size={20} />, code: <Braces size={20} />,
  derivation: <ListOrdered size={20} />, occlusion: <ImageIcon size={20} />, vocab: <Languages size={20} />,
};

const newId = () => Math.random().toString(36).slice(2, 8);

const BLANK: Record<NoteType, () => any> = {
  basic: () => ({ front: '', back: '', reverse: false }),
  cloze: () => ({ text: '', extra: '' }),
  numeric: () => ({ question: '', value: '', unit: '', tolerance: 2, explanation: '' }),
  param: () => ({ question: '', vars: [{ name: 'a', min: 1, max: 10, step: 1 }], formula: '', unit: '', tolerance: 2, explanation: '' }),
  formula: () => ({ name: '', latex: '', symbols: [{ sym: '', meaning: '', unit: '' }], rearrangements: [], notes: '' }),
  code: () => ({ prompt: '', language: 'c', code: '', explanation: '' }),
  derivation: () => ({ title: '', steps: ['', ''] }),
  occlusion: () => ({ image: '', title: '', rects: [] }),
  vocab: () => ({ word: '', meaning: '', picture: '', note: '' }),
};

/** Drop rows the user left empty, so they do not turn into blank cards. */
function clean(type: NoteType, d: any): any {
  if (type === 'formula') {
    return {
      ...d,
      symbols: d.symbols.filter((s: any) => s.sym.trim()),
      rearrangements: d.rearrangements.filter((r: any) => r.latex.trim()),
    };
  }
  if (type === 'derivation') return { ...d, steps: d.steps.filter((s: string) => s.trim()) };
  if (type === 'param') return { ...d, vars: d.vars.filter((v: any) => v.name) };
  return d;
}

const ORD_LABEL = (ord: string, i: number) =>
  ord === 'w' ? 'Word → meaning' : ord === 'm' ? 'Meaning → word' : ord === 'f' ? 'Front → back' : ord === 'r' ? 'Back → front' : ord === 'recall' ? 'Recall formula'
    : ord === 'symbols' ? 'Symbols' : ord.startsWith('r:') ? `Rearrangement ${i}` : `Card ${i + 1}`;

/** Markdown textarea. Images can be pasted, dropped or picked; they upload and insert as ![](url). */
function MdField({ label, value, onChange, rows = 4, placeholder, hint }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; hint?: React.ReactNode;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const insert = async (file: File) => {
    setBusy(true);
    try {
      const url = await uploadImage(file);
      const el = ref.current!;
      const at = el.selectionStart ?? value.length;
      onChange(`${value.slice(0, at)}![](${url})${value.slice(el.selectionEnd ?? at)}`);
    } catch (err) { alert((err as Error).message); }
    setBusy(false);
  };
  return (
    <div className={`field md-field ${drag ? 'drag' : ''}`} style={{ marginBottom: 14 }}>
      <span className="field-label">{label}</span>
      <textarea ref={ref} rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); insert(f); } }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) insert(f); }} />
      <div className="md-tools">
        {hint && <span className="hint" style={{ marginRight: 'auto' }}>{hint}</span>}
        <label className="btn ghost small" title="Insert image (you can also paste or drop one)">
          <ImagePlus size={15} /> {busy ? 'Uploading…' : 'Image'}
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && insert(e.target.files[0])} />
        </label>
      </div>
    </div>
  );
}

const Text = ({ label, value, onChange, placeholder, type = 'text', mono }: {
  label: string; value: any; onChange: (v: string) => void; placeholder?: string; type?: string; mono?: boolean;
}) => (
  <label className="field"><span>{label}</span>
    <input type={type} value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      style={mono ? { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13.5 } : undefined} step="any" />
  </label>
);

function Fields({ type, d, set }: { type: NoteType; d: any; set: (patch: any) => void }) {
  const mathHint = <>Markdown, <code>$inline$</code> and <code>$$display$$</code> LaTeX</>;
  switch (type) {
    case 'basic':
      return (
        <>
          <MdField label="Front" value={d.front} onChange={(front) => set({ front })} hint={mathHint} />
          <MdField label="Back" value={d.back} onChange={(back) => set({ back })} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <input type="checkbox" checked={!!d.reverse} onChange={(e) => set({ reverse: e.target.checked })} /> Also create the reverse card
          </label>
        </>
      );
    case 'cloze':
      return (
        <>
          <MdField label="Text" value={d.text} rows={6} onChange={(text) => set({ text })}
            placeholder={'The time constant of an RC circuit is {{c1::$\\tau = RC$}}.'}
            hint={<>Hide parts with <code>{'{{c1::answer}}'}</code>, <code>{'{{c2::answer::hint}}'}</code>. Works inside LaTeX too.</>} />
          <MdField label="Extra (shown with the answer)" value={d.extra} rows={2} onChange={(extra) => set({ extra })} />
        </>
      );
    case 'numeric':
      return (
        <>
          <MdField label="Question" value={d.question} onChange={(question) => set({ question })} hint={mathHint}
            placeholder="A 12 V source drives a 4.7 kΩ resistor. What is the current?" />
          <div className="row">
            <Text label="Answer" type="number" value={d.value} onChange={(v) => set({ value: v === '' ? '' : Number(v) })} placeholder="2.553" />
            <Text label="Unit" value={d.unit} onChange={(unit) => set({ unit })} placeholder="mA" />
            <Text label="Tolerance ± %" type="number" value={d.tolerance} onChange={(v) => set({ tolerance: Number(v) })} />
          </div>
          <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>Answers with another SI prefix count: 2.553 mA, 0.002553 A and 2553 µA all match. A decimal comma works too.</p>
          <MdField label="Worked solution (optional)" value={d.explanation} rows={3} onChange={(explanation) => set({ explanation })} />
        </>
      );
    case 'param': {
      const setVar = (i: number, patch: any) => set({ vars: d.vars.map((v: any, j: number) => (j === i ? { ...v, ...patch } : v)) });
      return (
        <>
          <MdField label="Question" value={d.question} onChange={(question) => set({ question })}
            placeholder="A beam of length {{L}} m carries a point load of {{F}} kN at midspan. What is the maximum bending moment?"
            hint={<>Insert a variable with <code>{'{{name}}'}</code>. Its value changes on every review.</>} />
          <span className="field-label">Variables</span>
          <div className="sub-row muted" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 36px', fontSize: 12.5, marginBottom: 2 }}>
            <span>Name</span><span>Min</span><span>Max</span><span>Step</span><span />
          </div>
          {d.vars.map((v: any, i: number) => (
            <div key={i} className="sub-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 36px' }}>
              <input type="text" value={v.name} aria-label="Name" onChange={(e) => setVar(i, { name: e.target.value.replace(/\W/g, '') })} />
              <input type="number" step="any" value={v.min} aria-label="Min" onChange={(e) => setVar(i, { min: Number(e.target.value) })} />
              <input type="number" step="any" value={v.max} aria-label="Max" onChange={(e) => setVar(i, { max: Number(e.target.value) })} />
              <input type="number" step="any" value={v.step} aria-label="Step" onChange={(e) => setVar(i, { step: Number(e.target.value) })} />
              <button type="button" className="btn ghost small" aria-label="Remove variable" onClick={() => set({ vars: d.vars.filter((_: any, j: number) => j !== i) })}><Trash2 size={15} /></button>
            </div>
          ))}
          <button type="button" className="btn small" style={{ marginBottom: 14 }}
            onClick={() => set({ vars: [...d.vars, { name: '', min: 1, max: 10, step: 1 }] })}><Plus size={15} /> Variable</button>
          <Text label="Answer formula" mono value={d.formula} onChange={(formula) => set({ formula })} placeholder="F * L / 4" />
          <ParamCheck d={d} />
          <div className="row">
            <Text label="Unit" value={d.unit} onChange={(unit) => set({ unit })} placeholder="kNm" />
            <Text label="Tolerance ± %" type="number" value={d.tolerance} onChange={(v) => set({ tolerance: Number(v) })} />
          </div>
          <MdField label="Method / worked solution (optional)" value={d.explanation} rows={3} onChange={(explanation) => set({ explanation })} />
        </>
      );
    }
    case 'formula': {
      const setSym = (i: number, patch: any) => set({ symbols: d.symbols.map((s: any, j: number) => (j === i ? { ...s, ...patch } : s)) });
      const setRe = (i: number, patch: any) => set({ rearrangements: d.rearrangements.map((s: any, j: number) => (j === i ? { ...s, ...patch } : s)) });
      return (
        <>
          <Text label="Name" value={d.name} onChange={(name) => set({ name })} placeholder="Bernoulli's equation" />
          <Text label="Formula (LaTeX)" mono value={d.latex} onChange={(latex) => set({ latex })} placeholder="p + \tfrac{1}{2}\rho v^2 + \rho g h = \text{const}" />
          <span className="field-label">Symbols</span>
          {d.symbols.map((s: any, i: number) => (
            <div key={i} className="sub-row" style={{ gridTemplateColumns: '90px 1fr 90px 36px' }}>
              <input type="text" value={s.sym} placeholder="\rho" aria-label="Symbol (LaTeX)" onChange={(e) => setSym(i, { sym: e.target.value })} />
              <input type="text" value={s.meaning} placeholder="fluid density" aria-label="Meaning" onChange={(e) => setSym(i, { meaning: e.target.value })} />
              <input type="text" value={s.unit} placeholder="kg/m³" aria-label="Unit" onChange={(e) => setSym(i, { unit: e.target.value })} />
              <button type="button" className="btn ghost small" aria-label="Remove symbol" onClick={() => set({ symbols: d.symbols.filter((_: any, j: number) => j !== i) })}><Trash2 size={15} /></button>
            </div>
          ))}
          <button type="button" className="btn small" style={{ marginBottom: 14 }}
            onClick={() => set({ symbols: [...d.symbols, { sym: '', meaning: '', unit: '' }] })}><Plus size={15} /> Symbol</button>
          <span className="field-label">Rearrangements (one card each)</span>
          {d.rearrangements.map((r: any, i: number) => (
            <div key={r.id} className="sub-row" style={{ gridTemplateColumns: '90px 1fr 36px' }}>
              <input type="text" value={r.solveFor} placeholder="v" aria-label="Solve for" onChange={(e) => setRe(i, { solveFor: e.target.value })} />
              <input type="text" value={r.latex} placeholder="v = \sqrt{\dots}" aria-label="Rearranged formula (LaTeX)" onChange={(e) => setRe(i, { latex: e.target.value })} />
              <button type="button" className="btn ghost small" aria-label="Remove rearrangement" onClick={() => set({ rearrangements: d.rearrangements.filter((_: any, j: number) => j !== i) })}><Trash2 size={15} /></button>
            </div>
          ))}
          <button type="button" className="btn small" style={{ marginBottom: 14 }}
            onClick={() => set({ rearrangements: [...d.rearrangements, { id: newId(), solveFor: '', latex: '' }] })}><Plus size={15} /> Rearrangement</button>
          <MdField label="Notes: assumptions, when it applies (optional)" value={d.notes} rows={2} onChange={(notes) => set({ notes })} />
        </>
      );
    }
    case 'code':
      return (
        <>
          <MdField label="Prompt" value={d.prompt} rows={3} onChange={(prompt) => set({ prompt })} placeholder="Write a debounce routine for a push button read every 1 ms." />
          <label className="field"><span>Language</span>
            <select value={d.language} onChange={(e) => set({ language: e.target.value })}>
              {LANGUAGES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="field"><span>Code</span>
            <textarea rows={10} value={d.code} spellCheck={false} onChange={(e) => set({ code: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== 'Tab') return;
                e.preventDefault();
                const el = e.currentTarget; const s = el.selectionStart;
                set({ code: `${d.code.slice(0, s)}    ${d.code.slice(el.selectionEnd)}` });
                requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
              }} />
          </label>
          <MdField label="Explanation (optional)" value={d.explanation} rows={2} onChange={(explanation) => set({ explanation })} />
        </>
      );
    case 'derivation':
      return (
        <>
          <MdField label="What is derived" value={d.title} rows={2} onChange={(title) => set({ title })} placeholder="Derive the transfer function of a mass–spring–damper system." />
          <span className="field-label">Steps (the first is shown as the starting point)</span>
          {d.steps.map((s: string, i: number) => (
            <div key={i} className="sub-row" style={{ gridTemplateColumns: '24px 1fr 36px', alignItems: 'start' }}>
              <span className="muted num" style={{ paddingTop: 9 }}>{i + 1}</span>
              <textarea rows={2} value={s} style={{ minHeight: 0 }} aria-label={`Step ${i + 1}`}
                onChange={(e) => set({ steps: d.steps.map((x: string, j: number) => (j === i ? e.target.value : x)) })} />
              <button type="button" className="btn ghost small" aria-label="Remove step" onClick={() => set({ steps: d.steps.filter((_: string, j: number) => j !== i) })}><Trash2 size={15} /></button>
            </div>
          ))}
          <button type="button" className="btn small" style={{ marginBottom: 14 }} onClick={() => set({ steps: [...d.steps, ''] })}><Plus size={15} /> Step</button>
        </>
      );
    case 'vocab':
      return (
        <>
          <div className="row">
            <Text label="Word (language you are learning)" value={d.word} onChange={(word) => set({ word })} placeholder="en hund" />
            <Text label="Meaning (your language)" value={d.meaning} onChange={(meaning) => set({ meaning })} placeholder="der Hund" />
          </div>
          <div className="row">
            <Text label="Picture: an emoji or image link (optional)" value={d.picture} onChange={(picture) => set({ picture })} placeholder="🐕" />
            <label className="btn fit" style={{ marginBottom: 14 }} title="Upload an image as the picture">
              <ImagePlus size={16} /> Upload
              <input type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) { try { set({ picture: await uploadImage(f) }); } catch (err) { alert((err as Error).message); } }
              }} />
            </label>
          </div>
          <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>With a picture, the reverse card shows the picture and a hint button instead of the meaning. Best for things you can draw: nouns, colours, actions.</p>
          <MdField label="Note: plural, forms, usage (optional)" value={d.note} rows={2} onChange={(note) => set({ note })} />
        </>
      );
    case 'occlusion':
      return <OcclusionEditor data={d} onChange={(next) => set(next)} />;
  }
}

function ParamCheck({ d }: { d: any }) {
  const sample = useMemo(() => {
    if (!d.formula?.trim()) return null;
    const scope = rollParams(d);
    return { scope, value: evalFormula(d.formula, scope) };
  }, [d]);
  if (!sample) return null;
  const vars = Object.entries(sample.scope).map(([k, v]) => `${k} = ${fmtNum(v, 6)}`).join(', ');
  return (
    <p className="hint" style={{ marginTop: -8, marginBottom: 14, color: sample.value === null ? 'var(--bad)' : undefined }}>
      {sample.value === null ? 'This formula cannot be evaluated. Check the variable names.' : `Example: ${vars} → ${fmtNum(sample.value)} ${d.unit ?? ''}`}
    </p>
  );
}

export function NoteEditor() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { courses } = useApp();
  const nav = useNavigate();
  const editing = !!id;

  const [courseId, setCourseId] = useState<number | ''>(Number(search.get('course')) || '');
  const [type, setType] = useState<NoteType>('basic');
  const [drafts, setDrafts] = useState<Partial<Record<NoteType, any>>>({ basic: BLANK.basic() });
  const [tags, setTags] = useState('');
  const [sourceText, setSourceText] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [suspended, setSuspended] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [previewOrd, setPreviewOrd] = useState(0);
  const [showBack, setShowBack] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loaded, setLoaded] = useState(!editing);

  useEffect(() => {
    if (!id) return;
    api<Note>(`/api/notes/${id}`).then((n) => {
      setCourseId(n.courseId); setType(n.type); setDrafts({ [n.type]: n.data }); setTags(n.tags);
      setSourceText(n.sourceText); setSourceUrl(n.sourceUrl); setSuspended(!!n.suspended); setLoaded(true);
    }).catch((e) => setError(e.message));
  }, [id]);
  useEffect(() => { if (courseId === '' && courses?.length) setCourseId(courses[0].id); }, [courses, courseId]);

  const raw = drafts[type] ?? BLANK[type]();
  const d = clean(type, raw);
  const set = (patch: any) => { setSaved(''); setDrafts((all) => ({ ...all, [type]: { ...(all[type] ?? BLANK[type]()), ...patch } })); };
  const ords = cardOrds(type, d);
  const ord = ords[Math.min(previewOrd, ords.length - 1)];

  const save = async () => {
    setError(''); setSaved('');
    const body = { courseId, type, data: d, tags, sourceText, sourceUrl };
    try {
      if (editing) {
        await api(`/api/notes/${id}`, { method: 'PUT', body });
        nav(-1);
      } else {
        await api('/api/notes', { body });
        setDrafts((all) => ({ ...all, [type]: BLANK[type]() }));
        setSaved(`Added ${ords.length} card${ords.length === 1 ? '' : 's'}. Ready for the next one.`);
        window.scrollTo?.(0, 0);
      }
    } catch (err) { setError((err as Error).message); }
  };

  if (courses && courses.length === 0) {
    return <div className="page narrow"><h1>Add card</h1><div className="empty" style={{ marginTop: 20 }}>Create a course first, using “New course” in the sidebar.</div></div>;
  }
  if (!loaded) return <div className="page">{error && <div className="error">{error}</div>}</div>;

  return (
    <div className="page" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save(); }}>
      <div className="page-head">
        <div>
          <h1>{editing ? 'Edit card' : 'Add card'}</h1>
          <p className="sub">{editing ? 'Cards keep their schedule when you edit them.' : 'Pick a card type, fill it in, and check the preview.'}</p>
        </div>
      </div>
      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
      {saved && <div className="notice" style={{ marginTop: 14 }}>{saved}</div>}

      <div className="editor" style={{ marginTop: 20 }}>
        <div>
          {!editing && (
            <div className="type-grid">
              {(Object.keys(NOTE_TYPE_LABELS) as NoteType[]).map((t) => (
                <button key={t} type="button" className={`type-btn ${t === type ? 'on' : ''}`} onClick={() => { setType(t); setPreviewOrd(0); }}>
                  {ICONS[t]}{NOTE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          )}
          <div className="panel pad">
            <label className="field"><span>Course</span>
              <select value={courseId} onChange={(e) => setCourseId(Number(e.target.value))}>
                {courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <Fields type={type} d={raw} set={set} />
            <Text label="Tags" value={tags} onChange={setTags} placeholder="control-theory exam-2026" />
            <div className="row">
              <Text label="Source (optional)" value={sourceText} onChange={setSourceText} placeholder="Lab 1 report, p. 4" />
              <Text label="Source link" type="url" value={sourceUrl} onChange={setSourceUrl} placeholder="https://…" />
            </div>
          </div>
          <div className="sticky-actions">
            <button className="btn primary" onClick={save}>{editing ? 'Save' : 'Add card'} <kbd>Ctrl ↵</kbd></button>
            {editing ? <button className="btn ghost" onClick={() => nav(-1)}>Cancel</button> : <Link className="btn ghost" to={courseId ? `/course/${courseId}` : '/'}>Done</Link>}
            {editing && (
              <>
                <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={async () => {
                  await api(`/api/notes/${id}/suspend`, { body: { suspended: !suspended } });
                  setSuspended(!suspended);
                }}>{suspended ? 'Unsuspend' : 'Suspend'}</button>
                <button className="btn ghost danger" onClick={async () => {
                  if (!confirmDelete) return setConfirmDelete(true);
                  await api(`/api/notes/${id}`, { method: 'DELETE' });
                  nav(-1);
                }}>{confirmDelete ? 'Really delete?' : 'Delete'}</button>
              </>
            )}
          </div>
        </div>

        <div className="preview">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="field-label" style={{ margin: 0 }}>Preview</span>
            {ords.length > 1 && (
              <select value={Math.min(previewOrd, ords.length - 1)} onChange={(e) => setPreviewOrd(Number(e.target.value))} style={{ width: 'auto', padding: '4px 8px' }} aria-label="Card to preview">
                {ords.map((o, i) => <option key={o} value={i}>{ORD_LABEL(o, i)}</option>)}
              </select>
            )}
            <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => setShowBack((b) => !b)}>{showBack ? 'Showing answer' : 'Showing question'}</button>
          </div>
          <div className="panel pad" style={{ minHeight: 160 }}>
            {ord
              ? <CardView key={`${type}-${ord}-${showBack}`} note={{ type, data: d, sourceText, sourceUrl }} ord={ord} revealed={showBack} />
              : <span className="muted">{type === 'cloze' ? 'Add a cloze deletion like {{c1::answer}} to create a card.' : type === 'occlusion' ? 'Upload an image and draw a box to create a card.' : 'Nothing to preview yet.'}</span>}
          </div>
          <p className="hint">{ords.length} card{ords.length === 1 ? '' : 's'} from this note.</p>
        </div>
      </div>
    </div>
  );
}
