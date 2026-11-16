import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, EyeOff, Pencil, Undo2, X } from 'lucide-react';
import type { ReviewCard } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { CourseDot, useApp } from '../App.tsx';
import { CardView, type CardHandle } from '../components/CardView.tsx';

const GRADES = [
  { g: 1, label: 'Again' }, { g: 2, label: 'Hard' }, { g: 3, label: 'Good' }, { g: 4, label: 'Easy' },
] as const;

interface Counts { new: number; learning: number; due: number }

export function Review({ mode }: { mode: 'review' | 'cram' }) {
  const { courseId } = useParams();
  const { courses } = useApp();
  const nav = useNavigate();
  const [cur, setCur] = useState<ReviewCard | null>(null);
  const [counts, setCounts] = useState<Counts>({ new: 0, learning: 0, due: 0 });
  const [queue, setQueue] = useState<ReviewCard[]>([]); // cram only
  const [cramTotal, setCramTotal] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [suggest, setSuggest] = useState<number | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(0);
  const [error, setError] = useState('');
  const [serial, setSerial] = useState(0);
  const shownAt = useRef(Date.now());
  const busy = useRef(false);
  const cardRef = useRef<CardHandle>(null);
  const course = courses?.find((c) => c.id === Number(courseId));

  const show = (card: ReviewCard | null) => {
    setCur(card); setRevealed(false); setSuggest(null); setSerial((s) => s + 1);
    shownAt.current = Date.now();
  };

  const load = useCallback(async () => {
    try {
      if (mode === 'cram') {
        const all = await api<ReviewCard[]>(`/api/courses/${courseId}/cram`);
        setCramTotal(all.length); setQueue(all.slice(1)); show(all[0] ?? null);
      } else {
        const r = await api<{ next: ReviewCard | null; counts: Counts; canUndo: boolean }>(`/api/review/next${courseId ? `?course=${courseId}` : ''}`);
        setCounts(r.counts); setCanUndo(r.canUndo); show(r.next);
      }
    } catch (err) { setError((err as Error).message); }
    setLoading(false);
  }, [mode, courseId]);
  useEffect(() => { setLoading(true); setDone(0); load(); }, [load]);

  const reveal = useCallback(() => {
    if (!cur || revealed) return;
    if (cardRef.current?.advance()) return;
    setRevealed(true);
  }, [cur, revealed]);

  const answer = useCallback(async (rating: number) => {
    if (!cur || !revealed || busy.current) return;
    busy.current = true;
    try {
      if (mode === 'cram') {
        const rest = rating === 1 ? [...queue, cur] : queue;
        if (rating !== 1) setDone((n) => n + 1);
        setQueue(rest.slice(1)); show(rest[0] ?? null);
      } else {
        await api('/api/review/answer', { body: { cardId: cur.card.id, rating, durationMs: Date.now() - shownAt.current } });
        setDone((n) => n + 1);
        await load();
      }
    } catch (err) { setError((err as Error).message); }
    busy.current = false;
  }, [cur, revealed, mode, queue, load]);

  const undo = useCallback(async () => {
    if (mode !== 'review' || !canUndo || busy.current) return;
    busy.current = true;
    try {
      const r = await api<{ card: ReviewCard }>('/api/review/undo', { method: 'POST' });
      setDone((n) => Math.max(0, n - 1));
      const fresh = await api<{ counts: Counts; canUndo: boolean }>(`/api/review/next${courseId ? `?course=${courseId}` : ''}`);
      setCounts(fresh.counts); setCanUndo(fresh.canUndo);
      show(r.card);
    } catch (err) { setError((err as Error).message); }
    busy.current = false;
  }, [mode, canUndo, courseId]);

  const suspend = async () => {
    if (!cur) return;
    await api(`/api/notes/${cur.note.id}/suspend`, { body: { suspended: true } });
    if (mode === 'cram') { const rest = queue.filter((q) => q.note.id !== cur.note.id); setQueue(rest.slice(1)); show(rest[0] ?? null); }
    else load();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName);
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (typing) return; // the answer field submits with Enter by itself
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (revealed) answer(mode === 'cram' ? 3 : suggest ?? 3); else reveal(); }
      else if (revealed && ['1', '2', '3', '4'].includes(e.key)) answer(mode === 'cram' ? (e.key === '1' ? 1 : 3) : Number(e.key));
      else if (e.key === 'z') undo();
      else if (e.key === 'e' && cur) nav(`/note/${cur.note.id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [revealed, answer, reveal, undo, suggest, cur, nav, mode]);

  const back = courseId ? `/course/${courseId}` : '/';
  const which = cur ? (cur.card.state === 0 ? 'n' : cur.card.state === 2 ? 'd' : 'l') : '';

  return (
    <div className="review">
      <div className="review-top">
        <Link to={back} className="icon-btn" aria-label="Close"><X size={18} /></Link>
        <div className="where">
          {course ? <><CourseDot course={course} size={22} /> {course.name}</> : 'All courses'}
          {mode === 'cram' && <span className="badge">Cram</span>}
        </div>
        {mode === 'review' ? (
          <div className="pill-counts" title="New · Learning · To review">
            <span className={`n ${which === 'n' ? 'cur' : ''}`}>{counts.new}</span>
            <span className={`l ${which === 'l' ? 'cur' : ''}`}>{counts.learning}</span>
            <span className={`d ${which === 'd' ? 'cur' : ''}`}>{counts.due}</span>
          </div>
        ) : (
          <div className="pill-counts"><span>{done} / {cramTotal}</span></div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {!loading && !cur && (
        <div className="done">
          <div className="big"><Check size={30} /></div>
          <h1>{mode === 'cram' ? 'Cram finished' : done > 0 ? 'Done for now' : 'Nothing due'}</h1>
          <p className="sub">
            {mode === 'cram' ? `You went through all ${cramTotal} cards. The schedule was not changed.`
              : done > 0 ? `You reviewed ${done} card${done === 1 ? '' : 's'}. Come back when more are due.`
              : 'No cards are due here right now.'}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20 }}>
            <Link to={back} className="btn primary">Back</Link>
            {mode === 'review' && canUndo && <button className="btn" onClick={undo}><Undo2 size={16} /> Undo last</button>}
          </div>
        </div>
      )}

      {cur && (
        <>
          <div className="panel review-card">
            {!course && <div className="card-kicker" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><CourseDot course={cur.course} size={18} /> {cur.course.name}</div>}
            <CardView key={serial} ref={cardRef} note={cur.note} ord={cur.card.ord} revealed={revealed} interactive
              onReveal={reveal} onSuggest={setSuggest} />
          </div>
          <div className="review-spacer" />
          <div className="review-bar">
            {!revealed ? (
              <button className="btn primary lg" style={{ width: '100%' }} onClick={reveal}>
                {cur.note.type === 'numeric' || cur.note.type === 'param' ? 'Check answer' : cur.note.type === 'derivation' ? 'Next step' : 'Show answer'} <kbd>Space</kbd>
              </button>
            ) : mode === 'cram' ? (
              <div className="grades" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <button className="grade g1" onClick={() => answer(1)}>Again<small>back in the pile · 1</small></button>
                <button className="grade g3" onClick={() => answer(3)}>Got it<small>Space</small></button>
              </div>
            ) : (
              <div className="grades">
                {GRADES.map(({ g, label }) => (
                  <button key={g} className={`grade g${g} ${suggest === g ? 'suggest' : ''}`} onClick={() => answer(g)}>
                    {label}<small>{cur.intervals[g]} · {g}</small>
                  </button>
                ))}
              </div>
            )}
            <div className="review-tools">
              {mode === 'review' && <button className="btn ghost small" disabled={!canUndo} onClick={undo}><Undo2 size={15} /> Undo <kbd>Z</kbd></button>}
              <Link className="btn ghost small" to={`/note/${cur.note.id}`}><Pencil size={15} /> Edit <kbd>E</kbd></Link>
              <button className="btn ghost small" onClick={suspend}><EyeOff size={15} /> Suspend</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
