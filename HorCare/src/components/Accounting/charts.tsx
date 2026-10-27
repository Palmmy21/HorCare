// Small hand-drawn SVG charts (no chart library). They render at the container's real pixel width so axis text stays
// readable on a phone, carry a text alternative for screen readers, and show a tooltip for the hovered / touched column.
// Colours come from the chart tokens in index.css (--series-*, --cat-*, --chart-*), so dark mode restyles them.
// Motion: columns grow from the baseline, lines draw themselves, the donut sweeps in — once, on mount, and never
// when the viewer asks for reduced motion (index.css turns the animations off).

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { compactBaht, niceMax } from './chartMath';

export interface Series { key: string; label: string; color: string }

const GRID = 'var(--chart-grid)';
const AXIS = 'var(--chart-axis)';
const TEXT = 'var(--chart-text)';
const SURFACE = 'var(--color-white)';
const FONT = 11;

/** Width of the wrapper in CSS pixels; charts draw at this width instead of scaling a fixed viewBox. */
function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Column with a rounded data end and a square baseline. */
function colPath(x: number, y: number, w: number, h: number, r = 5) {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Smooth path through points (monotone cubic, so the curve never overshoots the data). */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}` : '';
  const n = pts.length;
  const d: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  let out = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (pts[i + 1].x - pts[i].x) / 3;
    out += `C${pts[i].x + h},${pts[i].y + m[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - m[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return out;
}

/** Show every label when they fit, otherwise every n-th counted back from the last (the latest period always shows). */
function labelStep(band: number, longest: number) {
  const need = Math.max(28, longest * 6.4 + 8);
  return band >= need ? 1 : Math.ceil(need / band);
}

interface TipRow { label: string; color: string; value: string; dashed?: boolean; ghost?: boolean }

function Tooltip({ x, width, title, rows }: { x: number; width: number; title: string; rows: TipRow[] }) {
  const left = Math.min(Math.max(x, 110), width - 110);
  return (
    <div className="chart-tip" style={{ left }} role="presentation">
      <div className="chart-tip-title">{title}</div>
      {rows.map(r => (
        <div key={r.label} className="chart-tip-row">
          <span className={`chart-key${r.dashed ? ' dashed' : r.ghost ? ' ghost' : ''}`} style={{ ['--key' as string]: r.color }} />
          <span className="chart-tip-label">{r.label}</span>
          <span className="chart-tip-value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Frame({ children, tip, onLeave, wrapRef }: { children: ReactNode; tip: ReactNode; onLeave: () => void; wrapRef: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={wrapRef} className="chart-frame" onPointerLeave={onLeave}>
      {children}
      {tip}
    </div>
  );
}

/** A vertical fade of one colour: full strength at the data end, softer toward the baseline. */
function FadeGradient({ id, color, from = 1, to = 0.55 }: { id: string; color: string; from?: number; to?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" style={{ stopColor: color, stopOpacity: from }} />
      <stop offset="100%" style={{ stopColor: color, stopOpacity: to }} />
    </linearGradient>
  );
}

interface BarProps {
  labels: string[];
  series: Series[];
  /** values[seriesIndex][labelIndex] in satang */
  values: number[][];
  mode: 'grouped' | 'stacked';
  /** Optional line drawn over the bars (e.g. last year / the target), one value per label. */
  line?: { label: string; color: string; values: (number | null)[]; area?: boolean };
  /**
   * What the first series should reach (e.g. the amount due): drawn as a pale column behind that series' bar, which
   * fills it like a gauge, so "how much of it came in" reads without a second line to follow.
   */
  target?: { label: string; values: (number | null)[] };
  height?: number;
  title: string;
  format?: (v: number) => string;
  /** Longer format for the tooltip; defaults to `format`. */
  formatTip?: (v: number) => string;
  /** Index of a label to emphasise (e.g. the current month): bold label and its value written on the column. */
  highlight?: number;
}

export function BarChart({ labels, series, values, mode, line, target, height = 220, title, format = compactBaht, formatTip, highlight }: BarProps) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');
  const tipFmt = formatTip ?? format;
  const padR = 4, padT = 22, padB = 26;
  const totals = labels.map((_, i) => (mode === 'stacked' ? values.reduce((s, v) => s + Math.max(0, v[i] ?? 0), 0) : Math.max(...values.map(v => v[i] ?? 0), 0)));
  const lineMax = Math.max(0, ...(line?.values ?? []).map(v => v ?? 0), ...(target?.values ?? []).map(v => v ?? 0));
  const max = niceMax(Math.max(...totals, lineMax, 1));
  const pctOf = (i: number) => {
    const t = target?.values[i];
    return t && t > 0 ? Math.round(((values[0]?.[i] ?? 0) / t) * 100) : null;
  };
  const ticks = [0, 0.5, 1].map(f => f * max);
  const padL = Math.max(...ticks.map(t => format(t).length)) * 6.6 + 10;
  const innerW = W - padL - padR, innerH = height - padT - padB;
  const y = (v: number) => padT + innerH - (Math.max(0, v) / max) * innerH;
  const band = innerW / Math.max(labels.length, 1);
  const n = mode === 'grouped' ? series.length : 1;
  const barW = Math.max(3, Math.min(26, (band * 0.64 - (n - 1) * 3) / n));
  const step = labelStep(band, Math.max(...labels.map(l => l.length)));
  const alt = labels.map((l, i) => `${l}: ${series.map((s, si) => `${s.label} ${tipFmt(values[si][i] ?? 0)}`).join(', ')}`).join('; ');
  const cx = (i: number) => padL + band * i + band / 2;
  const linePts = line ? line.values.map((v, i) => (v === null ? null : { x: cx(i), y: y(v) })).filter(Boolean) as { x: number; y: number }[] : [];
  const lineD = smoothPath(linePts);
  const areaD = line?.area && linePts.length > 1 ? `${lineD}L${linePts[linePts.length - 1].x},${y(0)}L${linePts[0].x},${y(0)}Z` : '';

  const pick = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - padL) / band);
    setHover(i >= 0 && i < labels.length ? i : null);
  };

  const tip = hover === null ? null : (
    <Tooltip x={cx(hover)} width={W} title={labels[hover]} rows={[
      ...series.map((s, si) => ({ label: s.label, color: s.color, value: tipFmt(values[si][hover] ?? 0) })),
      ...(target && target.values[hover] ? [{ label: target.label, color: series[0].color, value: `${tipFmt(target.values[hover] as number)} · ได้ ${pctOf(hover)}%`, ghost: true }] : []),
      ...(line && line.values[hover] !== null ? [{ label: line.label, color: line.color, value: tipFmt(line.values[hover] as number), dashed: true }] : []),
    ]} />
  );

  return (
    <Frame wrapRef={ref} tip={tip} onLeave={() => setHover(null)}>
      <svg width={W} height={height} role="img" aria-label={`${title}. ${alt}`} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          {series.map(s => <FadeGradient key={s.key} id={`${uid}-${s.key}`} color={s.color} />)}
          {line?.area && <FadeGradient id={`${uid}-area`} color={line.color} from={0.16} to={0} />}
        </defs>
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? AXIS : GRID }} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={padL - 8} y={y(t) + 4} fontSize={FONT} textAnchor="end" style={{ fill: TEXT, fontVariantNumeric: 'tabular-nums' }}>{format(t)}</text>
          </g>
        ))}
        {hover !== null && <rect x={padL + band * hover + 2} y={padT - 6} width={band - 4} height={innerH + 6} rx={8} style={{ fill: 'var(--color-gray-100)' }} />}
        {areaD && <path d={areaD} className="chart-fade-in" style={{ fill: `url(#${uid}-area)` }} />}
        {labels.map((l, i) => {
          let acc = 0;
          const stackTop = series.reduce((k, _, si) => ((values[si][i] ?? 0) > 0 ? si : k), -1);
          const dim = hover !== null && hover !== i;
          return (
            <g key={`${l}-${i}`}>
              <g className="chart-grow" style={{ animationDelay: `${i * 55}ms`, opacity: dim ? 0.55 : 1, transition: 'opacity 150ms' }}>
                {target && mode === 'grouped' && (target.values[i] ?? 0) > 0 && (() => {
                  const t = target.values[i] as number;
                  const x = cx(i) - (barW * n + 3 * (n - 1)) / 2;
                  return <path d={colPath(x, y(t), barW, y(0) - y(t))} className="chart-ghost" style={{ fill: series[0].color, stroke: series[0].color }} />;
                })()}
                {series.map((s, si) => {
                  const v = Math.max(0, values[si][i] ?? 0);
                  if (v <= 0) return null;
                  const fill = `url(#${uid}-${s.key})`;
                  if (mode === 'grouped') {
                    const x = cx(i) - (barW * n + 3 * (n - 1)) / 2 + si * (barW + 3);
                    return <path key={s.key} d={colPath(x, y(v), barW, y(0) - y(v))} style={{ fill }} />;
                  }
                  const top = y(acc + v), bottom = y(acc);
                  acc += v;
                  // 2px surface gap between stacked segments; only the top segment gets the rounded end
                  const h = bottom - top - (si === 0 ? 0 : 2);
                  if (h <= 0) return null;
                  return si === stackTop
                    ? <path key={s.key} d={colPath(cx(i) - barW / 2, top, barW, h)} style={{ fill: s.color }} />
                    : <rect key={s.key} x={cx(i) - barW / 2} y={top} width={barW} height={h} style={{ fill: s.color }} />;
                })}
              </g>
              {i === highlight && target && pctOf(i) !== null && (
                <text x={cx(i)} y={y(Math.max(totals[i], target.values[i] ?? 0)) - 7} fontSize={FONT} fontWeight={600} textAnchor="middle" className="chart-fade-in"
                  style={{ fill: 'var(--color-gray-900)', fontVariantNumeric: 'tabular-nums', animationDelay: `${i * 55 + 450}ms` }}>
                  {`${format(values[0][i] ?? 0)} · ${pctOf(i)}%`}
                </text>
              )}
              {i === highlight && !target && totals[i] > 0 && (
                <text x={cx(i)} y={y(totals[i]) - 7} fontSize={FONT} fontWeight={600} textAnchor="middle" className="chart-fade-in"
                  style={{ fill: 'var(--color-gray-900)', fontVariantNumeric: 'tabular-nums', animationDelay: `${i * 55 + 450}ms` }}>
                  {format(totals[i])}
                </text>
              )}
              {(labels.length - 1 - i) % step === 0 && (
                <text x={cx(i)} y={height - 6} fontSize={FONT} textAnchor="middle"
                  style={{ fill: i === highlight ? 'var(--color-gray-900)' : TEXT, fontWeight: i === highlight ? 600 : 400 }}>{l}</text>
              )}
            </g>
          );
        })}
        {line && (
          <g pointerEvents="none" className="chart-fade-in" style={{ animationDelay: '300ms' }}>
            <path d={lineD} fill="none" style={{ stroke: line.color }} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
            {line.values.map((v, i) => v === null ? null : (
              <circle key={i} cx={cx(i)} cy={y(v)} r={hover === i ? 5 : 3.5} style={{ fill: line.color, stroke: SURFACE, transition: 'r 150ms' }} strokeWidth={2} />
            ))}
          </g>
        )}
        <rect x={padL} y={padT} width={innerW} height={innerH + padB} fill="transparent"
          onPointerMove={pick} onPointerDown={pick} />
      </svg>
    </Frame>
  );
}

interface NetProps {
  labels: string[];
  /** Net result per label in satang; null = nothing recorded that period. */
  values: (number | null)[];
  /** Extra tooltip rows per label (e.g. revenue and expenses), already formatted by the caller. */
  details?: { label: string; values: (number | null)[] }[];
  title: string;
  height?: number;
  format?: (v: number) => string;
  formatTip?: (v: number) => string;
  /** Hues for a gain and a loss; the sign is also written in the tooltip and the highlighted value. */
  colors?: { gain: string; loss: string };
  highlight?: number;
}

/** Column with a rounded data end below a zero line (a loss), square at the baseline. */
function colPathDown(x: number, y: number, w: number, h: number, r = 5) {
  if (h <= 0 || w <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y}V${y + h - rr}Q${x},${y + h} ${x + rr},${y + h}H${x + w - rr}Q${x + w},${y + h} ${x + w},${y + h - rr}V${y}Z`;
}

/** A result that can go either way (profit / loss) as columns growing up or down from a zero line. */
export function NetChart({ labels, values, details = [], title, height = 200, format = compactBaht, formatTip, colors = { gain: 'var(--series-1)', loss: 'var(--series-2)' }, highlight }: NetProps) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tipFmt = formatTip ?? format;
  const padR = 4, padT = 22, padB = 26;
  const nums = values.filter((v): v is number => v !== null);
  const top = niceMax(Math.max(0, ...nums));
  const bottom = Math.min(0, ...nums) < 0 ? -niceMax(-Math.min(...nums)) : 0;
  const ticks = bottom < 0 ? [bottom, 0, top] : [0, top / 2, top];
  const padL = Math.max(...ticks.map(t => format(t).length)) * 6.6 + 10;
  const innerW = W - padL - padR, innerH = height - padT - padB;
  const y = (v: number) => padT + ((top - v) / (top - bottom)) * innerH;
  const band = innerW / Math.max(labels.length, 1);
  const barW = Math.max(4, Math.min(28, band * 0.5));
  const step = labelStep(band, Math.max(...labels.map(l => l.length)));
  const cx = (i: number) => padL + band * i + band / 2;
  const signed = (v: number) => `${v < 0 ? '−' : ''}${tipFmt(Math.abs(v))}`;
  const alt = labels.map((l, i) => `${l}: ${values[i] === null ? 'ไม่มีข้อมูล' : signed(values[i]!)}`).join('; ');

  const pick = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - padL) / band);
    setHover(i >= 0 && i < labels.length ? i : null);
  };
  const tip = hover === null ? null : (
    <Tooltip x={cx(hover)} width={W} title={labels[hover]} rows={[
      ...details.map(d => ({ label: d.label, color: 'transparent', value: d.values[hover] === null ? '—' : tipFmt(d.values[hover]!) })),
      { label: title, color: (values[hover] ?? 0) < 0 ? colors.loss : colors.gain, value: values[hover] === null ? 'ไม่มีข้อมูล' : signed(values[hover]!) },
    ]} />
  );

  return (
    <Frame wrapRef={ref} tip={tip} onLeave={() => setHover(null)}>
      <svg width={W} height={height} role="img" aria-label={`${title}. ${alt}`} style={{ display: 'block', overflow: 'visible' }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? AXIS : GRID }} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={padL - 8} y={y(t) + 4} fontSize={FONT} textAnchor="end" style={{ fill: TEXT, fontVariantNumeric: 'tabular-nums' }}>{format(t)}</text>
          </g>
        ))}
        {hover !== null && <rect x={padL + band * hover + 2} y={padT - 6} width={band - 4} height={innerH + 6} rx={8} style={{ fill: 'var(--color-gray-100)' }} />}
        {labels.map((l, i) => {
          const v = values[i];
          const dim = hover !== null && hover !== i;
          const x = cx(i) - barW / 2;
          return (
            <g key={`${l}-${i}`}>
              {v !== null && v !== 0 && (
                <g className="chart-grow" style={{ animationDelay: `${i * 55}ms`, opacity: dim ? 0.55 : 1, transition: 'opacity 150ms' }}>
                  {v > 0
                    ? <path d={colPath(x, y(v), barW, y(0) - y(v))} style={{ fill: colors.gain }} />
                    : <path d={colPathDown(x, y(0), barW, y(v) - y(0))} style={{ fill: colors.loss }} />}
                </g>
              )}
              {i === highlight && v !== null && (
                <text x={cx(i)} y={v >= 0 ? y(v) - 7 : y(v) + 14} fontSize={FONT} fontWeight={600} textAnchor="middle" className="chart-fade-in"
                  style={{ fill: 'var(--color-gray-900)', fontVariantNumeric: 'tabular-nums', animationDelay: `${i * 55 + 450}ms` }}>
                  {`${v < 0 ? '−' : ''}${format(Math.abs(v))}`}
                </text>
              )}
              {(labels.length - 1 - i) % step === 0 && (
                <text x={cx(i)} y={height - 6} fontSize={FONT} textAnchor="middle"
                  style={{ fill: i === highlight ? 'var(--color-gray-900)' : TEXT, fontWeight: i === highlight ? 600 : 400 }}>{l}</text>
              )}
            </g>
          );
        })}
        <rect x={padL} y={padT} width={innerW} height={innerH + padB} fill="transparent" onPointerMove={pick} onPointerDown={pick} />
      </svg>
    </Frame>
  );
}

interface LineProps { labels: string[]; values: (number | null)[]; color: string; title: string; height?: number; format?: (v: number) => string; target?: number }

/** A rate (0–1+) over time, e.g. share of billed money collected. A dashed line marks the target. */
export function RateChart({ labels, values, color, title, height = 170, format = v => `${Math.round(v * 100)}%`, target }: LineProps) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const uid = useId().replace(/:/g, '');
  const padL = 44, padR = 40, padT = 14, padB = 26;
  const innerW = W - padL - padR, innerH = height - padT - padB;
  const max = Math.max(1, ...values.map(v => v ?? 0));
  const ceil = max <= 1 ? 1 : Math.ceil(max * 10) / 10;
  const y = (v: number) => padT + innerH - (Math.min(v, ceil) / ceil) * innerH;
  const band = innerW / Math.max(labels.length, 1);
  const cx = (i: number) => padL + band * i + band / 2;
  const pts = values.map((v, i) => (v === null ? null : { x: cx(i), y: y(v), v, l: labels[i] }));
  const step = labelStep(band, Math.max(...labels.map(l => l.length)));
  const alt = labels.map((l, i) => `${l}: ${values[i] === null ? 'ไม่มีข้อมูล' : format(values[i]!)}`).join('; ');
  const drawn = pts.filter(Boolean) as { x: number; y: number; v: number }[];
  const lineD = smoothPath(drawn);
  const area = drawn.length > 1 ? `${lineD}L${drawn[drawn.length - 1].x},${y(0)}L${drawn[0].x},${y(0)}Z` : '';
  const last = drawn[drawn.length - 1];

  const pick = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - padL) / band);
    setHover(i >= 0 && i < labels.length ? i : null);
  };
  const tip = hover === null ? null : (
    <Tooltip x={cx(hover)} width={W} title={labels[hover]} rows={[{ label: title, color, value: values[hover] === null ? 'ไม่มีข้อมูล' : format(values[hover]!) }]} />
  );

  return (
    <Frame wrapRef={ref} tip={tip} onLeave={() => setHover(null)}>
      <svg width={W} height={height} role="img" aria-label={`${title}. ${alt}`} style={{ display: 'block', overflow: 'visible' }}>
        <defs><FadeGradient id={`${uid}-area`} color={color} from={0.22} to={0} /></defs>
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={y(f * ceil)} y2={y(f * ceil)} style={{ stroke: f === 0 ? AXIS : GRID }} shapeRendering="crispEdges" />
            <text x={padL - 8} y={y(f * ceil) + 4} fontSize={FONT} textAnchor="end" style={{ fill: TEXT, fontVariantNumeric: 'tabular-nums' }}>{format(f * ceil)}</text>
          </g>
        ))}
        {target !== undefined && <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} style={{ stroke: 'var(--status-paid)' }} strokeDasharray="4 4" strokeWidth={1} />}
        {hover !== null && <line x1={cx(hover)} x2={cx(hover)} y1={padT} y2={y(0)} style={{ stroke: AXIS }} strokeWidth={1} />}
        {area && <path d={area} className="chart-fade-in" style={{ fill: `url(#${uid}-area)`, animationDelay: '400ms' }} />}
        <path d={lineD} fill="none" pathLength={1} className="chart-draw" style={{ stroke: color }} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => p && (
          <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 5.5 : i === drawn.length - 1 ? 4.5 : 3} className="chart-fade-in"
            style={{ fill: color, stroke: SURFACE, animationDelay: `${300 + i * 40}ms`, transition: 'r 150ms' }} strokeWidth={2} />
        ))}
        {last && (
          <text x={last.x + 9} y={last.y + 4} fontSize={12} fontWeight={600} className="chart-fade-in"
            style={{ fill: 'var(--color-gray-900)', fontVariantNumeric: 'tabular-nums', animationDelay: '900ms' }}>{format(last.v)}</text>
        )}
        {labels.map((l, i) => (labels.length - 1 - i) % step === 0 && <text key={`${l}-${i}`} x={cx(i)} y={height - 6} fontSize={FONT} textAnchor="middle" style={{ fill: TEXT }}>{l}</text>)}
        <rect x={padL} y={padT} width={innerW} height={innerH + padB} fill="transparent" onPointerMove={pick} onPointerDown={pick} />
      </svg>
    </Frame>
  );
}

export interface DonutItem { key: string; label: string; value: number; color: string }

/**
 * Parts of a whole as a ring that sweeps in, with the total in the middle. Touching a part puts its own amount and
 * share in the middle. Use for 2–5 parts; the list beside it carries the exact numbers, so colour is never the only key.
 */
export function DonutChart({ items, title, centerLabel, centerValue, format, size = 168 }: {
  items: DonutItem[]; title: string; centerLabel: string;
  /** What the middle shows while no part is touched; defaults to the formatted total. */
  centerValue?: string;
  format: (v: number) => string; size?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
  const stroke = 22, r = (size - stroke) / 2 - 4, c = 2 * Math.PI * r;
  const gap = items.filter(i => i.value > 0).length > 1 ? 3 : 0; // surface gap between parts
  const parts = items.filter(i => i.value > 0);
  const lens = parts.map(it => (it.value / total) * c);
  const arcs = parts.map((it, idx) => ({
    ...it, idx, len: Math.max(0, lens[idx] - gap),
    offset: lens.slice(0, idx).reduce((s, l) => s + l, 0), // where this part starts on the ring
  }));
  const shown = active ? items.find(i => i.key === active) : null;
  const pct = (v: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : '0%');

  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={`${title}. ${items.map(i => `${i.label} ${format(i.value)} (${pct(i.value)})`).join(', ')}`}
        onPointerLeave={() => setActive(null)}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'var(--color-gray-100)' }} strokeWidth={stroke} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {arcs.map(a => (
            <circle key={a.key} cx={size / 2} cy={size / 2} r={r} fill="none"
              className="donut-arc"
              style={{
                stroke: a.color,
                strokeDasharray: `${a.len} ${c - a.len}`,
                strokeDashoffset: -a.offset,
                ['--arc-len' as string]: `${a.len}`,
                ['--arc-c' as string]: `${c}`,
                animationDelay: `${a.idx * 120}ms`,
                opacity: active && active !== a.key ? 0.35 : 1,
              }}
              strokeWidth={active === a.key ? stroke + 6 : stroke}
              onPointerEnter={() => setActive(a.key)} onPointerDown={() => setActive(a.key)} />
          ))}
        </g>
        <text x="50%" y="46%" textAnchor="middle" className="donut-center-label">{shown ? shown.label : centerLabel}</text>
        <text x="50%" y="60%" textAnchor="middle" className="donut-center-value">{shown ? format(shown.value) : centerValue ?? format(total)}</text>
        {shown && <text x="50%" y="71%" textAnchor="middle" className="donut-center-label">{pct(shown.value)}</text>}
      </svg>
      <ul className="donut-legend">
        {items.map(i => (
          <li key={i.key} className={active === i.key ? 'active' : ''} onPointerEnter={() => setActive(i.key)} onPointerLeave={() => setActive(null)}>
            <span className="chart-key" style={{ ['--key' as string]: i.color }} />
            <span className="donut-legend-label">{i.label}</span>
            <span className="donut-legend-value">{format(i.value)}</span>
            <span className="donut-legend-pct">{pct(i.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean; ghost?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map(i => (
        <span key={i.label}>
          <span className={`chart-key${i.dashed ? ' dashed' : i.ghost ? ' ghost' : ''}`} style={{ ['--key' as string]: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
