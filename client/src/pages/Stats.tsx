import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useApp } from '../App.tsx';
import { BarChart } from '../components/BarChart.tsx';
import { Heatmap } from '../components/Progress.tsx';
import { t, tn } from '../i18n.ts';

interface StatsData {
  states: { new: number; learning: number; young: number; mature: number; suspended: number; total: number };
  reviews: { day: number; count: number; again: number }[];
  forecast: { day: number; count: number }[];
  year: { day: number; count: number }[];
  streak: number; totalReviews: number; today: number; retention: number | null; retentionSample: number;
}

const Tile = ({ k, v, s }: { k: string; v: React.ReactNode; s?: string }) => (
  <div className="panel tile"><div className="k">{t(k)}</div><div className="v">{v}</div>{s && <div className="s">{t(s)}</div>}</div>
);

export function Stats() {
  const { courses } = useApp();
  const [course, setCourse] = useState('');
  const [data, setData] = useState<StatsData | null>(null);
  useEffect(() => { api<StatsData>(`/api/stats${course ? `?course=${course}` : ''}`).then(setData); }, [course]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{t('Stats')}</h1>
          <p className="sub">{t('How much you review, how well it sticks, and what is coming up.')}</p>
        </div>
        <div className="actions">
          <select value={course} onChange={(e) => setCourse(e.target.value)} aria-label={t('Course')} style={{ width: 200 }}>
            <option value="">{t('All courses')}</option>
            {courses?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>
      {data && (
        <>
          <h2>{t('Overview')}</h2>
          <div className="tiles">
            <Tile k="Reviewed today" v={data.today} />
            <Tile k="Study streak" v={tn(data.streak, '{n} day', '{n} days')} />
            <Tile k="Retention, 30 days" v={data.retention === null ? '–' : `${Math.round(data.retention * 100)} %`}
              s={data.retention === null ? 'No review-stage answers yet' : t('{n} review-stage answers', { n: data.retentionSample })} />
            <Tile k="Total reviews" v={data.totalReviews} />
          </div>

          <h2>{t('Cards')}</h2>
          <div className="tiles">
            <Tile k="New" v={data.states.new} s="Not studied yet" />
            <Tile k="Learning" v={data.states.learning} s="In short steps" />
            <Tile k="Young" v={data.states.young} s="Interval under 21 days" />
            <Tile k="Mature" v={data.states.mature} s="Interval 21 days or more" />
            <Tile k="Suspended" v={data.states.suspended} />
          </div>

          <h2>{t('Study days, last year')}</h2>
          <Heatmap year={data.year} />

          <h2>{t('Reviews per day, last 30 days')}</h2>
          <BarChart label={t('Reviews per day over the last 30 days')} unit={t('reviews')}
            data={data.reviews.map((r) => ({ day: r.day, count: r.count, note: r.again ? t('{n} again', { n: r.again }) : undefined }))} />

          <h2>{t('Cards due, next 30 days')}</h2>
          <BarChart label={t('Cards due per day over the next 30 days')} unit={t('cards due')} data={data.forecast} />
          <p className="hint">{t('The first bar includes anything overdue. New cards are not counted.')}</p>
        </>
      )}
    </div>
  );
}
