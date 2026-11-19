import crypto from 'node:crypto';
import { cardOrds, type NoteType } from '../shared/types.ts';
import type { NoteInput } from './notes.ts';

/**
 * JSON import for every card type, e.g. written by an AI from lecture notes:
 *
 *   { "course": "Fluids", "notes": [ { "type": "basic", "front": "…", "back": "…" }, … ] }
 *
 * A bare array of notes works too. The fields of each type sit directly on the note.
 */

// LaTeX commands whose first letter is also a JSON escape (\b \f \n \r \t): a single backslash
// in front of them is almost certainly a forgotten double backslash, not a control character.
const LATEX_WORDS = new Set([
  'beta', 'bar', 'bf', 'binom', 'big', 'bigg', 'bigl', 'bigr', 'boxed', 'bot', 'bullet', 'backslash', 'begin', 'breve', 'bmod', 'bigcup', 'bigcap',
  'frac', 'dfrac', 'tfrac', 'forall', 'flat', 'frown', 'footnotesize',
  'nu', 'nabla', 'neq', 'ne', 'ni', 'not', 'neg', 'nolimits', 'newline', 'nexists', 'nmid', 'nleq', 'ngeq', 'notin',
  'rho', 'right', 'rightarrow', 'rightleftharpoons', 'rm', 'rangle', 'rceil', 'rfloor', 'rvert', 'rVert', 'rbrace', 'ref',
  'tau', 'theta', 'times', 'text', 'textbf', 'textit', 'textrm', 'textsf', 'texttt', 'textrm', 'tilde', 'to', 'top', 'triangle',
  'tan', 'tanh', 'tag', 'therefore', 'tfrac', 'tiny', 'tbinom', 'triangleq',
]);

/** Double single backslashes inside JSON strings that are meant as LaTeX. Returns the fixed text and how many were fixed. */
export function repairLatexBackslashes(text: string): { text: string; repaired: number } {
  let out = '';
  let inString = false;
  let repaired = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inString) {
      if (c === '"') inString = true;
      out += c;
      continue;
    }
    if (c === '"') { inString = false; out += c; continue; }
    if (c !== '\\') { out += c; continue; }
    const next = text[i + 1] ?? '';
    if (next === '\\' || next === '"' || next === '/') { out += c + next; i++; continue; }
    if ('bfnrt'.includes(next) && next !== '') {
      const word = text.slice(i + 1).match(/^[A-Za-z]+/)?.[0] ?? '';
      if (LATEX_WORDS.has(word)) { out += '\\\\'; repaired++; continue; }
      out += c; // a real \n, \t, …
      continue;
    }
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) { out += c; continue; }
    out += '\\\\'; // \alpha, \sqrt, \cdot, \( … are not valid JSON escapes
    repaired++;
  }
  return { text: out, repaired };
}

export type ImportProblem = { index: number; type: string; code: string; field?: string };

const TYPES: NoteType[] = ['basic', 'cloze', 'numeric', 'param', 'formula', 'code', 'derivation', 'occlusion', 'vocab'];
const LANGS = ['c', 'cpp', 'python', 'matlab', 'st', 'vhdl', 'verilog', 'armasm', 'bash', 'text'];
const id = () => crypto.randomBytes(4).toString('hex');
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN);

export interface ParsedJson { course: string; notes: Omit<NoteInput, 'courseId'>[]; problems: ImportProblem[]; repaired: number }

export function parseNotesJson(text: string): ParsedJson {
  const { text: fixed, repaired } = repairLatexBackslashes(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  let raw: unknown;
  try {
    raw = JSON.parse(fixed);
  } catch (err) {
    return { course: '', notes: [], repaired, problems: [{ index: -1, type: '', code: 'invalid-json', field: (err as Error).message }] };
  }
  const obj = Array.isArray(raw) ? { notes: raw } : (raw as Record<string, unknown>);
  const list = Array.isArray(obj?.notes) ? (obj.notes as Record<string, unknown>[]) : null;
  if (!list) return { course: '', notes: [], repaired, problems: [{ index: -1, type: '', code: 'no-notes' }] };

  const notes: ParsedJson['notes'] = [];
  const problems: ImportProblem[] = [];
  list.forEach((n, index) => {
    const type = str(n?.type).toLowerCase() as NoteType;
    const bad = (code: string, field?: string) => problems.push({ index: index + 1, type, code, field });
    if (!n || typeof n !== 'object') return bad('not-object');
    if (!TYPES.includes(type)) return bad('unknown-type', str(n.type));
    const need = (...fields: string[]) => fields.filter((f) => !str(n[f]).trim()).forEach((f) => bad('missing', f));
    let data: Record<string, unknown> = {};
    const before = problems.length;
    switch (type) {
      case 'basic':
        need('front', 'back');
        data = { front: str(n.front), back: str(n.back), reverse: n.reverse === true };
        break;
      case 'cloze':
        need('text');
        if (str(n.text) && !/\{\{c\d+::/.test(str(n.text))) bad('no-cloze', 'text');
        data = { text: str(n.text), extra: str(n.extra) };
        break;
      case 'numeric': {
        need('question');
        const value = num(n.value);
        if (!Number.isFinite(value)) bad('not-number', 'value');
        const tolerance = n.tolerance == null ? 2 : num(n.tolerance);
        if (!Number.isFinite(tolerance) || tolerance < 0) bad('not-number', 'tolerance');
        data = { question: str(n.question), value, unit: str(n.unit), tolerance, explanation: str(n.explanation) };
        break;
      }
      case 'param': {
        need('question', 'formula');
        const vars = Array.isArray(n.vars) ? n.vars : null;
        if (!vars?.length) bad('not-list', 'vars');
        const clean = (vars ?? []).map((v: any) => ({ name: str(v?.name), min: num(v?.min), max: num(v?.max), step: v?.step == null ? 1 : num(v?.step) }));
        clean.forEach((v) => {
          if (!/^[A-Za-z_]\w*$/.test(v.name) || ![v.min, v.max, v.step].every(Number.isFinite) || v.min > v.max) bad('bad-var', v.name || '?');
        });
        const tolerance = n.tolerance == null ? 2 : num(n.tolerance);
        if (!Number.isFinite(tolerance)) bad('not-number', 'tolerance');
        data = { question: str(n.question), vars: clean, formula: str(n.formula), unit: str(n.unit), tolerance, explanation: str(n.explanation) };
        break;
      }
      case 'formula':
        need('name', 'latex');
        data = {
          name: str(n.name), latex: str(n.latex), notes: str(n.notes),
          symbols: (Array.isArray(n.symbols) ? n.symbols : []).map((s: any) => ({ sym: str(s?.sym), meaning: str(s?.meaning), unit: str(s?.unit) })).filter((s) => s.sym),
          rearrangements: (Array.isArray(n.rearrangements) ? n.rearrangements : [])
            .map((r: any) => ({ id: str(r?.id) || id(), solveFor: str(r?.solveFor), latex: str(r?.latex) })).filter((r) => r.latex),
        };
        break;
      case 'code':
        need('prompt', 'code');
        data = { prompt: str(n.prompt), language: LANGS.includes(str(n.language)) ? str(n.language) : 'text', code: str(n.code), explanation: str(n.explanation) };
        break;
      case 'derivation': {
        need('title');
        const steps = (Array.isArray(n.steps) ? n.steps : []).map(str).filter((s) => s.trim());
        if (steps.length < 2) bad('not-list', 'steps');
        data = { title: str(n.title), steps };
        break;
      }
      case 'occlusion': {
        need('image');
        const rects = (Array.isArray(n.rects) ? n.rects : []).map((r: any) => ({
          id: str(r?.id) || id(), x: num(r?.x), y: num(r?.y), w: num(r?.w), h: num(r?.h), label: str(r?.label),
        }));
        if (!rects.length || rects.some((r) => ![r.x, r.y, r.w, r.h].every((v) => Number.isFinite(v) && v >= 0 && v <= 1))) bad('not-list', 'rects');
        data = { image: str(n.image), title: str(n.title), rects };
        break;
      }
      case 'vocab':
        need('word', 'meaning');
        data = { word: str(n.word).trim(), meaning: str(n.meaning).trim(), ...(str(n.picture).trim() ? { picture: str(n.picture).trim() } : {}), ...(str(n.note).trim() ? { note: str(n.note) } : {}) };
        break;
    }
    const sourceUrl = str(n.sourceUrl);
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) bad('bad-url', 'sourceUrl');
    if (problems.length === before && cardOrds(type, data).length === 0) bad('no-cards');
    if (problems.length === before) {
      notes.push({ type, data, tags: Array.isArray(n.tags) ? n.tags.map(str).join(' ') : str(n.tags), sourceText: str(n.source), sourceUrl });
    }
  });
  if (!list.length) problems.push({ index: -1, type: '', code: 'no-notes' });
  return { course: str(obj.course).trim(), notes, problems, repaired };
}
