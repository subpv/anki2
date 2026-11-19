import { useState } from 'react';
import { Flame } from 'lucide-react';
import type { Summary } from '../../../shared/types.ts';
import { locale, t, tn } from '../i18n.ts';

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });

/** Daily goal ring with the streak next to it. */
export function GoalRing({ s }: { s: Summary }) {
  const R = 34, C = 2 * Math.PI * R;
  const frac = Math.min(1, s.today / Math.max(1, s.goal));
  const done = s.today >= s.goal;
  const left = s.goal - s.today;
  return (
    <div className="panel goal">
      <svg viewBox="0 0 84 84" width="84" height="84" role="img" aria-label={t('{a} of {b} cards reviewed today', { a: s.today, b: s.goal })}>
        <circle cx="42" cy="42" r={R} className="ring-track" />
        <circle cx="42" cy="42" r={R} className={`ring-fill ${done ? 'done' : ''}`} strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 42 42)" />
        <text x="42" y="47" textAnchor="middle" className="ring-num">{s.today}</text>
      </svg>
      <div className="grow">
        <div className="goal-title">{done ? t('Daily goal reached') : t('{n} more to reach today\'s goal', { n: left })}</div>
        <div className="muted">{t('{a} of {b} cards reviewed today', { a: s.today, b: s.goal })}</div>
      </div>
      <div className={`streak ${s.streak > 0 ? 'on' : ''}`} title={t('Days in a row with at least one review')}>
        <Flame size={22} />
        <div><b>{s.streak}</b><span>{tn(s.streak, 'day streak', 'day streak')}</span></div>
      </div>
    </div>
  );
}

/** A year of study days: one square per day, darker for more reviews. */
export function Heatmap({ year }: { year: Summary['year'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...year.map((d) => d.count), 1);
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3.999)));
  // Pad so the first column starts on a Monday.
  const lead = (new Date(year[0].day).getDay() + 6) % 7;
  const cells: (number | null)[] = [...Array(lead).fill(null), ...year.map((_, i) => i)];
  const weeks = Math.ceil(cells.length / 7);
  const S = 13, G = 3;
  const active = year.filter((d) => d.count > 0).length;
  const total = year.reduce((n, d) => n + d.count, 0);
  const h = hover !== null ? year[hover] : null;
  return (
    <div className="panel heat">
      <div className="heat-scroll">
        <svg width={weeks * (S + G)} height={7 * (S + G)} role="img" aria-label={t('{a} reviews on {b} days in the last year', { a: total, b: active })}
          onMouseLeave={() => setHover(null)}>
          {cells.map((i, k) => i !== null && (
            <rect key={k} x={Math.floor(k / 7) * (S + G)} y={(k % 7) * (S + G)} width={S} height={S} rx={3}
              className={`heat-${level(year[i].count)} ${hover === i ? 'on' : ''}`} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
          ))}
        </svg>
      </div>
      <div className="heat-foot">
        <span>{h ? <>{tn(h.count, '{n} review', '{n} reviews')} · {fmtDay(h.day)}</> : t('{a} reviews on {b} days in the last year', { a: total, b: active })}</span>
        <span className="heat-legend">{t('Less')} {[0, 1, 2, 3, 4].map((l) => <i key={l} className={`heat-${l}`} />)} {t('More')}</span>
      </div>
    </div>
  );
}

/** "You know 68 % of this course", from the FSRS memory estimate. */
export function Known({ value, exam }: { value: number; exam?: boolean }) {
  const pct = Math.round(value * 100);
  return (
    <div className="known" title={t('Average chance of recalling a card from this course right now. Cards you have not studied yet count as 0.')}>
      <div className="known-bar"><i style={{ width: `${pct}%` }} /></div>
      <span><b>{pct} %</b> {exam ? t('exam readiness') : t('known')}</span>
    </div>
  );
}
