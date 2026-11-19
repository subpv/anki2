import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NOTE_TYPE_LABELS, type Note, type NoteType } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { useApp } from '../App.tsx';
import { NoteRow } from './Home.tsx';
import { t, tn, t as tr } from '../i18n.ts';

export function Browse() {
  const { courses } = useApp();
  const [params, setParams] = useSearchParams();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const q = params.get('q') ?? '';
  const course = params.get('course') ?? '';
  const type = params.get('type') ?? '';
  const tag = params.get('tag') ?? '';

  useEffect(() => { api<string[]>('/api/tags').then(setTags); }, []);
  useEffect(() => {
    let live = true;
    api<Note[]>(`/api/notes?${new URLSearchParams({ q, course, type, tag, limit: '300' })}`).then((n) => live && setNotes(n));
    return () => { live = false; };
  }, [q, course, type, tag]);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <h1>{t('Browse')}</h1>
      <p className="sub">{t('Every card across your courses. Open one to edit, suspend or delete it.')}</p>
      <div className="filters">
        <input type="text" value={q} onChange={(e) => set('q', e.target.value)} placeholder={t('Search text, tags or source')} aria-label={t('Search')} />
        <select value={course} onChange={(e) => set('course', e.target.value)} aria-label={t('Course')}>
          <option value="">{t('All courses')}</option>
          {courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={type} onChange={(e) => set('type', e.target.value)} aria-label={t('Card type')}>
          <option value="">{t('All types')}</option>
          {(Object.keys(NOTE_TYPE_LABELS) as NoteType[]).map((t) => <option key={t} value={t}>{tr(NOTE_TYPE_LABELS[t])}</option>)}
        </select>
        <select value={tag} onChange={(e) => set('tag', e.target.value)} aria-label={t('Tag')}>
          <option value="">{t('All tags')}</option>
          {tags.map((t) => <option key={t} value={t}>#{t}</option>)}
        </select>
      </div>
      {notes && notes.length === 0 && <div className="empty">{t('No cards match these filters.')}</div>}
      {notes && notes.length > 0 && (
        <>
          <div className="list">{notes.map((n) => <NoteRow key={n.id} n={n} />)}</div>
          <p className="hint" style={{ marginTop: 10 }}>{notes.length === 300 ? t('Showing the first 300 matches.') : tn(notes.length, '{n} note', '{n} notes')}</p>
        </>
      )}
    </div>
  );
}
