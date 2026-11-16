import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Play, Plus, Zap } from 'lucide-react';
import type { Course, Note } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { CourseDot, useApp } from '../App.tsx';
import { Counts, ExamChip, NoteRow } from './Home.tsx';

const COLORS = ['#f26a2e', '#3987e5', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767', '#5c6b82'];

export function CourseModal({ course, onClose, onSaved, onDeleted }: {
  course?: Course; onClose: () => void; onSaved: (id: number) => void; onDeleted?: () => void;
}) {
  const [name, setName] = useState(course?.name ?? '');
  const [color, setColor] = useState(course?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)]);
  const [examDate, setExamDate] = useState(course?.examDate ?? '');
  const [newPerDay, setNewPerDay] = useState(String(course?.newPerDay ?? 20));
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = { name, color, examDate: examDate || null, newPerDay: Number(newPerDay) };
      if (course) { await api(`/api/courses/${course.id}`, { method: 'PUT', body }); onSaved(course.id); }
      else onSaved((await api<{ id: number }>('/api/courses', { body })).id);
    } catch (err) { setError((err as ApiError).message); }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="panel modal" onSubmit={save}>
        <h2>{course ? 'Course settings' : 'New course'}</h2>
        {error && <div className="error">{error}</div>}
        <label className="field"><span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Fluids" />
        </label>
        <div className="field">
          <span className="field-label">Colour</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {COLORS.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColor(c)}
                style={{ width: 30, height: 30, borderRadius: '50%', background: c, cursor: 'pointer', border: 0,
                  outline: color === c ? '2px solid var(--text)' : 'none', outlineOffset: 2 }} />
            ))}
          </div>
        </div>
        <div className="row">
          <label className="field"><span>Exam date (optional)</span>
            <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
          </label>
          <label className="field"><span>New cards per day</span>
            <input type="number" min={0} value={newPerDay} onChange={(e) => setNewPerDay(e.target.value)} />
          </label>
        </div>
        <p className="hint">With an exam date, no card is scheduled past the exam: each one comes up again in the last three days before it.</p>
        <div className="sticky-actions">
          <button className="btn primary" type="submit">{course ? 'Save' : 'Create course'}</button>
          <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
          {course && onDeleted && (
            <button className="btn ghost danger" type="button" style={{ marginLeft: 'auto' }}
              onClick={async () => {
                if (!confirmDelete) return setConfirmDelete(true);
                await api(`/api/courses/${course.id}`, { method: 'DELETE' });
                onDeleted();
              }}>
              {confirmDelete ? 'Delete course and all its cards?' : 'Delete'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

export function CoursePage() {
  const { id } = useParams();
  const { courses, refresh } = useApp();
  const nav = useNavigate();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [edit, setEdit] = useState(false);
  const course = courses?.find((c) => c.id === Number(id));

  useEffect(() => { setNotes(null); api<Note[]>(`/api/notes?course=${id}&limit=500`).then(setNotes); }, [id]);

  if (courses && !course) return <div className="page"><h1>Course not found</h1><p className="sub"><Link to="/">Back to Home</Link></p></div>;
  if (!course) return null;
  const c = course.counts!;
  const todo = c.new + c.learning + c.due;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}><CourseDot course={course} size={34} /> {course.name}</h1>
          <p className="sub">{c.total} card{c.total === 1 ? '' : 's'} · {course.newPerDay} new per day</p>
          <ExamChip date={course.examDate} />
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => setEdit(true)}><Pencil size={16} /> Settings</button>
          <Link to={`/new?course=${course.id}`} className="btn"><Plus size={18} /> Add card</Link>
          {c.total > 0 && <Link to={`/cram/${course.id}`} className="btn" title="Go through every card without changing the schedule"><Zap size={16} /> Cram</Link>}
          {todo > 0 && <Link to={`/review/${course.id}`} className="btn primary"><Play size={17} /> Study {todo}</Link>}
        </div>
      </div>

      <div className="panel pad" style={{ marginTop: 20 }}><Counts c={c} /></div>

      <h2>Cards</h2>
      {notes && notes.length === 0 && (
        <div className="empty">
          This course has no cards yet.
          <div><Link to={`/new?course=${course.id}`} className="btn primary"><Plus size={18} /> Add the first card</Link></div>
        </div>
      )}
      {notes && notes.length > 0 && <div className="list">{notes.map((n) => <NoteRow key={n.id} n={n} showCourse={false} />)}</div>}

      {edit && (
        <CourseModal course={course} onClose={() => setEdit(false)}
          onSaved={async () => { setEdit(false); await refresh(); }}
          onDeleted={async () => { await refresh(); nav('/'); }} />
      )}
    </div>
  );
}
