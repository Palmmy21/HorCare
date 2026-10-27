import { useState, type ReactNode } from 'react';
import { AlertCircle, CalendarClock, Check, Clock, Link2, Minus, Plus, Wrench } from 'lucide-react';
import { rowsOf, type FloorPlan, type PlanGroup } from '../../shared/floorPlan';
import type { UnitMark } from '../../shared/planLayers';

export interface BoardUnit {
  id: string;
  number: string;
  /** Second line: shop / company name, goods, or tenant. */
  sub?: string;
  /** e.g. "48 ตร.ม." */
  meta?: string;
}

const ICONS: Record<UnitMark['icon'], ReactNode> = {
  check: <Check size={12} aria-hidden />, clock: <Clock size={12} aria-hidden />, alert: <AlertCircle size={12} aria-hidden />,
  minus: <Minus size={12} aria-hidden />, wrench: <Wrench size={12} aria-hidden />, calendar: <CalendarClock size={12} aria-hidden />, none: null,
};

export interface BoardEdit {
  onDropUnit: (roomId: string, groupId: string, col: number, row: number) => void;
  onSlotClick: (groupId: string, col: number, row: number) => void;
  onGapClick: (gapId: string) => void;
  groupTools?: (g: PlanGroup) => ReactNode;
}

interface Props {
  plan: FloorPlan;
  units: Record<string, BoardUnit>;
  marks: Record<string, UnitMark>;
  /** Units of the same tenant, per room id (the room itself included). */
  tenantGroups: Record<string, string[]>;
  groupLabel: string;
  unitLabel: string;
  selected: string[];
  onUnitClick?: (roomId: string, additive: boolean) => void;
  compact?: boolean;
  edit?: BoardEdit;
  /** The slot an "add here" menu is open on. */
  activeSlot?: { groupId: string; col: number; row: number } | null;
  slotMenu?: ReactNode;
}

/** The plan as one grid per floor / zone / street. Units are buttons; in edit mode they drag onto empty slots or swap. */
export default function FloorPlanBoard({ plan, units, marks, tenantGroups, groupLabel, unitLabel, selected, onUnitClick, compact, edit, activeSlot, slotMenu }: Props) {
  const [hoverTenant, setHoverTenant] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const highlight = new Set([...(hoverTenant ?? []), ...selected.flatMap(id => tenantGroups[id] ?? [])]);

  return (
    <div className={`plan-board${compact ? ' compact' : ''}${edit ? ' editing' : ''}`}>
      {plan.groups.map(g => {
        const rows = Math.max(1, rowsOf(g) + (edit ? 1 : 0));
        const taken = new Set<string>();
        for (const b of [...g.cells, ...g.gaps]) for (let c = b.col; c < b.col + b.w; c++) for (let r = b.row; r < b.row + b.h; r++) taken.add(`${c}:${r}`);
        const free: { col: number; row: number }[] = [];
        if (edit) for (let r = 0; r < rows; r++) for (let c = 0; c < g.cols; c++) if (!taken.has(`${c}:${r}`)) free.push({ col: c, row: r });
        const count = g.cells.length;
        return (
          <section key={g.id} className="plan-group" aria-label={g.name}>
            <header className="plan-group-head">
              <h3 className="plan-group-name">{g.name}</h3>
              <span className="plan-group-count">{count} {unitLabel}</span>
              {edit?.groupTools?.(g)}
            </header>
            <div className="plan-scroll">
              <div className="plan-grid" style={{ gridTemplateColumns: `repeat(${g.cols}, minmax(var(--plan-tile-min), 1fr))`, gridTemplateRows: `repeat(${rows}, var(--plan-tile-h))` }}>
                {g.gaps.map(x => (
                  <div key={x.id} className="plan-gap" style={{ gridColumn: `${x.col + 1} / span ${x.w}`, gridRow: `${x.row + 1} / span ${x.h}` }}>
                    {edit && <button type="button" className="plan-gap-btn" onClick={() => edit.onGapClick(x.id)} aria-label="เอาช่องว่างออก" title="เอาช่องว่างออก"><Minus size={14} aria-hidden /></button>}
                  </div>
                ))}
                {free.map(s => {
                  const key = `${g.id}:${s.col}:${s.row}`;
                  const open = activeSlot && activeSlot.groupId === g.id && activeSlot.col === s.col && activeSlot.row === s.row;
                  return (
                    <div key={key} className={`plan-slot${dropAt === key ? ' over' : ''}${open ? ' active' : ''}`} style={{ gridColumn: s.col + 1, gridRow: s.row + 1 }}
                      onDragOver={e => { if (dragging) { e.preventDefault(); setDropAt(key); } }}
                      onDragLeave={() => setDropAt(d => (d === key ? null : d))}
                      onDrop={e => { e.preventDefault(); setDropAt(null); const id = e.dataTransfer.getData('text/plain'); if (id) edit!.onDropUnit(id, g.id, s.col, s.row); }}>
                      <button type="button" className="plan-slot-btn" onClick={() => edit!.onSlotClick(g.id, s.col, s.row)} aria-label={`ช่องว่าง ${groupLabel} ${g.name} แถว ${s.row + 1} ช่อง ${s.col + 1}`}>
                        <Plus size={14} aria-hidden />
                      </button>
                    </div>
                  );
                })}
                {g.cells.map(c => {
                  const u = units[c.room_id];
                  const m = marks[c.room_id];
                  const key = `${g.id}:${c.col}:${c.row}`;
                  const group = tenantGroups[c.room_id];
                  const isSel = selected.includes(c.room_id);
                  const label = u ? `${u.number}${u.sub ? ` ${u.sub}` : ''} · ${m?.label ?? ''}${group ? ` · ผู้เช่าเดียวกัน ${group.length} ยูนิต` : ''}` : 'กำลังสร้าง';
                  return (
                    <button key={c.room_id} type="button"
                      className={`plan-unit tone-${m?.tone ?? 'base'}${isSel ? ' selected' : ''}${highlight.has(c.room_id) ? ' linked' : ''}${dropAt === key ? ' over' : ''}`}
                      style={{ gridColumn: `${c.col + 1} / span ${c.w}`, gridRow: `${c.row + 1} / span ${c.h}` }}
                      aria-label={label} title={label} aria-pressed={isSel}
                      disabled={!u}
                      onClick={e => u && onUnitClick?.(c.room_id, e.shiftKey || e.metaKey || e.ctrlKey)}
                      onPointerEnter={() => group && setHoverTenant(group)} onPointerLeave={() => setHoverTenant(null)}
                      draggable={!!edit && !!u}
                      onDragStart={e => { e.dataTransfer.setData('text/plain', c.room_id); e.dataTransfer.effectAllowed = 'move'; setDragging(c.room_id); }}
                      onDragEnd={() => { setDragging(null); setDropAt(null); }}
                      onDragOver={e => { if (edit && dragging && dragging !== c.room_id) { e.preventDefault(); setDropAt(key); } }}
                      onDragLeave={() => setDropAt(d => (d === key ? null : d))}
                      onDrop={e => { e.preventDefault(); setDropAt(null); const id = e.dataTransfer.getData('text/plain'); if (id && id !== c.room_id) edit!.onDropUnit(id, g.id, c.col, c.row); }}>
                      <span className="plan-unit-top">
                        <span className="plan-unit-num">{u?.number ?? '…'}</span>
                        {group && <span className="plan-unit-link" aria-hidden><Link2 size={11} />{group.length}</span>}
                        {!compact && u?.meta && <span className="plan-unit-meta">{u.meta}</span>}
                      </span>
                      {!compact && u?.sub && <span className="plan-unit-sub">{u.sub}</span>}
                      {m && m.tone !== 'base' && (
                        <span className="plan-unit-mark">{ICONS[m.icon]}{!compact && <span>{m.label}</span>}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {activeSlot?.groupId === g.id && slotMenu}
          </section>
        );
      })}
    </div>
  );
}
