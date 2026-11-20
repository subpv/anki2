import { useEffect, useRef, useState } from 'react';
import { Sigma } from 'lucide-react';
import { t } from '../i18n.ts';

/**
 * Visual formula editor (MathLive): fractions, roots, indices and Greek letters are typed like on a
 * calculator, with an on-screen formula keyboard on phones. The value is LaTeX. Loaded on first use.
 */
let loading: Promise<unknown> | null = null;
function loadMathLive() {
  if (!loading) {
    loading = import('mathlive').then((m) => {
      m.MathfieldElement.fontsDirectory = null; // the KaTeX fonts are already loaded by the app
      m.MathfieldElement.soundsDirectory = null;
    });
  }
  return loading;
}

type MathEl = HTMLElement & { value: string; hasFocus?: () => boolean };

/** Long form (\\frac{1}{2} rather than MathLive's \\frac12): easier to read and edit as text. */
const normalize = (latex: string) => latex.replace(/\\([dt]?frac)(\d)(\d)/g, '\\$1{$2}{$3}');

export function MathInput({ value, onChange, ariaLabel, small = false, autoFocus = false }: {
  value: string; onChange: (latex: string) => void; ariaLabel: string; small?: boolean; autoFocus?: boolean;
}) {
  const ref = useRef<MathEl>(null);
  const [ready, setReady] = useState(false);
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => { loadMathLive().then(() => setReady(true)); }, []);
  useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return;
    // While someone types, the field is the source of truth: writing back a value from an
    // earlier keystroke would swallow the newest characters.
    if (el.hasFocus?.()) return;
    if (normalize(el.value) !== (value ?? '')) el.value = value ?? '';
  }, [ready, value]);
  useEffect(() => {
    const el = ref.current;
    if (!ready || !el) return;
    const h = () => change.current(normalize(el.value));
    el.addEventListener('input', h);
    if (autoFocus) requestAnimationFrame(() => el.focus());
    return () => el.removeEventListener('input', h);
  }, [ready, autoFocus]);

  if (!ready) return <div className={`math-input loading ${small ? 'small' : ''}`} aria-busy="true" />;
  return <math-field ref={ref as never} class={`math-input ${small ? 'small' : ''}`} aria-label={ariaLabel} />;
}

/** Dialog to write a formula and put it into a text. */
export function FormulaDialog({ initial, initialBlock, onInsert, onClose }: {
  initial: string; initialBlock: boolean; onInsert: (latex: string, block: boolean) => void; onClose: () => void;
}) {
  const [latex, setLatex] = useState(initial);
  const [block, setBlock] = useState(initialBlock);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel modal formula-modal" role="dialog" aria-label={t('Formula')}>
        <h2><Sigma size={20} /> {t('Formula')}</h2>
        <p className="hint" style={{ marginTop: -6 }}>{t('Type like on a calculator: / makes a fraction, ^ a power, _ an index. Greek letters: type their name, e.g. alpha. On a phone, use the formula keyboard.')}</p>
        <MathInput value={latex} onChange={setLatex} ariaLabel={t('Formula')} autoFocus />
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '14px 0 4px' }}>
          <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> {t('On its own line, centred')}
        </label>
        <div className="sticky-actions">
          <button type="button" className="btn primary" disabled={!latex.trim()} onClick={() => onInsert(latex.trim(), block)}>{t('Insert')}</button>
          <button type="button" className="btn ghost" onClick={onClose}>{t('Cancel')}</button>
        </div>
      </div>
    </div>
  );
}
