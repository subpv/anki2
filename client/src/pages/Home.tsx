import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, FileText, Play, Plus, Timer } from 'lucide-react';
import { NOTE_TYPE_LABELS, noteTitle, type Course, type Note, type Summary } from '../../../shared/types.ts';
import { api, daysUntil, timeAgo } from '../api.ts';
import { t, tn } from '../i18n.ts';
import { CourseDot, useApp } from '../App.tsx';
import { GoalRing, Heatmap, Known } from '../components/Progress.tsx';

export function Counts({ c }: { c: NonNullable<Course['counts']> }) {
  return (
    <div className="counts">
      <div className={`c-new ${c.new ? '' : 'zero'}`}><b>{c.new}</b>{t('New')}</div>
      <div className={`c-learn ${c.learning ? '' : 'zero'}`}><b>{c.learning}</b>{t('Learning')}</div>
      <div className={`c-due ${c.due ? '' : 'zero'}`}><b>{c.due}</b>{t('To review')}</div>
    </div>
  );
}

export function ExamChip({ date }: { date: string | null }) {
  if (!date) return null;
  const d = daysUntil(date);
  if (d < 0) return null;
  return (
    <div className="exam-chip">
      <CalendarClock size={14} /> {d === 0 ? t('Exam today') : d === 1 ? t('Exam tomorrow') : t('Exam in {n} days', { n: d })}
    </div>
  );
}

export function NoteRow({ n, showCourse = true }: { n: Note; showCourse?: boolean }) {
  return (
    <Link to={`/note/${n.id}`} className="list-row">
      <FileText size={20} />
      <div className="grow">
        <div className="title">{noteTitle(n.type, n.data)}</div>
        <div className="meta">
          {showCourse && n.courseName ? `${n.courseName} / ` : ''}{t(NOTE_TYPE_LABELS[n.type])}
          {n.cardCount && n.cardCount > 1 ? ` · ${tn(n.cardCount, '{n} card', '{n} cards')}` : ''}
          {n.suspended ? ` · ${t('suspended')}` : ''}
          {n.tags ? ` · ${n.tags.split(' ').map((x) => `#${x}`).join(' ')}` : ''}
        </div>
      </div>
      <div className="right">{timeAgo(n.updated)}</div>
    </Link>
  );
}

export function Home({ onNewCourse }: { onNewCourse: () => void }) {
  const { courses } = useApp();
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => { api<Summary>('/api/summary').then(setSummary); }, []);

  const total = (courses ?? []).reduce((s, c) => s + (c.counts ? c.counts.new + c.counts.learning + c.counts.due : 0), 0);
  const h = new Date().getHours();
  const greeting = h < 5 ? t('Good night') : h < 12 ? t('Good morning') : h < 18 ? t('Good afternoon') : t('Good evening');

  return (
    <div className="page">
      <p className="eyebrow">{greeting}</p>
      <div className="page-head">
        <div>
          <h1>{t('Home')}</h1>
          <p className="sub">
            {courses === null ? ' ' : total > 0
              ? tn(total, '{n} card to study today across your courses.', '{n} cards to study today across your courses.')
              : courses.length ? t('Nothing due right now. You are all caught up.') : t('Create a course to start adding cards.')}
          </p>
        </div>
        <div className="actions">
          {courses && courses.length > 0 && <Link to="/new" className="btn"><Plus size={18} /> {t('Add card')}</Link>}
          {total > 0 && <Link to="/review?quick=1" className="btn" title={t('About 15 cards, then stop')}><Timer size={17} /> {t('5-minute session')}</Link>}
          {total > 0 && <Link to="/review" className="btn primary"><Play size={17} /> {t('Study all')}</Link>}
        </div>
      </div>

      {summary && courses && courses.length > 0 && <GoalRing s={summary} />}

      {summary && courses && courses.length > 0 && (
        <>
          <h2>{t('Study days, last year')}</h2>
          <Heatmap year={summary.year} />
        </>
      )}

      <h2>{t('Due today')}</h2>
      {courses && courses.length === 0 && (
        <div className="empty">
          {t('No courses yet. A course holds the cards for one subject, like Fluids or Ele2.')}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={onNewCourse}><Plus size={18} /> {t('New course')}</button>
            <Link to="/import" className="btn">{t('Add a ready-made deck')}</Link>
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
    </div>
  );
}
