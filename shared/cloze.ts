/** Cloze gaps: `{{c1::answer}}` or `{{c1::answer::hint}}`. Braces inside the answer (LaTeX) are balanced. */
export interface ClozeGap {
  start: number;
  end: number;
  index: number;
  answer: string;
  hint: string;
  /** 'inline' inside $…$, 'display' inside $$…$$, otherwise null. */
  math: 'inline' | 'display' | null;
}

/** Math mode at each position: walks the text once, honouring `\$` escapes and `$$` markers. */
function mathAt(text: string, upto: number): 'inline' | 'display' | null {
  let mode: 'inline' | 'display' | null = null;
  for (let i = 0; i < upto; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch !== '$') continue;
    if (text[i + 1] === '$') {
      if (mode === null) mode = 'display';
      else if (mode === 'display') mode = null;
      i++;
    } else if (mode === null) mode = 'inline';
    else if (mode === 'inline') mode = null;
  }
  return mode;
}

export function parseCloze(text: string): ClozeGap[] {
  const gaps: ClozeGap[] = [];
  const open = /\{\{c(\d+)::/g;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text))) {
    const bodyStart = m.index + m[0].length;
    let depth = 0;
    let split = -1;
    let close = -1;
    for (let i = bodyStart; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        if (depth === 0 && text[i + 1] === '}') {
          close = i;
          break;
        }
        if (depth > 0) depth--;
      } else if (ch === ':' && text[i + 1] === ':' && depth === 0 && split < 0) {
        split = i;
        i++;
      }
    }
    if (close < 0) continue;
    const answer = text.slice(bodyStart, split >= 0 ? split : close);
    const hint = split >= 0 ? text.slice(split + 2, close) : '';
    gaps.push({ start: m.index, end: close + 2, index: Number(m[1]), answer, hint, math: mathAt(text, m.index) });
    open.lastIndex = close + 2;
  }
  return gaps;
}

export function clozeIndices(text: string): number[] {
  return [...new Set(parseCloze(text).map((g) => g.index))].sort((a, b) => a - b);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const texText = (s: string) => s.replace(/[\\{}$&#%_^~]/g, (ch) => (ch === '\\' ? '\\backslash ' : `\\${ch}`));

/** Markdown source for card `index`: that gap is blanked (or revealed), the other gaps show their answer. */
export function clozeSource(text: string, index: number, revealed: boolean): string {
  let out = '';
  let pos = 0;
  for (const g of parseCloze(text)) {
    out += text.slice(pos, g.start);
    pos = g.end;
    if (g.index !== index) { out += g.answer; continue; }
    if (g.math) {
      out += revealed
        ? `\\textcolor{#e8632a}{${g.answer}}`
        : `\\textcolor{#e8632a}{\\underline{\\;\\text{${g.hint ? texText(g.hint) : '?'}}\\;}}`;
    } else {
      out += revealed
        ? `<span class="cloze">${g.answer}</span>`
        : `<span class="cloze blank">${g.hint ? esc(g.hint) : '…'}</span>`;
    }
  }
  return out + text.slice(pos);
}
