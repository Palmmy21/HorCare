import { useState, type ReactNode } from 'react';
import { ChevronDown, PenLine, AlertCircle } from 'lucide-react';
import type { Room, DormConfig } from '../../types';
import { getWorkspaceTerms } from '../../utils/workspaceTerminology';
import { DonutChart, RateChart } from '../Accounting/charts';
import type { Occupancy, RoomStatus } from '../../shared/roomOccupancy';

export type { RoomStatus };

// Colours are CSS tokens (index.css) so the grid follows light / dark mode.
export const STATUS_CONFIG: Record<RoomStatus, { label: string; color: string; bg: string; border: string; dot: string }> = {
  occupied: {
    label: 'มีผู้เช่า',
    color: 'var(--color-gray-900)',
    bg: 'var(--color-white)',
    border: 'var(--color-gray-200)',
    dot: 'var(--status-paid)',
  },
  vacant: {
    label: 'ว่าง',
    color: 'var(--color-gray-500)',
    bg: 'var(--color-gray-50)',
    border: 'var(--color-gray-300)',
    dot: 'var(--status-vacant)',
  },
  reserved: {
    label: 'ติดจอง',
    color: 'var(--color-gray-900)',
    bg: 'var(--color-warning-ultra-light)',
    border: 'var(--color-gray-200)',
    dot: 'var(--status-pending)',
  },
};

const ORDER: RoomStatus[] = ['occupied', 'vacant', 'reserved'];

export interface RoomStatusDashboardProps {
  rooms: Room[];
  /** Status per room id, derived from contracts (useRoomOccupancy). */
  occupancy: Record<string, Occupancy>;
  /** Opens the tenant profile of a room. Without it the tiles are read-only. */
  onOpenRoom?: (room: Room) => void;
  defaultCollapsed?: boolean;
  buildingType?: DormConfig['building_type'];
  /**
   * Occupancy rate (0–1) per month, oldest first, ending with the current month. Past months come from billed rooms;
   * the current month's value is replaced with today's contract-based rate so it matches the tiles. null = no data.
   * Without it only the status donut is drawn.
   */
  history?: { labels: string[]; values: (number | null)[] };
  /** Drawn instead of the tile grid (the Dashboard passes its mini plan). */
  map?: ReactNode;
  /** Opens the full plan page. */
  onOpenPlan?: () => void;
}

export default function RoomStatusDashboard({
  rooms,
  occupancy,
  onOpenRoom,
  defaultCollapsed = false,
  buildingType,
  history,
  map,
  onOpenPlan,
}: RoomStatusDashboardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const terms = getWorkspaceTerms(buildingType);

  const activeRooms = rooms.filter(r => r.is_active);
  const statusOf = (r: Room): RoomStatus => occupancy[r.id]?.status ?? 'vacant';

  const counts = activeRooms.reduce(
    (acc, r) => { acc[statusOf(r)] += 1; return acc; },
    { occupied: 0, vacant: 0, reserved: 0 } as Record<RoomStatus, number>,
  );
  // A real problem with a contract (ran out, not started). "No contract yet" is explained in the profile instead,
  // so a property that has not entered contracts is not covered in warning marks.
  const contractIssue = (r: Room) => { const o = occupancy[r.id]; return !!o?.warning && !o.override && o.source !== 'legacy'; };
  const overridden = activeRooms.filter(r => occupancy[r.id]?.override).length;
  const needsLook = activeRooms.filter(contractIssue).length;

  const labelOf = (s: RoomStatus) =>
    s === 'occupied' ? terms.occupiedUnitLabel : s === 'vacant' ? terms.vacantUnitLabel : terms.reservedUnitLabel;

  // Sort rooms: natural sort of room_number
  const sorted = [...activeRooms].sort((a, b) =>
    a.room_number.localeCompare(b.room_number, 'th', { numeric: true }),
  );

  const occupancyPct = activeRooms.length > 0 ? Math.round((counts.occupied / activeRooms.length) * 100) : 0;
  const rateValues = history?.values.map((v, i, all) =>
    i === all.length - 1 && activeRooms.length > 0 ? counts.occupied / activeRooms.length : v);
  const showTrend = !!history && !!rateValues && rateValues.filter(v => v !== null).length >= 2;

  return (
    <section className="panel room-map mb-6">
      <button
        type="button"
        className="room-map-head"
        onClick={() => setCollapsed(c => !c)}
        aria-expanded={!collapsed}
      >
        <span className="room-map-title">
          {terms.isMarket ? `ผังสถานะ${terms.unitNamePlural}` : `สถานะ${terms.unitNamePlural}`}
          <span className="room-map-occ">มีผู้เช่า {occupancyPct}%</span>
        </span>
        <span className="room-map-counts">
          {ORDER.map(s => (
            <span key={s}>
              {/* legend keys mirror the tiles: occupied tiles are plain, so their key is a plain tile swatch */}
              <i className={s === 'occupied' ? 'legend-tile' : 'status-dot'} style={s === 'occupied' ? undefined : { background: STATUS_CONFIG[s].dot }} aria-hidden />
              <span className="room-map-count-label">{labelOf(s)}</span> {counts[s]}
            </span>
          ))}
        </span>
        <ChevronDown size={18} className={`room-map-chevron ${collapsed ? '' : 'open'}`} aria-hidden />
      </button>

      {!collapsed && (
        <div className="room-map-body">
          <div className="room-map-charts">
            <div className="room-map-chart">
              <h3 className="room-map-chart-title">สัดส่วนสถานะ{terms.unitNamePlural}</h3>
              <DonutChart
                items={ORDER.map(s => ({ key: s, label: labelOf(s), value: counts[s], color: STATUS_CONFIG[s].dot }))}
                title={`สถานะ${terms.unitNamePlural}`}
                centerLabel="อัตราเข้าพัก"
                centerValue={`${occupancyPct}%`}
                format={n => `${n} ${terms.unitName}`}
                size={152}
              />
            </div>
            {history && (
              <div className="room-map-chart">
                <h3 className="room-map-chart-title">อัตราการเข้าพัก {history.labels.length} เดือน</h3>
                {showTrend
                  ? <RateChart labels={history.labels} values={rateValues!} color="var(--series-1)" title="อัตราการเข้าพัก" />
                  : <p className="room-map-chart-empty">ยังไม่มีบิลย้อนหลังพอจะแสดงแนวโน้ม · กราฟจะขึ้นเมื่อบันทึกบิลเดือนก่อน ๆ แล้ว</p>}
              </div>
            )}
          </div>
          {map ?? (
            <div className="room-tiles">
              {sorted.map(room => {
                const occ = occupancy[room.id];
                const status = statusOf(room);
                const cfg = STATUS_CONFIG[status];
                const why = occ ? (occ.override ? `ปรับเอง: ${occ.override.reason}` : occ.detail) : '';
                const label = `${terms.unitName} ${room.room_number} ${labelOf(status)}${why ? ` (${why})` : ''}${occ?.warning ? ` — ${occ.warning}` : ''}`;
                return (
                  <button
                    key={room.id}
                    id={`room-status-tile-${room.id}`}
                    type="button"
                    onClick={() => onOpenRoom?.(room)}
                    disabled={!onOpenRoom}
                    title={`${label}${onOpenRoom ? ' · แตะเพื่อเปิดข้อมูลผู้เช่า' : ''}`}
                    aria-label={label}
                    className={`room-status-tile ${status}`}
                  >
                    <span className="room-tile-top">
                      <span className="room-tile-num">{room.room_number}</span>
                      {occ?.override && <PenLine size={12} className="room-tile-flag override" aria-hidden />}
                      {contractIssue(room) && <AlertCircle size={12} className="room-tile-flag warn" aria-hidden />}
                    </span>
                    {/* Occupied is the normal state and stays unmarked, so vacant / reserved stand out */}
                    {status !== 'occupied' && (
                      <span className="room-tile-status">
                        <i className="status-dot" style={{ background: cfg.dot }} aria-hidden />
                        {cfg.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <p className="room-map-hint">
            สถานะคิดจากสัญญาเช่าและข้อมูลผู้เช่า
            {showTrend && <> · อัตราเดือนก่อน ๆ คิดจาก{terms.unitName}ที่ออกบิลค่าเช่า</>}
            {onOpenRoom && <> · แตะเลข{terms.unitName}เพื่อเปิดข้อมูลผู้เช่า</>}
            {onOpenPlan && <> · <button type="button" className="link-btn room-map-plan-link" onClick={onOpenPlan}>เปิดผังเต็ม</button></>}
            {overridden > 0 && <> · <PenLine size={11} aria-hidden /> ปรับเอง {overridden} {terms.unitName}</>}
            {needsLook > 0 && <> · <AlertCircle size={11} aria-hidden /> ควรตรวจสัญญา {needsLook} {terms.unitName}</>}
          </p>
        </div>
      )}
    </section>
  );
}
