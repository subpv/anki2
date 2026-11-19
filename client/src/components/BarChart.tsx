import { useState } from 'react';
import { locale, t } from '../i18n.ts';

export interface Bar { day: number; count: number; note?: string }

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 4, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/** Single-series daily bar chart with a hover tooltip and a table view. */
export function BarChart({ data, unit, label }: { data: Bar[]; unit: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 200, L = 34, R = 6, T = 8, B = 22;
  const max = niceMax(Math.max(...data.map((d) => d.count), 0));
  const slot = (W - L - R) / data.length;
  const bw = Math.min(24, slot - 2);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="panel chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = L + i * slot + (slot - bw) / 2;
          const top = y(d.count);
          const hgt = H - B - top;
          const r = Math.min(4, hgt, bw / 2);
          return (
            <g key={d.day} className={hover === i ? 'on' : ''}>
              {d.count > 0 && (
                <path className="bar" d={`M${x},${H - B} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${H - B} Z`} />
              )}
              <rect className="hit" x={L + i * slot} y={T} width={slot} height={H - T - B} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
              {(i % 7 === 0 || i === data.length - 1) && (data.length - 1 - i >= 4 || i === data.length - 1) && (
                <text x={x + bw / 2} y={H - 6} textAnchor={i === data.length - 1 ? 'end' : 'middle'}>{fmtDay(d.day)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover !== null && (
        <div className="chart-tip" style={{ left: `calc(18px + (100% - 36px) * ${(L + (hover + 0.5) * slot) / W})`, top: `calc(18px + ${(y(h.count) / H) * 100}% * 0.8)` }}>
          <b>{h.count}</b> {unit} · {fmtDay(h.day)}{h.note ? ` · ${h.note}` : ''}
        </div>
      )}
      <details>
        <summary>{t('Show as table')}</summary>
        <table className="data">
          <thead><tr><th>{t('Day')}</th><th>{unit}</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.day}><td>{fmtDay(d.day)}</td><td>{d.count}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
