import { useEffect, useState } from 'react';
import {
  Users, User, Phone, AlertTriangle, Search,
  LogIn, Banknote, ChevronRight, Home, MessageCircle,
  UserCheck, UserX, Link2, CheckCheck, Store, Tag,
  PenTool, ShieldCheck, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Room, DormConfig } from '../../types';
import { useTenantProfile } from '../../hooks/useTenantProfiles';
import { fetchPortalUrl } from '../../utils/portalLinks';
import { getWorkspaceTerms } from '../../utils/workspaceTerminology';
import TenantProfilePage from '../TenantProfile/TenantProfilePage';
import InvitationModal from './InvitationModal';
import { useRoomOccupancy } from '../../hooks/useRoomOccupancy';
import { canOpenView } from '../../shared/viewAccess';
import type { Permission } from '../../shared/permissions';

interface TenantsPageProps {
  rooms: Room[];
  uid: string;
  buildingId: string;
  isPaid: boolean;
  onUpgrade?: () => void;
  onUpdateRoom?: (roomId: string, updates: Partial<Room>) => Promise<void>;
  buildingType?: DormConfig['building_type'];
  config?: DormConfig;
  /** Staff permissions; null for the owner. */
  permissions?: readonly Permission[] | null;
  /** Shown in the room-status override record. */
  actorName?: string;
  /** Open this room's profile on arrival (e.g. a room tapped on the Dashboard). */
  openRoomId?: string | null;
  onOpenRoomHandled?: () => void;
}

// ── Helper: วันที่เหลือ ──────────────────────────────────────────────────────
function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

function formatDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

import RoomStatusDashboard from '../RoomManagement/RoomStatusDashboard';

// ── Single room card (fetches its own profile) ───────────────────────────────
function TenantCard({
  room, uid, buildingId, onOpenProfile, onInvite, filter, search, buildingType,
}: {
  room: Room;
  uid: string;
  buildingId: string;
  isPaid?: boolean;
  onUpgrade?: () => void;
  onOpenProfile: (room: Room) => void;
  onInvite: (room: Room, tenantName?: string) => void;
  filter: FilterMode;
  search: string;
  buildingType?: DormConfig['building_type'];
}) {
  const terms = getWorkspaceTerms(buildingType);
  const { profile, loading } = useTenantProfile(uid, buildingId, room.id);
  const [copied, setCopied] = useState(false);

  const copyTenantLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    fetchPortalUrl(uid, buildingId, room.id)
      .then(url => navigator.clipboard.writeText(url))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error('คัดลอกลิงก์ไม่สำเร็จ กรุณาลองใหม่'));
  };

  const moveOutDays = daysUntil(profile?.expected_move_out);
  const contractDays = daysUntil(profile?.contract_end_date);

  const riskLevel: 'high' | 'medium' | 'none' =
    moveOutDays !== null && moveOutDays >= 0 && moveOutDays <= 14 ? 'high' :
    moveOutDays !== null && moveOutDays >= 0 && moveOutDays <= 60 ? 'medium' :
    contractDays !== null && contractDays >= 0 && contractDays <= 30 ? 'medium' : 'none';

  const hasProfile = !!profile?.full_name;

  // Filter + search (skip while profile is still loading to avoid flicker)
  if (!loading) {
    if (filter === 'has_profile' && !hasProfile) return null;
    if (filter === 'no_profile'  &&  hasProfile) return null;
    if (filter === 'signed'      && !profile?.signed_contract) return null;
    if (filter === 'risk'        && riskLevel === 'none') return null;
    if (search) {
      const q = search.toLowerCase();
      const hit = room.room_number.toLowerCase().includes(q)
        || (profile?.full_name ?? '').toLowerCase().includes(q)
        || (profile?.phone ?? '').includes(q)
        || (room.business_type ?? '').toLowerCase().includes(q)
        || (room.zone ?? '').toLowerCase().includes(q);
      if (!hit) return null;
    }
  }

  return (
    <div
      onClick={() => onOpenProfile(room)}
      style={{
        border: `1px solid ${
          riskLevel === 'high' ? 'rgba(220,38,38,0.35)' :
          riskLevel === 'medium' ? 'rgba(245, 158, 46,0.35)' :
          'var(--color-border, #DCE5EF)'
        }`,
        borderRadius: '14px',
        padding: '1rem 1.125rem',
        cursor: 'pointer',
        background: riskLevel === 'high'
          ? 'rgba(220,38,38,0.04)'
          : riskLevel === 'medium'
          ? 'rgba(245, 158, 46,0.04)'
          : 'var(--color-surface, #fff)',
        transition: 'all 0.15s',
        display: 'flex', alignItems: 'center', gap: '0.875rem',
        position: 'relative',
      }}
      className="tenant-card-hover"
    >
      {/* Avatar */}
      <div style={{
        width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
        background: hasProfile
          ? terms.isMarket
            ? 'linear-gradient(135deg, #E8740C, #F59E2E)'
            : 'linear-gradient(135deg, #0F4C81, #E8740C)'
          : 'var(--color-gray-100, #EBF1F7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.125rem', fontWeight: 800,
        color: hasProfile ? '#fff' : 'var(--color-gray-400, #8FA3B8)',
      }}>
        {hasProfile
          ? profile.full_name.charAt(0).toUpperCase()
          : <User size={20} />}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
          <span style={{
            fontWeight: 700, fontSize: '0.9rem',
            color: 'var(--color-text, #102A43)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {loading ? '...' : (profile?.full_name || 'ยังไม่มีข้อมูล')}
          </span>
          {room.line_user_id && (
            <span title="เชื่อมต่อ LINE แล้ว" style={{ flexShrink: 0, display: 'flex' }}>
              <MessageCircle size={13} color="#06C755" />
            </span>
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.625rem',
          fontSize: '0.775rem', color: 'var(--color-text-muted, #557089)',
          flexWrap: 'wrap',
        }}>
          {/* Room / Stall badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontWeight: 700,
            color: terms.isMarket ? '#9A3412' : 'inherit'
          }}>
            {terms.isMarket ? <Store size={13} color="#E8740C" /> : <Home size={12} />}
            {terms.unitPrefix}{room.room_number}
          </span>

          {/* Stall size / Business type */}
          {room.business_type && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
              color: '#15803D', background: 'rgba(34, 163, 90, 0.1)',
              padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 600, fontSize: '0.72rem'
            }}>
              <Tag size={10} /> {room.business_type}
            </span>
          )}

          {room.stall_size && (
            <span style={{ color: 'var(--color-gray-500)', fontSize: '0.72rem' }}>
              ({room.stall_size})
            </span>
          )}

          {/* Tenant Count badge */}
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: '#0A6CC2', fontWeight: 600 }}>
            <Users size={12} /> {profile?.tenant_count ?? room.tenant_count ?? 1} คน
          </span>

          {/* Phone */}
          {profile?.phone && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Phone size={12} /> {profile.phone}
            </span>
          )}

          {/* Move-in */}
          {profile?.move_in_date && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <LogIn size={12} /> {formatDate(profile.move_in_date)}
            </span>
          )}

          {/* Deposit */}
          {profile?.deposit_status && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
              padding: '0.1rem 0.4rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600,
              background:
                profile.deposit_status === 'returned' ? 'rgba(21, 128, 61,0.1)' :
                profile.deposit_status === 'deducted' ? 'rgba(220,38,38,0.1)' :
                'rgba(245, 158, 46,0.1)',
              color:
                profile.deposit_status === 'returned' ? '#15803D' :
                profile.deposit_status === 'deducted' ? '#DC2626' :
                '#E8740C',
            }}>
              <Banknote size={11} />
              {profile.deposit_status === 'held' ? `${terms.depositLabel}: ถือไว้` :
               profile.deposit_status === 'returned' ? 'คืนมัดจำแล้ว' : 'หักมัดจำ'}
            </span>
          )}

          {/* E-Signature status badge */}
          {profile?.signed_contract ? (
            profile.signed_contract.lessee_signature ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                padding: '0.1rem 0.45rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700,
                background: 'rgba(21, 128, 61,0.1)', color: '#15803D', border: '1px solid rgba(21, 128, 61,0.25)',
              }} title={`สัญญาเลขที่: ${profile.signed_contract.contract_number} (ลงนามครบ 2 ฝ่าย)`}>
                <ShieldCheck size={11} /> E-Sign: {profile.signed_contract.contract_number}
              </span>
            ) : (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                padding: '0.1rem 0.45rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700,
                background: '#FDEBD3', color: '#9A3412', border: '1px solid #FBD9A8',
              }} title={`สัญญาเลขที่: ${profile.signed_contract.contract_number} (ส่งร่างแล้ว รอผู้เช่าเซ็น)`}>
                <Clock size={11} /> รอเซ็น: {profile.signed_contract.contract_number}
              </span>
            )
          ) : (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
              padding: '0.1rem 0.45rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600,
              background: 'rgba(85, 112, 137,0.08)', color: 'var(--color-text-muted, #557089)', border: '1px solid rgba(85, 112, 137,0.15)',
            }}>
              <PenTool size={10} /> ยังไม่เซ็นสัญญา
            </span>
          )}
        </div>
      </div>

      {/* Right side: risk badge + copy link + chevron */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.375rem', flexShrink: 0 }}>
        {riskLevel !== 'none' && (
          <span style={{
            fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
            padding: '0.2rem 0.5rem', borderRadius: '7px',
            background: riskLevel === 'high' ? 'rgba(220,38,38,0.15)' : 'rgba(245, 158, 46,0.15)',
            color: riskLevel === 'high' ? '#F87171' : '#F7B86C',
            border: `1px solid ${riskLevel === 'high' ? 'rgba(220,38,38,0.3)' : 'rgba(245, 158, 46,0.3)'}`,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <AlertTriangle size={12} />
              {moveOutDays !== null && moveOutDays >= 0
                ? `ย้ายออกใน ${moveOutDays} วัน`
                : `สัญญาหมดใน ${contractDays} วัน`}
            </span>
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {/* Invite: owner-issued code that binds the tenant's LINE to exactly this room */}
          <button
            onClick={e => { e.stopPropagation(); onInvite(room, profile?.full_name); }}
            title={`สร้างรหัสเชิญให้${terms.tenantLabel}ลงทะเบียนห้องนี้`}
            style={{
              background: 'rgba(6,199,85,0.08)', border: '1px solid rgba(6,199,85,0.25)',
              borderRadius: '8px', padding: '0.3rem 0.5rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.25rem',
              color: '#15803D', fontSize: '0.7rem', fontWeight: 700,
            }}
          >
            <MessageCircle size={13} />
            <span className="tenant-link-label">เชิญ</span>
          </button>
          {/* Copy tenant portal link */}
          <button
            onClick={copyTenantLink}
            title={`คัดลอกลิงก์หน้า${terms.tenantLabel}`}
            style={{
              background: copied ? 'rgba(21, 128, 61,0.1)' : 'rgba(15, 76, 129,0.08)',
              border: `1px solid ${copied ? 'rgba(21, 128, 61,0.25)' : 'rgba(15, 76, 129,0.2)'}`,
              borderRadius: '8px', padding: '0.3rem 0.5rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
              color: copied ? '#15803D' : '#0F4C81',
              fontSize: '0.7rem', fontWeight: 700,
              transition: 'all 0.2s',
            }}
          >
            {copied ? <CheckCheck size={13} /> : <Link2 size={13} />}
            <span className="tenant-link-label">{copied ? 'คัดลอกแล้ว' : 'ลิงก์'}</span>
          </button>
          <ChevronRight size={16} color="var(--color-gray-300, #C3D0DE)" />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
type FilterMode = 'all' | 'has_profile' | 'signed' | 'no_profile' | 'risk';

export default function TenantsPage({
  rooms, uid, buildingId, isPaid, onUpgrade, onUpdateRoom, buildingType, config,
  permissions = null, actorName, openRoomId, onOpenRoomHandled,
}: TenantsPageProps) {
  const terms = getWorkspaceTerms(buildingType);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [inviteTarget, setInviteTarget] = useState<{ room: Room; tenantName?: string } | null>(null);

  const activeRooms = rooms.filter(r => r.is_active);
  // follow the live room (its override changes while the profile is open)
  const selectedRoom = selectedRoomId ? rooms.find(r => r.id === selectedRoomId) ?? null : null;
  const { byRoom: occupancy } = useRoomOccupancy(uid, buildingId, rooms, {
    leasing: canOpenView('leasing', permissions),
    tenants: true, // this page is only reachable with tenant.read
  });
  const canOverrideStatus = !!onUpdateRoom && (permissions === null || permissions.includes('room.update'));

  // A room tapped elsewhere (Dashboard) opens straight into its profile
  useEffect(() => {
    if (!openRoomId) return;
    if (rooms.some(r => r.id === openRoomId)) setSelectedRoomId(openRoomId); // eslint-disable-line react-hooks/set-state-in-effect
    onOpenRoomHandled?.();
  }, [openRoomId, rooms, onOpenRoomHandled]);

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {terms.isMarket ? <Store size={28} color="#E8740C" /> : <Users size={28} />} ข้อมูล{terms.tenantPlural}
        </h1>
        <p className="page-subtitle">
          จัดการและดูข้อมูล{terms.tenantLabel}ทั้งหมด {activeRooms.length} {terms.unitName}
        </p>
      </div>

      {/* ── Room Status Dashboard ── */}
      <RoomStatusDashboard rooms={rooms} occupancy={occupancy} onOpenRoom={r => setSelectedRoomId(r.id)} buildingType={buildingType} />

      {/* Search + Filter Bar */}
      <div className="card mb-6" style={{ padding: '0.75rem 0.875rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'var(--color-gray-50, #F4F7FB)',
          border: '1px solid var(--color-border, #DCE5EF)',
          borderRadius: '10px', padding: '0.5rem 0.75rem',
        }}>
          <Search size={15} color="var(--color-text-muted, #8FA3B8)" />
          <input
            type="text"
            placeholder={`ค้นหาชื่อ, เบอร์โทร หรือ${terms.unitNumberLabel}...`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              border: 'none', background: 'none', outline: 'none',
              flex: 1, fontSize: '0.875rem',
              color: 'var(--color-text, #102A43)',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted, #8FA3B8)', display: 'flex' }}>
              <UserX size={15} />
            </button>
          )}
        </div>

        {/* Filter tabs — segmented control */}
        <div style={{
          display: 'flex', flexWrap: 'wrap', background: 'var(--color-gray-100, #EBF1F7)',
          borderRadius: '10px', padding: '3px', gap: '2px',
        }}>
          {([
            { id: 'all',         label: 'ทั้งหมด',     icon: <Users size={13} /> },
            { id: 'has_profile', label: 'มีข้อมูล',    icon: <UserCheck size={13} /> },
            { id: 'signed',      label: 'สัญญา E-Sign', icon: <PenTool size={13} /> },
            { id: 'no_profile',  label: 'ไม่มีข้อมูล',   icon: <UserX size={13} /> },
            { id: 'risk',        label: 'เสี่ยงย้ายออก',  icon: <AlertTriangle size={13} /> },
          ] as { id: FilterMode; label: string; icon: React.ReactNode }[]).map(f => {
            const active = filter === f.id;
            const isRisk = f.id === 'risk';
            const isSigned = f.id === 'signed';
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '0.3rem', padding: '0.45rem 0.25rem', borderRadius: '8px',
                  border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '0.78rem',
                  fontWeight: active ? 700 : 500, transition: 'all 0.15s',
                  background: active
                    ? (isRisk ? 'rgba(220,38,38,0.12)' : isSigned ? 'rgba(21, 128, 61,0.12)' : '#fff')
                    : 'transparent',
                  color: active
                    ? (isRisk ? '#DC2626' : isSigned ? '#15803D' : 'var(--color-primary, #0F4C81)')
                    : 'var(--color-text-muted, #557089)',
                  boxShadow: active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                }}
              >
                {f.icon}
                <span style={{ display: 'none' }} className="tenant-link-label">{/* spacer */}</span>
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rooms Grid */}
      <TenantGrid
        rooms={activeRooms}
        uid={uid}
        buildingId={buildingId}
        isPaid={isPaid}
        onUpgrade={onUpgrade}
        search={search}
        filter={filter}
        onOpenProfile={r => setSelectedRoomId(r.id)}
        onInvite={(room, tenantName) => setInviteTarget({ room, tenantName })}
        buildingType={buildingType}
      />

      {inviteTarget && (
        <InvitationModal
          ownerUid={uid}
          buildingId={buildingId}
          room={inviteTarget.room}
          tenantName={inviteTarget.tenantName}
          unitName={terms.unitName}
          onClose={() => setInviteTarget(null)}
        />
      )}

      {/* Profile Modal */}
      {selectedRoom && (
        <TenantProfilePage
          room={selectedRoom}
          uid={uid}
          buildingId={buildingId}
          isPaid={isPaid}
          onUpgrade={onUpgrade}
          onClose={() => setSelectedRoomId(null)}
          config={config}
          occupancy={occupancy[selectedRoom.id]}
          canOverrideStatus={canOverrideStatus}
          onUpdateRoom={onUpdateRoom}
          actorName={actorName}
        />
      )}
    </div>
  );
}

// ── Tenant Grid (separated to avoid hook-in-loop issues) ────────────────────
function TenantGrid({
  rooms, uid, buildingId, isPaid, onUpgrade, search, filter, onOpenProfile, onInvite, buildingType,
}: {
  rooms: Room[];
  uid: string;
  buildingId: string;
  isPaid: boolean;
  onUpgrade?: () => void;
  search: string;
  filter: FilterMode;
  onOpenProfile: (room: Room) => void;
  onInvite: (room: Room, tenantName?: string) => void;
  buildingType?: DormConfig['building_type'];
}) {
  const terms = getWorkspaceTerms(buildingType);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))',
      gap: '0.75rem',
    }}>
      {rooms.length === 0 ? (
        <div className="empty-state" style={{ gridColumn: '1/-1' }}>
          {terms.isMarket ? <Store size={48} color="#E8740C" /> : <Users size={48} />}
          <h3>ยังไม่มี{terms.unitNamePlural}</h3>
          <p>เพิ่ม{terms.unitNamePlural}ใน "{terms.manageUnitsLabel}" ก่อน</p>
        </div>
      ) : (
        rooms.map(room => (
          <TenantCard
            key={room.id}
            room={room}
            uid={uid}
            buildingId={buildingId}
            isPaid={isPaid}
            onUpgrade={onUpgrade}
            onOpenProfile={onOpenProfile}
            onInvite={onInvite}
            filter={filter}
            search={search}
            buildingType={buildingType}
          />
        ))
      )}
    </div>
  );
}
