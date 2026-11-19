export type NoteType =
  | 'basic' | 'cloze' | 'numeric' | 'param' | 'formula' | 'code' | 'derivation' | 'occlusion';

export interface BasicData { front: string; back: string; reverse?: boolean }
export interface ClozeData { text: string; extra?: string }
export interface NumericData { question: string; value: number; unit: string; tolerance: number; explanation?: string }
export interface ParamVar { name: string; min: number; max: number; step: number }
export interface ParamData {
  question: string; vars: ParamVar[]; formula: string; unit: string; tolerance: number; explanation?: string;
}
export interface FormulaSymbol { sym: string; meaning: string; unit: string }
export interface FormulaRearrangement { id: string; solveFor: string; latex: string }
export interface FormulaData {
  name: string; latex: string; symbols: FormulaSymbol[]; rearrangements: FormulaRearrangement[]; notes?: string;
}
export interface CodeData { prompt: string; language: string; code: string; explanation?: string }
export interface DerivationData { title: string; steps: string[] }
export interface OcclusionRect { id: string; x: number; y: number; w: number; h: number; label: string }
export interface OcclusionData { image: string; title?: string; rects: OcclusionRect[] }

export type NoteData =
  | BasicData | ClozeData | NumericData | ParamData | FormulaData | CodeData | DerivationData | OcclusionData;

export interface Note {
  id: number; courseId: number; type: NoteType; data: any; tags: string;
  sourceText: string; sourceUrl: string; created: number; updated: number;
  cardCount?: number; nextDue?: number | null; suspended?: boolean; courseName?: string;
}

export interface Course {
  id: number; name: string; color: string; examDate: string | null; newPerDay: number;
  counts?: { total: number; new: number; learning: number; due: number };
  /** Average chance of recalling a card of this course right now (unseen cards count as 0). */
  known?: number;
}

export interface ReviewCard {
  card: { id: number; ord: string; state: number; due: number; reps: number; lapses: number };
  note: Note;
  course: { id: number; name: string; color: string };
  intervals: Record<1 | 2 | 3 | 4, string>;
}

export interface Settings {
  retention: number; maxInterval: number; learningSteps: string; relearningSteps: string;
  /** Cards to review per day for the goal ring on Home. */
  dailyGoal: number;
  /** Seconds on the answer timer for a plain recall card; 0 turns the timer off. */
  answerSeconds: number;
}

export interface Summary {
  today: number; goal: number; streak: number; answerSeconds: number;
  /** One entry per day for the last 53 weeks, oldest first. */
  year: { day: number; count: number }[];
}

/** Card types that need working out get more time on the answer timer. */
export const TIMER_FACTOR: Record<NoteType, number> = {
  basic: 1, cloze: 1, occlusion: 1, formula: 1.5, code: 3, numeric: 3, param: 4, derivation: 4,
};

export const NOTE_TYPE_LABELS: Record<NoteType, string> = {
  basic: 'Basic',
  cloze: 'Cloze',
  numeric: 'Numeric answer',
  param: 'Parametrised problem',
  formula: 'Formula',
  code: 'Code',
  derivation: 'Derivation',
  occlusion: 'Image occlusion',
};

/** Indices of the cloze deletions in a text, e.g. "{{c2::x}} {{c1::y}}" -> [1, 2]. */
export function clozeIndices(text: string): number[] {
  const set = new Set<number>();
  for (const m of text.matchAll(/\{\{c(\d+)::/g)) set.add(Number(m[1]));
  return [...set].sort((a, b) => a - b);
}

/** The stable card keys a note generates. Cards keep their schedule as long as their key survives an edit. */
export function cardOrds(type: NoteType, data: any): string[] {
  switch (type) {
    case 'basic': return data.reverse ? ['f', 'r'] : ['f'];
    case 'cloze': return clozeIndices(data.text ?? '').map((i) => `c${i}`);
    case 'numeric': return ['n'];
    case 'param': return ['p'];
    case 'formula': return [
      'recall',
      ...((data.symbols ?? []).length ? ['symbols'] : []),
      ...(data.rearrangements ?? []).map((r: FormulaRearrangement) => `r:${r.id}`),
    ];
    case 'code': return ['c'];
    case 'derivation': return ['d'];
    case 'occlusion': return (data.rects ?? []).map((r: OcclusionRect) => `o:${r.id}`);
  }
}

/** Short plain-text title for lists. */
export function noteTitle(type: NoteType, data: any): string {
  const raw: string = (() => {
    switch (type) {
      case 'basic': return data.front;
      case 'cloze': return (data.text ?? '').replace(/\{\{c\d+::(.*?)(::.*?)?\}\}/g, '[$1]');
      case 'numeric': case 'param': return data.question;
      case 'formula': return data.name;
      case 'code': return data.prompt;
      case 'derivation': return data.title;
      case 'occlusion': return data.title || 'Image occlusion';
    }
  })() ?? '';
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/!\[.*?\]\(.*?\)/g, '[image]').replace(/\s+/g, ' ').trim();
  return text.length > 140 ? text.slice(0, 140) + '…' : text || '(empty)';
}
