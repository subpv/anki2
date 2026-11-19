import { useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import type { OcclusionData, OcclusionRect } from '../../../shared/types.ts';
import { uploadImage } from '../api.ts';
import { t } from '../i18n.ts';

const newId = () => Math.random().toString(36).slice(2, 8);

export function OcclusionEditor({ data, onChange }: { data: OcclusionData; onChange: (d: OcclusionData) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const start = useRef<{ x: number; y: number } | null>(null);

  const pos = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const rectOf = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
  });

  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError('');
    try { onChange({ ...data, image: await uploadImage(file), rects: [] }); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  };
  const update = (id: string, patch: Partial<OcclusionRect>) =>
    onChange({ ...data, rects: data.rects.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  return (
    <div>
      {error && <div className="error">{error}</div>}
      <label className="field"><span>{t('Title or question (optional)')}</span>
        <input type="text" value={data.title ?? ''} onChange={(e) => onChange({ ...data, title: e.target.value })} placeholder={t('e.g. Label the parts of the H-bridge')} />
      </label>
      <label className="btn" style={{ marginBottom: 12 }}>
        <Upload size={16} /> {busy ? t('Uploading…') : data.image ? t('Replace image') : t('Upload image')}
        <input type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {data.image && (
        <>
          <p className="hint" style={{ marginBottom: 8 }}>{t('Drag on the image to cover a label. Each box becomes one card.')}</p>
          <div
            ref={wrap} className="occ draw"
            onPointerDown={(e) => { start.current = pos(e); (e.target as Element).setPointerCapture?.(e.pointerId); }}
            onPointerMove={(e) => start.current && setGhost(rectOf(start.current, pos(e)))}
            onPointerUp={(e) => {
              if (!start.current) return;
              const r = rectOf(start.current, pos(e));
              start.current = null; setGhost(null);
              if (r.w > 0.015 && r.h > 0.015) {
                const id = newId();
                onChange({ ...data, rects: [...data.rects, { id, ...r, label: '' }] });
                setSel(id);
              }
            }}
          >
            <img src={data.image} alt="" draggable={false} />
            {data.rects.map((r, i) => (
              <div key={r.id} className={`box ${sel === r.id ? 'sel' : ''}`}
                style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
                {i + 1}
              </div>
            ))}
            {ghost && <div className="box ghost" style={{ left: `${ghost.x * 100}%`, top: `${ghost.y * 100}%`, width: `${ghost.w * 100}%`, height: `${ghost.h * 100}%` }} />}
          </div>
          <div style={{ marginTop: 14 }}>
            {data.rects.map((r, i) => (
              <div key={r.id} className="sub-row" style={{ gridTemplateColumns: '28px 1fr 36px' }}>
                <span className="muted num">{i + 1}</span>
                <input type="text" value={r.label} placeholder={t('What is under this box?')} autoFocus={sel === r.id}
                  onFocus={() => setSel(r.id)} onChange={(e) => update(r.id, { label: e.target.value })} />
                <button type="button" className="btn ghost small" aria-label={t('Remove box')}
                  onClick={() => onChange({ ...data, rects: data.rects.filter((x) => x.id !== r.id) })}><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
