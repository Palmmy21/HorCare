// Small hand-drawn SVG charts (no chart library): scale to the container width, readable on a phone, with a text
// alternative for screen readers and a tooltip on every bar / point.

import { compactBaht, niceMax } from './chartMath';

export interface Series { key: string; label: string; color: string }

const AXIS = 'var(--color-gray-400, #9CA3AF)';
const GRID = 'var(--color-gray-200, #E5E7EB)';
const TEXT = 'var(--color-gray-600, #4B5563)';

interface BarProps {
  labels: string[];
  series: Series[];
  /** values[seriesIndex][labelIndex] in satang */
  values: number[][];
  mode: 'grouped' | 'stacked';
  /** Optional line drawn over the bars (e.g. last year), one value per label. */
  line?: { label: string; color: string; values: (number | null)[] };
  height?: number;
  title: string;
  format?: (v: number) => string;
}

export function BarChart({ labels, series, values, mode, line, height = 220, title, format = compactBaht }: BarProps) {
  const W = 640, padL = 44, padR = 8, padT = 10, padB = 28;
  const innerW = W - padL - padR, innerH = height - padT - padB;
  const totals = labels.map((_, i) => (mode === 'stacked' ? values.reduce((s, v) => s + Math.max(0, v[i] ?? 0), 0) : Math.max(...values.map(v => v[i] ?? 0), 0)));
  const lineMax = line ? Math.max(0, ...line.values.map(v => v ?? 0)) : 0;
  const max = niceMax(Math.max(...totals, lineMax, 1));
  const y = (v: number) => padT + innerH - (Math.max(0, v) / max) * innerH;
  const band = innerW / Math.max(labels.length, 1);
  const barW = mode === 'grouped' ? Math.min(22, (band * 0.8) / series.length) : Math.min(30, band * 0.62);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const alt = labels.map((l, i) => `${l}: ${series.map((s, si) => `${s.label} ${format(values[si][i] ?? 0)}`).join(', ')}`).join('; ');

  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={`${title}. ${alt}`} style={{ display: 'block', maxWidth: '100%', height: 'auto' }}>
      {ticks.map(t => (
        <g key={t}>
          <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <text x={padL - 6} y={y(t) + 4} fontSize={11} textAnchor="end" fill={TEXT}>{format(t)}</text>
        </g>
      ))}
      {labels.map((l, i) => {
        const cx = padL + band * i + band / 2;
        let acc = 0;
        return (
          <g key={l}>
            {series.map((s, si) => {
              const v = Math.max(0, values[si][i] ?? 0);
              if (mode === 'grouped') {
                const x = cx - (barW * series.length) / 2 + si * barW;
                return <rect key={s.key} x={x} y={y(v)} width={Math.max(barW - 1, 1)} height={Math.max(innerH - (y(v) - padT), 0)} fill={s.color} rx={2}><title>{`${l} · ${s.label}: ${format(v)}`}</title></rect>;
              }
              const top = y(acc + v), h = y(acc) - top;
              acc += v;
              return h > 0 ? <rect key={s.key} x={cx - barW / 2} y={top} width={barW} height={h} fill={s.color}><title>{`${l} · ${s.label}: ${format(v)}`}</title></rect> : null;
            })}
            <text x={cx} y={height - 8} fontSize={11} textAnchor="middle" fill={TEXT}>{l}</text>
          </g>
        );
      })}
      {line && (
        <g>
          <polyline fill="none" stroke={line.color} strokeWidth={2} strokeDasharray="5 3"
            points={line.values.map((v, i) => (v === null ? null : `${padL + band * i + band / 2},${y(v)}`)).filter(Boolean).join(' ')} />
          {line.values.map((v, i) => v === null ? null : <circle key={i} cx={padL + band * i + band / 2} cy={y(v)} r={3} fill={line.color}><title>{`${labels[i]} · ${line.label}: ${format(v)}`}</title></circle>)}
        </g>
      )}
      <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} stroke={AXIS} strokeWidth={1} />
    </svg>
  );
}

interface LineProps { labels: string[]; values: (number | null)[]; color: string; title: string; height?: number; format?: (v: number) => string; target?: number }

/** A rate (0–1+) over time, e.g. share of billed money collected. A dashed line marks the target. */
export function RateChart({ labels, values, color, title, height = 170, format = v => `${Math.round(v * 100)}%`, target }: LineProps) {
  const W = 640, padL = 44, padR = 12, padT = 10, padB = 28;
  const innerW = W - padL - padR, innerH = height - padT - padB;
  const max = Math.max(1, ...values.map(v => v ?? 0));
  const ceil = max <= 1 ? 1 : Math.ceil(max * 10) / 10;
  const y = (v: number) => padT + innerH - (Math.min(v, ceil) / ceil) * innerH;
  const band = innerW / Math.max(labels.length, 1);
  const pts = values.map((v, i) => (v === null ? null : { x: padL + band * i + band / 2, y: y(v), v, l: labels[i] }));
  const alt = labels.map((l, i) => `${l}: ${values[i] === null ? 'ไม่มีข้อมูล' : format(values[i]!)}`).join('; ');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={`${title}. ${alt}`} style={{ display: 'block', maxWidth: '100%', height: 'auto' }}>
      {[0, 0.5, 1].map(f => <g key={f}><line x1={padL} x2={W - padR} y1={y(f * ceil)} y2={y(f * ceil)} stroke={GRID} /><text x={padL - 6} y={y(f * ceil) + 4} fontSize={11} textAnchor="end" fill={TEXT}>{format(f * ceil)}</text></g>)}
      {target !== undefined && <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="#16A34A" strokeDasharray="4 4" strokeWidth={1} />}
      <polyline fill="none" stroke={color} strokeWidth={2.5} points={pts.filter(Boolean).map(p => `${p!.x},${p!.y}`).join(' ')} />
      {pts.map((p, i) => p && <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={color}><title>{`${p.l}: ${format(p.v)}`}</title></circle>)}
      {labels.map((l, i) => <text key={l} x={padL + band * i + band / 2} y={height - 8} fontSize={11} textAnchor="middle" fill={TEXT}>{l}</text>)}
    </svg>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.9rem', fontSize: '0.78rem', color: TEXT }}>
      {items.map(i => (
        <span key={i.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: i.dashed ? 0 : 12, borderRadius: 3, background: i.dashed ? 'transparent' : i.color, borderTop: i.dashed ? `2px dashed ${i.color}` : undefined, display: 'inline-block' }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
