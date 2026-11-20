/** Numeric answer checking with SI prefixes, e.g. "4,7 kΩ" against 4700 Ω ±2 %. */

const PREFIX: Record<string, number> = {
  T: 1e12, G: 1e9, M: 1e6, k: 1e3, h: 1e2, d: 1e-1, c: 1e-2, m: 1e-3, µ: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15,
};

export function normUnit(u: string): string {
  return u
    .trim()
    .replace(/\s+/g, '')
    .replace(/μ/g, 'µ') // greek mu -> micro sign
    .replace(/^u(?=[A-Za-zΩ])/, 'µ')
    .replace(/ohms?/gi, 'Ω')
    .replace(/Ω/g, 'Ω') // ohm sign -> greek omega
    .replace(/deg(rees?)?/gi, '°')
    .replace(/\*/g, '·');
}

/** Ways to read a unit string as prefix × base, e.g. "mA" -> [mA×1, A×1e-3]. */
function readings(unit: string): { base: string; factor: number }[] {
  const out = [{ base: unit, factor: 1 }];
  const p = unit[0];
  if (unit.length > 1 && p in PREFIX) out.push({ base: unit.slice(1), factor: PREFIX[p] });
  return out;
}

export function parseQuantity(input: string): { value: number; unit: string } | null {
  // Unicode minus (−) and en dash, as pasted from PDFs or typed on phones, count as a minus sign.
  const m = input.trim().replace(/[\u2212\u2013]/g, '-').match(/^([+-]?(?:\d+[.,]?\d*|[.,]\d+)(?:\s*(?:[eE]|[x×·*]\s*10\^?)\s*[+-]?\d+)?)\s*(.*)$/);
  if (!m) return null;
  const num = m[1].replace(',', '.').replace(/\s*(?:[x×·*]\s*10\^?)\s*/, 'e').replace(/\s+/g, '');
  const value = Number(num);
  if (!Number.isFinite(value)) return null;
  return { value, unit: normUnit(m[2]) };
}

export type Verdict =
  | { ok: true; kind: 'correct'; given: number }
  | { ok: false; kind: 'wrong' | 'unit' | 'missing-unit' | 'invalid'; given?: number };

/**
 * Compare a typed answer with the expected value (given in `unit`), within ±tolerance %.
 * `given` is the typed value converted to the expected unit.
 */
export function checkAnswer(input: string, expected: number, unit: string, tolerancePct: number): Verdict {
  const q = parseQuantity(input);
  if (!q) return { ok: false, kind: 'invalid' };
  const exp = normUnit(unit);
  let given = q.value;
  if (exp) {
    if (!q.unit) {
      const close = within(q.value, expected, tolerancePct);
      return { ok: false, kind: close ? 'missing-unit' : 'wrong', given: q.value };
    }
    let scale: number | null = null;
    outer: for (const e of readings(exp)) {
      for (const u of readings(q.unit)) {
        if (e.base === u.base) { scale = u.factor / e.factor; break outer; }
      }
    }
    if (scale === null) return { ok: false, kind: 'unit' };
    given = q.value * scale;
  } else if (q.unit) {
    return { ok: false, kind: 'unit' };
  }
  return within(given, expected, tolerancePct)
    ? { ok: true, kind: 'correct', given }
    : { ok: false, kind: 'wrong', given };
}

function within(a: number, b: number, tolPct: number): boolean {
  const tol = Math.abs(b) * (tolPct / 100);
  return Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 1e-9, 1e-12);
}

/** Format with a sensible number of significant figures, no float noise. */
export function fmtNum(x: number, sig = 4): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const abs = Math.abs(x);
  if (abs >= 1e6 || abs < 1e-3) return x.toExponential(sig - 1).replace(/\.?0+e/, 'e').replace('e+', 'e');
  return String(Number(x.toPrecision(sig)));
}
