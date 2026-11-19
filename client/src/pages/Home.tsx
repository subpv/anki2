import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, FileText, Play, Plus, Timer } from 'lucide-react';
import { NOTE_TYPE_LABELS, noteTitle, type Course, type Note, type Summary } from '../../../shared/types.ts';
import { api, daysUntil, timeAgo } from '../api.ts';
import { CourseDot, useApp } from '../App.tsx';
import { GoalRing, Heatmap, Known } from '../components/Progress.tsx';

export function Counts({ c }: { c: NonNullable<Course['counts']> }) {
  return (
    <div className="counts">
      <div className={`c-new ${c.new ? '' : 'zero'}`}><b>{c.new}</b>New</div>
      <div className={`c-learn ${c.learning ? '' : 'zero'}`}><b>{c.learning}</b>Learning</div>
      <div className={`c-due ${c.due ? '' : 'zero'}`}><b>{c.due}</b>To review</div>
    </div>
  );
}

export function ExamChip({ date }: { date: string | null }) {
  if (!date) return null;
  const d = daysUntil(date);
  if (d < 0) return null;
  return <div className="exam-chip"><CalendarClock size={14} /> Exam {d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`}</div>;
}

export function NoteRow({ n, showCourse = true }: { n: Note; showCourse?: boolean }) {
  return (
    <Link to={`/note/${n.id}`} className="list-row">
      <FileText size={20} />
      <div className="grow">
        <div className="title">{noteTitle(n.type, n.data)}</div>
        <div className="meta">
          {showCourse && n.courseName ? `${n.courseName} / ` : ''}{NOTE_TYPE_LABELS[n.type]}
          {n.cardCount && n.cardCount > 1 ? ` · ${n.cardCount} cards` : ''}
          {n.suspended ? ' · suspended' : ''}
          {n.tags ? ` · ${n.tags.split(' ').map((t) => `#${t}`).join(' ')}` : ''}
        </div>
      </div>
      <div className="right">{timeAgo(n.updated)}</div>
    </Link>
  );
}

export function Home({ onNewCourse }: { onNewCourse: () => void }) {
  const { courses } = useApp();
  const [recent, setRecent] = useState<Note[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => { api<Note[]>('/api/notes?limit=8').then(setRecent); api<Summary>('/api/summary').then(setSummary); }, []);

  const total = (courses ?? []).reduce((s, c) => s + (c.counts ? c.counts.new + c.counts.learning + c.counts.due : 0), 0);
  const h = new Date().getHours();
  const greeting = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="page">
      <p className="eyebrow">{greeting}</p>
      <div className="page-head">
        <div>
          <h1>Home</h1>
          <p className="sub">
            {courses === null ? ' ' : total > 0
              ? `${total} card${total === 1 ? '' : 's'} to study today across your courses.`
              : courses.length ? 'Nothing due right now. You are all caught up.' : 'Create a course to start adding cards.'}
          </p>
        </div>
        <div className="actions">
          {courses && courses.length > 0 && <Link to="/new" className="btn"><Plus size={18} /> Add card</Link>}
          {total > 0 && <Link to="/review?quick=1" className="btn" title="About 15 cards, then stop"><Timer size={17} /> 5-minute session</Link>}
          {total > 0 && <Link to="/review" className="btn primary"><Play size={17} /> Study all</Link>}
        </div>
      </div>

      {summary && courses && courses.length > 0 && <GoalRing s={summary} />}

      <h2>Due today</h2>
      {courses && courses.length === 0 && (
        <div className="empty">
          No courses yet. A course holds the cards for one subject, like Fluids or Ele2.
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={onNewCourse}><Plus size={18} /> New course</button>
            <Link to="/import" className="btn">Add a ready-made deck</Link>
          </div>
        </div>
      )}
      <div className="course-grid">
        {courses?.map((c) => (
          <Link key={c.id} to={`/course/${c.id}`} className="panel course-card">
            <div className="top"><CourseDot course={c} /> {c.name}</div>
            <Counts c={c.counts!} />
            {c.counts!.total > 0 && <Known value={c.known ?? 0} exam={!!c.examDate && daysUntil(c.examDate) >= 0} />}
            <ExamChip date={c.examDate} />
          </Link>
        ))}
      </div>

      {summary && summary.year.some((d) => d.count > 0) && (
        <>
          <h2>Your year</h2>
          <Heatmap year={summary.year} />
        </>
      )}

      <h2>Recently edited cards</h2>
      {recent && recent.length === 0 && <div className="empty">Cards you add or edit show up here.</div>}
      {recent && recent.length > 0 && <div className="list">{recent.map((n) => <NoteRow key={n.id} n={n} />)}</div>}
    </div>
  );
}
