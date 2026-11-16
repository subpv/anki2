import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { evaluate } from 'mathjs';
import { Check, Link2, TriangleAlert, X } from 'lucide-react';
import type { Note, ParamData, OcclusionData, FormulaData, NumericData } from '../../../shared/types.ts';
import { checkAnswer, fmtNum, type Verdict } from '../../../shared/units.ts';
import { clozeSource, highlight, renderMd, renderTex } from '../md.ts';

export const Md = ({ src, className = '' }: { src: string; className?: string }) => (
  <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: renderMd(src ?? '') }} />
);
const Tex = ({ src, display = true }: { src: string; display?: boolean }) => (
  <span className="md" dangerouslySetInnerHTML={{ __html: renderTex(src, display) }} />
);

export interface CardHandle {
  /** Called on Space/"Show answer". Returns true if the card handled it itself (e.g. revealed one more step). */
  advance(): boolean;
}

interface Props {
  note: Pick<Note, 'type' | 'data' | 'sourceText' | 'sourceUrl'>;
  ord: string;
  revealed: boolean;
  onReveal?: () => void;
  /** Suggested grade after an auto-checked answer: 1 = Again, 2 = Hard, 3 = Good. */
  onSuggest?: (rating: 1 | 2 | 3) => void;
  interactive?: boolean;
}

/** Random values for a parametrised problem, snapped to each variable's step. */
export function rollParams(data: ParamData): Record<string, number> {
  const scope: Record<string, number> = {};
  for (const v of data.vars ?? []) {
    const step = v.step > 0 ? v.step : 1;
    const n = Math.max(0, Math.floor((v.max - v.min) / step + 1e-9));
    scope[v.name] = Number((v.min + Math.round(Math.random() * n) * step).toPrecision(12));
  }
  return scope;
}

export function evalFormula(formula: string, scope: Record<string, number>): number | null {
  try {
    const r = evaluate(formula, { ...scope });
    const n = typeof r === 'number' ? r : Number(r);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function VerdictBox({ v, unit }: { v: Verdict; unit: string }) {
  const given = v.given !== undefined ? ` You answered ${fmtNum(v.given, 6)}${v.kind === 'missing-unit' || !unit ? '' : ` ${unit}`}.` : '';
  if (v.ok) return <div className="verdict ok"><Check size={18} /> Correct <span>{given}</span></div>;
  if (v.kind === 'missing-unit') return <div className="verdict meh"><TriangleAlert size={18} /> Right number, unit missing</div>;
  if (v.kind === 'unit') return <div className="verdict no"><X size={18} /> Wrong unit <span>expected {unit || 'no unit'}</span></div>;
  if (v.kind === 'invalid') return <div className="verdict no"><X size={18} /> Not a number</div>;
  return <div className="verdict no"><X size={18} /> Not quite <span>{given}</span></div>;
}

function NumericCard({ question, expected, unit, tolerance, explanation, revealed, onReveal, onSuggest, interactive }: {
  question: string; expected: number | null; unit: string; tolerance: number; explanation?: string;
} & Pick<Props, 'revealed' | 'onReveal' | 'onSuggest' | 'interactive'>) {
  const [input, setInput] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (interactive) ref.current?.focus(); }, [interactive]);
  useEffect(() => {
    if (!revealed || expected === null || !input.trim()) return;
    const v = checkAnswer(input, expected, unit, tolerance);
    setVerdict(v);
    onSuggest?.(v.ok ? 3 : v.kind === 'missing-unit' ? 2 : 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed]);
  return (
    <>
      <Md src={question} className="card-face" />
      {!revealed && (
        <form className="answer-row" onSubmit={(e) => { e.preventDefault(); onReveal?.(); }}>
          <input ref={ref} type="text" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder={unit ? `Answer in ${unit}` : 'Answer'} autoComplete="off" aria-label="Your answer" />
        </form>
      )}
      {revealed && (
        <>
          <hr className="card-sep" />
          {verdict && <VerdictBox v={verdict} unit={unit} />}
          {expected === null
            ? <div className="verdict no"><X size={18} /> The formula could not be evaluated</div>
            : <div className="big-answer">{fmtNum(expected)} {unit} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>±{tolerance} %</span></div>}
          {explanation && <Md src={explanation} className="card-face" />}
        </>
      )}
    </>
  );
}

function Occlusion({ data, ord, revealed }: { data: OcclusionData; ord: string; revealed: boolean }) {
  const target = ord.slice(2);
  return (
    <>
      {data.title && <Md src={data.title} className="card-face" />}
      <div className="occ" style={{ marginTop: data.title ? 12 : 0 }}>
        <img src={data.image} alt="" />
        {data.rects.map((r) => {
          const isTarget = r.id === target;
          const style = { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` };
          if (isTarget && revealed) return <div key={r.id} className="box shown" style={style} />;
          return <div key={r.id} className={`box ${isTarget ? 'target' : ''}`} style={style}>{isTarget ? '?' : ''}</div>;
        })}
      </div>
      {revealed && (
        <>
          <hr className="card-sep" />
          <div className="big-answer">{data.rects.find((r) => r.id === target)?.label || '(no label)'}</div>
        </>
      )}
    </>
  );
}

export const CardView = forwardRef<CardHandle, Props>(function CardView(
  { note, ord, revealed, onReveal, onSuggest, interactive = false }, ref,
) {
  const d = note.data;
  const [step, setStep] = useState(1);
  const scope = useMemo(() => (note.type === 'param' ? rollParams(d) : {}), [note.type, d]);

  useImperativeHandle(ref, () => ({
    advance() {
      if (note.type === 'derivation' && !revealed && step < (d.steps?.length ?? 0) - 1) {
        setStep((s) => s + 1);
        return true;
      }
      return false;
    },
  }), [note.type, revealed, step, d]);

  const body = (() => {
    switch (note.type) {
      case 'basic': {
        const [q, a] = ord === 'r' ? [d.back, d.front] : [d.front, d.back];
        return (
          <>
            <Md src={q} className="card-face" />
            {revealed && <><hr className="card-sep" /><Md src={a} className="card-face" /></>}
          </>
        );
      }
      case 'cloze':
        return (
          <>
            <Md src={clozeSource(d.text ?? '', Number(ord.slice(1)), revealed)} className="card-face" />
            {revealed && d.extra && <><hr className="card-sep" /><Md src={d.extra} className="card-face" /></>}
          </>
        );
      case 'numeric': {
        const n = d as NumericData;
        return <NumericCard question={n.question} expected={Number(n.value)} unit={n.unit ?? ''} tolerance={Number(n.tolerance) || 0}
          explanation={n.explanation} revealed={revealed} onReveal={onReveal} onSuggest={onSuggest} interactive={interactive} />;
      }
      case 'param': {
        const p = d as ParamData;
        const question = (p.question ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name) => (name in scope ? fmtNum(scope[name], 6) : m));
        return <NumericCard question={question} expected={evalFormula(p.formula ?? '', scope)} unit={p.unit ?? ''}
          tolerance={Number(p.tolerance) || 0} explanation={p.explanation} revealed={revealed} onReveal={onReveal}
          onSuggest={onSuggest} interactive={interactive} />;
      }
      case 'formula': {
        const f = d as FormulaData;
        if (ord === 'recall') {
          return (
            <>
              <div className="card-kicker">Write down the formula</div>
              <Md src={f.name} className="card-face" />
              {revealed && <><hr className="card-sep" /><Tex src={f.latex} />{f.notes && <Md src={f.notes} />}</>}
            </>
          );
        }
        if (ord === 'symbols') {
          return (
            <>
              <div className="card-kicker">Name every symbol and its unit</div>
              <Md src={f.name} className="card-face" />
              <Tex src={f.latex} />
              {revealed && (
                <>
                  <hr className="card-sep" />
                  <table className="symbols"><tbody>
                    {f.symbols.map((s, i) => (
                      <tr key={i}><td><Tex src={s.sym} display={false} /></td><td>{s.meaning}</td><td className="muted">{s.unit}</td></tr>
                    ))}
                  </tbody></table>
                </>
              )}
            </>
          );
        }
        const r = f.rearrangements.find((x) => `r:${x.id}` === ord);
        return (
          <>
            <div className="card-kicker">Rearrange — solve for <Tex src={r?.solveFor ?? ''} display={false} /></div>
            <Md src={f.name} className="card-face" />
            <Tex src={f.latex} />
            {revealed && <><hr className="card-sep" /><Tex src={r?.latex ?? ''} /></>}
          </>
        );
      }
      case 'code':
        return (
          <>
            <Md src={d.prompt} className="card-face" />
            {revealed && (
              <>
                <hr className="card-sep" />
                <div className="md"><pre><code dangerouslySetInnerHTML={{ __html: highlight(d.code ?? '', d.language) }} /></pre></div>
                {d.explanation && <Md src={d.explanation} />}
              </>
            )}
          </>
        );
      case 'derivation': {
        const steps: string[] = d.steps ?? [];
        const shown = revealed ? steps.length : Math.min(step, steps.length);
        return (
          <>
            <div className="card-kicker">Derivation — recall the next step before revealing it</div>
            <Md src={d.title} className="card-face" />
            <ol className="steps" style={{ marginTop: 14 }}>
              {steps.slice(0, shown).map((s, i) => <li key={i}><Md src={s} /></li>)}
              {shown < steps.length && <li className="hidden">{steps.length - shown} more step{steps.length - shown > 1 ? 's' : ''}…</li>}
            </ol>
          </>
        );
      }
      case 'occlusion':
        return <Occlusion data={d} ord={ord} revealed={revealed} />;
    }
  })();

  return (
    <div>
      {body}
      {revealed && (note.sourceText || note.sourceUrl) && (
        <div className="source">
          <Link2 size={14} />
          {note.sourceUrl
            ? <a href={note.sourceUrl} target="_blank" rel="noopener noreferrer">{note.sourceText || note.sourceUrl}</a>
            : note.sourceText}
        </div>
      )}
    </div>
  );
});
