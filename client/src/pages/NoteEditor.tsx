import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Bold, Italic, List, Languages, Braces, Calculator, Dices, ImagePlus, Image as ImageIcon, ListOrdered, Plus, Sigma, SquareStack, TextCursorInput, Trash2,
} from 'lucide-react';
import { ADVANCED_TYPES, cardOrds, NOTE_TYPE_HELP, NOTE_TYPE_LABELS, SIMPLE_TYPES, type Note, type NoteType } from '../../../shared/types.ts';
import { fmtNum } from '../../../shared/units.ts';
import { api, uploadImage } from '../api.ts';
import { useApp } from '../App.tsx';
import { CardView, evalFormula, rollParams } from '../components/CardView.tsx';
import { OcclusionEditor } from '../components/OcclusionEditor.tsx';
import { FormulaDialog, MathInput } from '../components/MathInput.tsx';
import { LANGUAGES } from '../md.ts';
import { t, tn, t as tr } from '../i18n.ts';

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

function TypeButton({ k, on, pick }: { k: NoteType; on: boolean; pick: (k: NoteType) => void }) {
  return (
    <button type="button" className={`type-btn ${on ? 'on' : ''}`} onClick={() => pick(k)} aria-pressed={on}>
      <span className="type-icon">{ICONS[k]}</span>
      <span className="type-text">
        <b>{t(NOTE_TYPE_LABELS[k])}</b>
        <small>{t(NOTE_TYPE_HELP[k])}</small>
      </span>
    </button>
  );
}

const ORD_LABEL = (ord: string, i: number) =>
  ord === 'w' ? t('Word → meaning') : ord === 'm' ? t('Meaning → word') : ord === 'f' ? t('Front → back') : ord === 'r' ? t('Back → front') : ord === 'recall' ? t('Recall formula')
    : ord === 'symbols' ? t('Symbols') : ord.startsWith('r:') ? t('Rearrangement {n}', { n: i }) : t('Card {n}', { n: i + 1 });

/**
 * Text field with a toolbar, so nothing has to be typed as code: bold, italic, list, formula
 * (visual editor), picture (also paste or drop) and, for gap texts, "Make gap".
 * The text is stored as Markdown with LaTeX; the preview shows the result.
 */
function MdField({ label, value, onChange, rows = 4, placeholder, hint, gap, chips }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; hint?: React.ReactNode;
  /** Show a "Make gap" button that turns the selected text into a gap. */
  gap?: boolean;
  /** Extra buttons that insert a snippet at the cursor, e.g. variables of a calculation. */
  chips?: { label: string; insert: string }[];
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gapTip, setGapTip] = useState(false);
  const [formula, setFormula] = useState<{ a: number; b: number; latex: string; block: boolean } | null>(null);
  const val = value ?? '';

  const sel = () => { const el = ref.current!; return [el.selectionStart ?? val.length, el.selectionEnd ?? val.length] as const; };
  const put = (next: string, cursor: number) => {
    onChange(next);
    requestAnimationFrame(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(cursor, cursor); } });
  };
  const replace = (a: number, b: number, text: string) => put(val.slice(0, a) + text + val.slice(b), a + text.length);
  const wrap = (mark: string) => {
    const [a, b] = sel();
    const inner = val.slice(a, b) || t('text');
    put(val.slice(0, a) + mark + inner + mark + val.slice(b), a + mark.length + inner.length + mark.length);
  };
  const list = () => {
    const [a, b] = sel();
    const start = val.lastIndexOf('\n', a - 1) + 1;
    const lines = val.slice(start, b).split('\n').map((l) => (l.startsWith('- ') ? l : `- ${l}`)).join('\n');
    replace(start, b, lines);
  };
  const insertImage = async (file: File) => {
    setBusy(true);
    try {
      const url = await uploadImage(file);
      const [a, b] = sel();
      replace(a, b, `![](${url})`);
    } catch (err) { alert((err as Error).message); }
    setBusy(false);
  };
  const openFormula = () => {
    const [a, b] = sel();
    const m = val.slice(a, b).trim().match(/^(\$\$?)([\s\S]+?)\1$/);
    setFormula({ a, b, latex: m ? m[2].trim() : '', block: m?.[1] === '$$' });
  };
  const makeGap = () => {
    const [a, b] = sel();
    const text = val.slice(a, b);
    if (!text.trim()) { setGapTip(true); ref.current?.focus(); return; }
    const n = Math.max(0, ...[...val.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]))) + 1;
    const lead = text.match(/^\s*/)![0], trail = text.match(/\s*$/)![0];
    setGapTip(false);
    replace(a, b, `${lead}{{c${n}::${text.trim()}}}${trail}`);
  };
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep the text selection when a button is pressed

  return (
    <div className={`field md-field ${drag ? 'drag' : ''}`} style={{ marginBottom: 14 }}>
      <span className="field-label">{t(label)}</span>
      <div className="md-toolbar" role="toolbar" aria-label={t('Formatting')}>
        <button type="button" onMouseDown={keep} onClick={() => wrap('**')} title={t('Bold')} aria-label={t('Bold')}><Bold size={16} /></button>
        <button type="button" onMouseDown={keep} onClick={() => wrap('*')} title={t('Italic')} aria-label={t('Italic')}><Italic size={16} /></button>
        <button type="button" onMouseDown={keep} onClick={list} title={t('List')} aria-label={t('List')}><List size={16} /></button>
        <button type="button" onMouseDown={keep} onClick={openFormula} title={t('Formula')}><Sigma size={16} /> <span>{t('Formula')}</span></button>
        <label className="tb-btn" title={t('Insert image (you can also paste or drop one)')}>
          <ImagePlus size={16} /> <span>{busy ? t('Uploading…') : t('Picture')}</span>
          <input type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.[0]) insertImage(e.target.files[0]); e.target.value = ''; }} />
        </label>
        {gap && (
          <button type="button" className="tb-gap" onMouseDown={keep} onClick={makeGap}><TextCursorInput size={16} /> <span>{t('Make gap')}</span></button>
        )}
        {chips?.map((c) => (
          <button key={c.label} type="button" className="tb-chip" onMouseDown={keep} onClick={() => { const [a, b] = sel(); replace(a, b, c.insert); }}>
            <Plus size={14} /> {c.label}
          </button>
        ))}
      </div>
      <textarea ref={ref} rows={rows} value={val} placeholder={placeholder && t(placeholder)} onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => { const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); insertImage(f); } }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) insertImage(f); }} />
      {(hint || gapTip) && (
        <p className="hint" style={{ margin: '4px 0 0' }}>{gapTip ? <b>{t('First select a word in the text, then tap “Make gap”.')}</b> : hint}</p>
      )}
      {formula && (
        <FormulaDialog initial={formula.latex} initialBlock={formula.block} onClose={() => setFormula(null)}
          onInsert={(latex, block) => { replace(formula.a, formula.b, block ? `\n$$${latex}$$\n` : `$${latex}$`); setFormula(null); }} />
      )}
    </div>
  );
}

/** Answer formula of a calculation, built from buttons (variables, operators) or typed. */
function FormulaBuilder({ value, onChange, vars }: { value: string; onChange: (v: string) => void; vars: string[] }) {
  const ref = useRef<HTMLInputElement>(null);
  const insert = (s: string) => {
    const el = ref.current!;
    const a = el.selectionStart ?? value.length, b = el.selectionEnd ?? value.length;
    const pad = /[+\-*/^]/.test(s) && s.length === 1 ? ` ${s} ` : s;
    onChange(value.slice(0, a) + pad + value.slice(b));
    requestAnimationFrame(() => { el.focus(); const c = a + pad.length; el.setSelectionRange(c, c); });
  };
  const ops: [string, string][] = [['+', '+'], ['−', '-'], ['×', '*'], ['÷', '/'], ['xʸ', '^'], ['(', '('], [')', ')'], ['√', 'sqrt('], ['π', 'pi'], ['sin', 'sin('], ['cos', 'cos('], ['ln', 'log(']];
  return (
    <div className="field">
      <span className="field-label">{t('Answer formula')}</span>
      <div className="calc-keys">
        {vars.filter(Boolean).map((v) => <button key={`v-${v}`} type="button" className="calc-var" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(v)}>{v}</button>)}
        {ops.map(([label, s]) => <button key={label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(s)}>{label}</button>)}
      </div>
      <input ref={ref} type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder="F * L / 4"
        style={{ fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 14 }} aria-label={t('Answer formula')} />
    </div>
  );
}

const Text = ({ label, value, onChange, placeholder, type = 'text', mono }: {
  label: string; value: any; onChange: (v: string) => void; placeholder?: string; type?: string; mono?: boolean;
}) => (
  <label className="field"><span>{t(label)}</span>
    <input type={type} value={value ?? ''} placeholder={placeholder && t(placeholder)} onChange={(e) => onChange(e.target.value)}
      style={mono ? { fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 13.5 } : undefined} step="any" />
  </label>
);

function Fields({ type, d, set }: { type: NoteType; d: any; set: (patch: any) => void }) {
  switch (type) {
    case 'basic':
      return (
        <>
          <MdField label="Front" value={d.front} onChange={(front) => set({ front })} placeholder="What is the capital of Denmark?"
            hint={t('Tip: you can paste or drop pictures.')} />
          <MdField label="Back side" value={d.back} onChange={(back) => set({ back })} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
            <input type="checkbox" checked={!!d.reverse} onChange={(e) => set({ reverse: e.target.checked })} /> {t('Also ask the other way round (back → front)')}
          </label>
        </>
      );
    case 'cloze':
      return (
        <>
          <MdField label="Text" value={d.text} rows={6} onChange={(text) => set({ text })} gap
            placeholder="The capital of Denmark is Copenhagen."
            hint={t('Select words and tap “Make gap”. Each gap becomes its own card.')} />
          <MdField label="Extra (shown with the answer)" value={d.extra} rows={2} onChange={(extra) => set({ extra })} />
        </>
      );
    case 'numeric':
      return (
        <>
          <MdField label="Question" value={d.question} onChange={(question) => set({ question })}
            placeholder="A 12 V source drives a 4.7 kΩ resistor. What is the current?" />
          <div className="row">
            <Text label="Answer" type="number" value={d.value} onChange={(v) => set({ value: v === '' ? '' : Number(v) })} placeholder="2.553" />
            <Text label="Unit" value={d.unit} onChange={(unit) => set({ unit })} placeholder="mA" />
            <Text label="Tolerance ± %" type="number" value={d.tolerance} onChange={(v) => set({ tolerance: Number(v) })} />
          </div>
          <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>{t('Answers with another SI prefix count: 2.553 mA, 0.002553 A and 2553 µA all match. A decimal comma works too.')}</p>
          <MdField label="Worked solution (optional)" value={d.explanation} rows={3} onChange={(explanation) => set({ explanation })} />
        </>
      );
    case 'param': {
      const setVar = (i: number, patch: any) => set({ vars: d.vars.map((v: any, j: number) => (j === i ? { ...v, ...patch } : v)) });
      const names: string[] = d.vars.map((v: any) => v.name).filter(Boolean);
      return (
        <>
          <span className="field-label">{t('Variables')}</span>
          <p className="hint" style={{ margin: '0 0 8px' }}>{t('Each variable gets a new random value between min and max on every review.')}</p>
          <div className="sub-row muted" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 36px', fontSize: 12.5, marginBottom: 2 }}>
            <span>{t('Name')}</span><span>{t('Min')}</span><span>{t('Max')}</span><span>{t('Step')}</span><span />
          </div>
          {d.vars.map((v: any, i: number) => (
            <div key={i} className="sub-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr 36px' }}>
              <input type="text" value={v.name} aria-label={t('Name')} onChange={(e) => setVar(i, { name: e.target.value.replace(/\W/g, '') })} />
              <input type="number" step="any" value={v.min} aria-label="Min" onChange={(e) => setVar(i, { min: Number(e.target.value) })} />
              <input type="number" step="any" value={v.max} aria-label="Max" onChange={(e) => setVar(i, { max: Number(e.target.value) })} />
              <input type="number" step="any" value={v.step} aria-label={t('Step')} onChange={(e) => setVar(i, { step: Number(e.target.value) })} />
              <button type="button" className="btn ghost small" aria-label={t('Remove variable')} onClick={() => set({ vars: d.vars.filter((_: any, j: number) => j !== i) })}><Trash2 size={15} /></button>
            </div>
          ))}
          <button type="button" className="btn small" style={{ marginBottom: 14 }}
            onClick={() => set({ vars: [...d.vars, { name: '', min: 1, max: 10, step: 1 }] })}><Plus size={15} /> {t('Variable')}</button>
          <MdField label="Question" value={d.question} onChange={(question) => set({ question })}
            placeholder="A beam of length {{L}} m carries a point load of {{F}} kN at midspan. What is the maximum bending moment?"
            chips={names.map((n) => ({ label: n, insert: `{{${n}}}` }))}
            hint={t('Tap a variable button to put it into the question.')} />
          <FormulaBuilder value={d.formula} onChange={(formula) => set({ formula })} vars={names} />
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
          <div className="field">
            <span className="field-label">{t('Formula')}</span>
            <MathInput value={d.latex} onChange={(latex) => set({ latex })} ariaLabel={t('Formula')} />
          </div>
          <span className="field-label">{t('Symbols')}</span>
          {d.symbols.map((s: any, i: number) => (
            <div key={i} className="sub-row sym-row">
              <MathInput small value={s.sym} onChange={(sym) => setSym(i, { sym })} ariaLabel={t('Symbol')} />
              <input type="text" value={s.meaning} placeholder={t('fluid density')} aria-label={t('Meaning')} onChange={(e) => setSym(i, { meaning: e.target.value })} />
              <input type="text" value={s.unit} placeholder="kg/m³" aria-label={t('Unit')} onChange={(e) => setSym(i, { unit: e.target.value })} />
              <button type="button" className="btn ghost small" aria-label={t('Remove symbol')} onClick={() => set({ symbols: d.symbols.filter((_: any, j: number) => j !== i) })}><Trash2 size={15} /></button>
            </div>
          ))}
          <button type="button" className="btn small" style={{ marginBottom: 14 }}
            onClick={() => set({ symbols: [...d.symbols, { sym: '', meaning: '', unit: '' }] })}><Plus size={15} /> {t('Symbol')}</button>
          <span className="field-label">{t('Rearrangements (one card each)')}</span>
          {d.rearrangements.map((r: any, i: number) => (
            <div key={r.id} className="sub-row re-row">
              <MathInput small value={r.solveFor} onChange={(solveFor) => setRe(i, { solveFor })} ariaLabel={t('Solve for')} />
              <MathInput small value={r.latex} onChange={(latex) => setRe(i, { latex })} ariaLabel={t('Rearranged formula')} />
              <button type="button" className="btn ghost small" aria-label={t('Remove rearrangement')} onClick={() => set({ rearrangements: d.rearrangements.filter((_: any, j: number) => j !== i) })}><Trash2 size={15} /></button>
            </div>
          ))}
          {d.rearrangements.length > 0 && <p className="hint" style={{ margin: '-4px 0 8px' }}>{t('Left: the symbol to solve for. Right: the rearranged formula.')}</p>}
          <button type="button" className="btn small" style={{ marginBottom: 14 }}
            onClick={() => set({ rearrangements: [...d.rearrangements, { id: newId(), solveFor: '', latex: '' }] })}><Plus size={15} /> {t('Rearrangement')}</button>
          <MdField label="Notes: assumptions, when it applies (optional)" value={d.notes} rows={2} onChange={(notes) => set({ notes })} />
        </>
      );
    }
    case 'code':
      return (
        <>
          <MdField label="Prompt" value={d.prompt} rows={3} onChange={(prompt) => set({ prompt })} placeholder="Write a debounce routine for a push button read every 1 ms." />
          <label className="field"><span>{t('Language')}</span>
            <select value={d.language} onChange={(e) => set({ language: e.target.value })}>
              {LANGUAGES.map(([id, name]) => <option key={id} value={id}>{t(name)}</option>)}
            </select>
          </label>
          <label className="field"><span>{t('Code')}</span>
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
          <span className="field-label">{t('Steps (the first is shown as the starting point)')}</span>
          {d.steps.map((s: string, i: number) => (
            <div key={i} className="step-row">
              <MdField label={t('Step {n}', { n: i + 1 })} value={s} rows={2}
                onChange={(v) => set({ steps: d.steps.map((x: string, j: number) => (j === i ? v : x)) })} />
              <button type="button" className="btn ghost small" aria-label={t('Remove step')} onClick={() => set({ steps: d.steps.filter((_: string, j: number) => j !== i) })}><Trash2 size={15} /></button>
            </div>
          ))}
          <button type="button" className="btn small" style={{ marginBottom: 14 }} onClick={() => set({ steps: [...d.steps, ''] })}><Plus size={15} /> {t('Step')}</button>
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
            <label className="btn fit" style={{ marginBottom: 14 }} title={t('Upload an image as the picture')}>
              <ImagePlus size={16} /> {t('Upload')}
              <input type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) { try { set({ picture: await uploadImage(f) }); } catch (err) { alert((err as Error).message); } }
              }} />
            </label>
          </div>
          <p className="hint" style={{ marginTop: -6, marginBottom: 14 }}>{t('With a picture, the reverse card shows the picture and a hint button instead of the meaning. Best for things you can draw: nouns, colours, actions.')}</p>
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
      {sample.value === null ? t('This formula cannot be evaluated. Check the variable names.') : `${t('Example:')} ${vars} → ${fmtNum(sample.value)} ${d.unit ?? ''}`}
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
  const [advanced, setAdvancedState] = useState(() => { try { return localStorage.getItem('advancedTypes') === '1'; } catch { return false; } });
  const setAdvanced = (v: boolean) => { setAdvancedState(v); try { localStorage.setItem('advancedTypes', v ? '1' : '0'); } catch { /* private mode */ } };
  const showAdvanced = advanced || ADVANCED_TYPES.includes(type);
  const pickType = (k: NoteType) => { setType(k); setPreviewOrd(0); };
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

  const saving = useRef(false);
  // Leave the editor: go back if there is a page to go back to (not when the editor was opened directly by link).
  const back = () => ((window.history.state?.idx ?? 0) > 0 ? nav(-1) : nav(courseId ? `/course/${courseId}` : '/'));
  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setError(''); setSaved('');
    const body = { courseId, type, data: d, tags, sourceText, sourceUrl };
    try {
      if (editing) {
        await api(`/api/notes/${id}`, { method: 'PUT', body });
        back();
      } else {
        await api('/api/notes', { body });
        setDrafts((all) => ({ ...all, [type]: BLANK[type]() }));
        setSaved(tn(ords.length, 'Added {n} card. Ready for the next one.', 'Added {n} cards. Ready for the next one.'));
        window.scrollTo?.(0, 0);
      }
    } catch (err) { setError((err as Error).message); }
    saving.current = false;
  };

  if (courses && courses.length === 0) {
    return <div className="page narrow"><h1>{t('Add card')}</h1><div className="empty" style={{ marginTop: 20 }}>{t('Create a course first, using “New course” in the sidebar.')}</div></div>;
  }
  if (!loaded) return <div className="page">{error && <div className="error">{error}</div>}</div>;

  return (
    <div className="page" onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save(); }}>
      <div className="page-head">
        <div>
          <h1>{editing ? t('Edit card') : t('Add card')}</h1>
          <p className="sub">{editing ? t('Cards keep their schedule when you edit them.') : t('Pick a card type, fill it in, and check the preview.')}</p>
        </div>
      </div>
      {error && <div className="error" style={{ marginTop: 14 }}>{error}</div>}
      {saved && <div className="notice" style={{ marginTop: 14 }}>{saved}</div>}

      <div className="editor" style={{ marginTop: 20 }}>
        <div>
          {!editing && (
            <div className="type-picker">
              <div className="type-grid">
                {SIMPLE_TYPES.map((k) => <TypeButton key={k} k={k} on={k === type} pick={pickType} />)}
              </div>
              {showAdvanced ? (
                <>
                  <div className="type-group-label">{t('For science and engineering')}</div>
                  <div className="type-grid">
                    {ADVANCED_TYPES.map((k) => <TypeButton key={k} k={k} on={k === type} pick={pickType} />)}
                  </div>
                </>
              ) : (
                <button type="button" className="btn ghost small more-types" onClick={() => setAdvanced(true)}>
                  <Plus size={15} /> {t('More card types for science and engineering')}
                </button>
              )}
            </div>
          )}
          <div className="panel pad">
            <label className="field"><span>{t('Course')}</span>
              <select value={courseId} onChange={(e) => setCourseId(Number(e.target.value))}>
                {courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <Fields type={type} d={raw} set={set} />
            <details className="more-options" open={!!(tags || sourceText || sourceUrl) || undefined}>
              <summary>{t('More options (tags, source)')}</summary>
              <Text label="Tags" value={tags} onChange={setTags} placeholder="control-theory exam-2026" />
              <div className="row">
                <Text label="Source (optional)" value={sourceText} onChange={setSourceText} placeholder="Lab 1 report, p. 4" />
                <Text label="Source link" type="url" value={sourceUrl} onChange={setSourceUrl} placeholder="https://…" />
              </div>
            </details>
          </div>
          <div className="sticky-actions">
            <button className="btn primary" onClick={save}>{editing ? t('Save') : t('Add card')} <kbd>Ctrl ↵</kbd></button>
            {editing ? <button className="btn ghost" onClick={back}>{t('Cancel')}</button> : <Link className="btn ghost" to={courseId ? `/course/${courseId}` : '/'}>{t('Done')}</Link>}
            {editing && (
              <>
                <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={async () => {
                  try {
                    await api(`/api/notes/${id}/suspend`, { body: { suspended: !suspended } });
                    setSuspended(!suspended);
                  } catch (err) { setError((err as Error).message); }
                }}>{suspended ? t('Unsuspend') : t('Suspend')}</button>
                <button className="btn ghost danger" onClick={async () => {
                  if (!confirmDelete) return setConfirmDelete(true);
                  try {
                    await api(`/api/notes/${id}`, { method: 'DELETE' });
                    back();
                  } catch (err) { setError((err as Error).message); }
                }}>{confirmDelete ? t('Really delete?') : t('Delete')}</button>
              </>
            )}
          </div>
        </div>

        <div className="preview">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="field-label" style={{ margin: 0 }}>{t('Preview')}</span>
            {ords.length > 1 && (
              <select value={Math.min(previewOrd, ords.length - 1)} onChange={(e) => setPreviewOrd(Number(e.target.value))} style={{ width: 'auto', padding: '4px 8px' }} aria-label={t('Card to preview')}>
                {ords.map((o, i) => <option key={o} value={i}>{ORD_LABEL(o, i)}</option>)}
              </select>
            )}
            <button className="btn small" style={{ marginLeft: 'auto' }} onClick={() => setShowBack((b) => !b)}>{showBack ? t('Showing answer') : t('Showing question')}</button>
          </div>
          <div className="panel pad" style={{ minHeight: 160 }}>
            {ord
              ? <CardView key={`${type}-${ord}-${showBack}`} note={{ type, data: d, sourceText, sourceUrl }} ord={ord} revealed={showBack} />
              : <span className="muted">{type === 'cloze' ? t('Add a cloze deletion like {{c1::answer}} to create a card.') : type === 'occlusion' ? t('Upload an image and draw a box to create a card.') : t('Nothing to preview yet.')}</span>}
          </div>
          <p className="hint">{tn(ords.length, '{n} card from this note.', '{n} cards from this note.')}</p>
        </div>
      </div>
    </div>
  );
}
