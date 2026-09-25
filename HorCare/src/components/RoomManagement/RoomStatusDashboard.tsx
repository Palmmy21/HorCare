import { useState, useCallback } from 'react';
import { LayoutGrid, ChevronDown, ChevronUp, Store } from 'lucide-react';
import type { Room, DormConfig } from '../../types';
import { getWorkspaceTerms } from '../../utils/workspaceTerminology';

export type RoomStatus = 'occupied' | 'vacant' | 'reserved';

export const STATUS_CONFIG: Record<RoomStatus, { label: string; color: string; bg: string; border: string; dot: string }> = {
  occupied: {
    label: 'มีผู้เช่า',
    color: '#10B981',
    bg: 'rgba(16,185,129,0.12)',
    border: 'rgba(16,185,129,0.35)',
    dot: '#10B981',
  },
  vacant: {
    label: 'ว่าง',
    color: '#94A3B8',
    bg: 'rgba(148,163,184,0.10)',
    border: 'rgba(148,163,184,0.28)',
    dot: '#94A3B8',
  },
  reserved: {
    label: 'ติดจอง',
    color: '#F59E0B',
    bg: 'rgba(245,158,11,0.14)',
    border: 'rgba(245,158,11,0.38)',
    dot: '#F59E0B',
  },
};

export interface RoomStatusDashboardProps {
  rooms: Room[];
  onUpdateRoom?: (roomId: string, updates: Partial<Room>) => Promise<void>;
  defaultCollapsed?: boolean;
  buildingType?: DormConfig['building_type'];
}

export default function RoomStatusDashboard({
  rooms,
  onUpdateRoom,
  defaultCollapsed = false,
  buildingType,
}: RoomStatusDashboardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const terms = getWorkspaceTerms(buildingType);

  const activeRooms = rooms.filter(r => r.is_active);

  // Count by status
  const counts = activeRooms.reduce(
    (acc, r) => {
      const s = r.room_status ?? 'vacant';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    },
    { occupied: 0, vacant: 0, reserved: 0 } as Record<RoomStatus, number>,
  );

  // Cycle status: occupied → vacant → reserved → occupied
  const cycleStatus = useCallback(
    async (room: Room) => {
      if (!onUpdateRoom) return;
      const current = room.room_status ?? 'vacant';
      const next: RoomStatus =
        current === 'occupied' ? 'vacant' : current === 'vacant' ? 'reserved' : 'occupied';
      setUpdatingId(room.id);
      try {
        await onUpdateRoom(room.id, { room_status: next });
      } finally {
        setUpdatingId(null);
      }
    },
    [onUpdateRoom],
  );

  // Sort rooms: natural sort of room_number
  const sorted = [...activeRooms].sort((a, b) =>
    a.room_number.localeCompare(b.room_number, 'th', { numeric: true }),
  );

  return (
    <div
      className="card mb-6"
      style={{ overflow: 'hidden', padding: 0 }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.875rem 1rem',
          borderBottom: collapsed ? 'none' : '1px solid var(--color-border, #E5E7EB)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setCollapsed(c => !c)}
        role="button"
        aria-expanded={!collapsed}
        aria-label={`ผังสถานะ${terms.unitNamePlural}`}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {terms.isMarket ? (
            <Store size={17} color="#D97706" />
          ) : (
            <LayoutGrid size={17} color="var(--color-primary, #3B82F6)" />
          )}
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-text, #F1F5F9)' }}>
            {terms.isMarket ? `ผังสถานะ${terms.unitNamePlural}` : `ภาพรวมสถานะ${terms.unitNamePlural}`}
          </span>
          {/* Summary badges */}
          <div style={{ display: 'flex', gap: '0.375rem', marginLeft: '0.25rem' }}>
            {(['occupied', 'vacant', 'reserved'] as RoomStatus[]).map(s => (
              counts[s] > 0 && (
                <span
                  key={s}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                    fontSize: '0.72rem', fontWeight: 700,
                    padding: '0.15rem 0.45rem', borderRadius: '6px',
                    background: STATUS_CONFIG[s].bg,
                    color: STATUS_CONFIG[s].color,
                    border: `1px solid ${STATUS_CONFIG[s].border}`,
                  }}
                >
                  <span
                    style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: STATUS_CONFIG[s].dot, flexShrink: 0,
                    }}
                  />
                  {counts[s]}
                </span>
              )
            ))}
          </div>
        </div>
        <div style={{ color: 'var(--color-text-muted, #94A3B8)', display: 'flex' }}>
          {collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </div>
      </div>

      {/* Room grid */}
      {!collapsed && (
        <div style={{ padding: '0.875rem 1rem 1rem' }}>
          {/* Legend */}
          <div style={{
            display: 'flex', gap: '1rem', marginBottom: '0.75rem',
            flexWrap: 'wrap',
          }}>
            {(['occupied', 'vacant', 'reserved'] as RoomStatus[]).map(s => {
              const label = s === 'occupied' ? terms.occupiedUnitLabel
                : s === 'vacant' ? terms.vacantUnitLabel
                : terms.reservedUnitLabel;
              return (
                <span
                  key={s}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                    fontSize: '0.72rem', color: 'var(--color-text-muted, #94A3B8)',
                  }}
                >
                  <span
                    style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: STATUS_CONFIG[s].dot,
                    }}
                  />
                  {label}
                </span>
              );
            })}
            {onUpdateRoom && (
              <span style={{
                fontSize: '0.68rem',
                color: 'var(--color-text-muted, #94A3B8)',
                marginLeft: 'auto',
                alignSelf: 'center',
              }}>
                แตะ{terms.unitName}เพื่อเปลี่ยนสถานะ
              </span>
            )}
          </div>

          {/* Tiles */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
              gap: '0.5rem',
            }}
          >
            {sorted.map(room => {
              const status: RoomStatus = room.room_status ?? 'vacant';
              const cfg = STATUS_CONFIG[status];
              const isUpdating = updatingId === room.id;
              return (
                <button
                  key={room.id}
                  id={`room-status-tile-${room.id}`}
                  onClick={() => cycleStatus(room)}
                  disabled={isUpdating || !onUpdateRoom}
                  title={`ห้อง ${room.room_number} · ${cfg.label} · ${onUpdateRoom ? 'คลิกเพื่อเปลี่ยนสถานะ' : ''}`}
                  style={{
                    border: `1.5px solid ${cfg.border}`,
                    borderRadius: '10px',
                    background: cfg.bg,
                    padding: '0.5rem 0.25rem',
                    cursor: onUpdateRoom ? 'pointer' : 'default',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.3rem',
                    transition: 'all 0.15s',
                    opacity: isUpdating ? 0.5 : 1,
                    minWidth: 0,
                  }}
                  className="room-status-tile"
                >
                  {/* Status dot */}
                  <span
                    style={{
                      width: 7, height: 7,
                      borderRadius: '50%',
                      background: cfg.dot,
                      flexShrink: 0,
                    }}
                  />
                  {/* Room number */}
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      color: cfg.color,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '100%',
                      lineHeight: 1.2,
                    }}
                  >
                    {room.room_number}
                  </span>
                  {/* Status label */}
                  <span
                    style={{
                      fontSize: '0.62rem',
                      color: cfg.color,
                      opacity: 0.85,
                      textAlign: 'center',
                      lineHeight: 1.2,
                    }}
                  >
                    {cfg.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Summary row */}
          <div
            style={{
              marginTop: '0.875rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '0.5rem',
            }}
          >
            {(['occupied', 'vacant', 'reserved'] as RoomStatus[]).map(s => (
              <div
                key={s}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '0.625rem 0.5rem', borderRadius: '10px',
                  background: STATUS_CONFIG[s].bg,
                  border: `1px solid ${STATUS_CONFIG[s].border}`,
                  gap: '0.15rem',
                }}
              >
                <span style={{ fontWeight: 800, fontSize: '1.25rem', color: STATUS_CONFIG[s].color, lineHeight: 1 }}>
                  {counts[s]}
                </span>
                <span style={{ fontSize: '0.75rem', color: STATUS_CONFIG[s].color, fontWeight: 700 }}>
                  {STATUS_CONFIG[s].label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
