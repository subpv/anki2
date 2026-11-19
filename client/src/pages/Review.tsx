import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Check, EyeOff, Hourglass, Pencil, Undo2, X } from 'lucide-react';
import { TIMER_FACTOR, type ReviewCard, type Summary } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { CourseDot, useApp } from '../App.tsx';
import { CardView, type CardHandle } from '../components/CardView.tsx';

const GRADES = [
  { g: 1, label: 'Again' }, { g: 2, label: 'Hard' }, { g: 3, label: 'Good' }, { g: 4, label: 'Easy' },
] as const;

interface Counts { new: number; learning: number; due: number }

/** A quick session stops after this many cards or minutes, whichever comes first. */
const QUICK_CARDS = 15;
const QUICK_MS = 5 * 60_000;

const fmtTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
};

export function Review({ mode }: { mode: 'review' | 'cram' }) {
  const { courseId } = useParams();
  const quick = useSearchParams()[0].get('quick') === '1' && mode === 'review';
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
  const [again, setAgain] = useState(0);
  const [finished, setFinished] = useState(false);
  const [answerSeconds, setAnswerSeconds] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const timedOutRef = useRef(false);
  const sessionStart = useRef(Date.now());
  const sessionMs = useRef(0);
  const shownAt = useRef(Date.now());
  const busy = useRef(false);
  const cardRef = useRef<CardHandle>(null);
  const course = courses?.find((c) => c.id === Number(courseId));

  const show = (card: ReviewCard | null) => {
    setCur(card); setRevealed(false); setSuggest(null); setSerial((s) => s + 1);
    setTimedOut(false); timedOutRef.current = false;
    if (!card) sessionMs.current = Date.now() - sessionStart.current;
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
  useEffect(() => { setLoading(true); setDone(0); setAgain(0); setFinished(false); sessionStart.current = Date.now(); load(); }, [load]);
  useEffect(() => { api<Summary>('/api/summary').then((s) => setAnswerSeconds(s.answerSeconds)).catch(() => {}); }, []);

  // Answer timer: when the bar runs out the answer is shown and the card counts as slow.
  const timeLimit = cur && answerSeconds > 0 ? answerSeconds * TIMER_FACTOR[cur.note.type] : 0;
  useEffect(() => {
    if (!timeLimit || revealed || !cur) return;
    const t = setTimeout(() => {
      timedOutRef.current = true;
      setTimedOut(true);
      if (mode === 'review') setSuggest(2);
      setRevealed(true);
    }, timeLimit * 1000);
    return () => clearTimeout(t);
  }, [timeLimit, revealed, cur, serial, mode]);

  /** An auto-checked answer suggests a grade; after a timeout it is never better than Hard. */
  const onSuggest = useCallback((r: 1 | 2 | 3) => setSuggest(timedOutRef.current ? Math.min(r, 2) : r), []);

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
        if (rating === 1) setAgain((n) => n + 1);
        if (quick && (done + 1 >= QUICK_CARDS || Date.now() - sessionStart.current >= QUICK_MS)) {
          sessionMs.current = Date.now() - sessionStart.current;
          setFinished(true); setCur(null);
        } else await load();
      }
    } catch (err) { setError((err as Error).message); }
    busy.current = false;
  }, [cur, revealed, mode, queue, load, quick, done]);

  const undo = useCallback(async () => {
    if (mode !== 'review' || !canUndo || busy.current) return;
    busy.current = true;
    try {
      const r = await api<{ card: ReviewCard }>('/api/review/undo', { method: 'POST' });
      setDone((n) => Math.max(0, n - 1));
      setFinished(false);
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
      else if (e.key === 'h' && !revealed) cardRef.current?.hint();
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
          {quick && <span className="badge">5-minute session · {Math.min(done + 1, QUICK_CARDS)} / {QUICK_CARDS}</span>}
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
          <h1>{mode === 'cram' ? 'Cram finished' : finished ? 'Session complete' : done > 0 ? 'Done for now' : 'Nothing due'}</h1>
          <p className="sub">
            {mode === 'cram' ? `You went through all ${cramTotal} cards. The schedule was not changed.`
              : finished ? 'That was your 5-minute session.'
              : done > 0 ? 'Nothing else is due right now. Come back when more cards are ready.'
              : 'No cards are due here right now.'}
          </p>
          {mode === 'review' && done > 0 && (
            <div className="session-stats">
              <div><b>{done}</b>cards</div>
              <div><b>{Math.round(((done - again) / done) * 100)} %</b>remembered</div>
              <div><b>{fmtTime(sessionMs.current)}</b>time</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20 }}>
            <Link to={back} className="btn primary">Back</Link>
            {finished && (
              <button className="btn" onClick={() => { setFinished(false); setDone(0); setAgain(0); sessionStart.current = Date.now(); setLoading(true); load(); }}>
                Another 5 minutes
              </button>
            )}
            {mode === 'review' && canUndo && <button className="btn" onClick={undo}><Undo2 size={16} /> Undo last</button>}
          </div>
        </div>
      )}

      {cur && (
        <>
          {timeLimit > 0 && (
            <div className={`lifebar ${timedOut ? 'out' : revealed ? 'run stopped' : 'run'}`} role="timer" aria-label="Time left to answer">
              <i key={serial} style={{ animationDuration: `${timeLimit}s` }} />
            </div>
          )}
          <div className="panel review-card">
            {timedOut && <div className="timeup"><Hourglass size={15} /> Time's up</div>}
            {!course && <div className="card-kicker" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><CourseDot course={cur.course} size={18} /> {cur.course.name}</div>}
            <CardView key={serial} ref={cardRef} note={cur.note} ord={cur.card.ord} revealed={revealed} interactive
              onReveal={reveal} onSuggest={onSuggest} />
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
