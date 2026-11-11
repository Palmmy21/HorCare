import { useEffect, useState } from 'react';
import {
  Users, User, Phone, AlertTriangle, Search,
  LogIn, Banknote, ChevronRight, Home, MessageCircle,
  UserCheck, UserX, Link2, CheckCheck, Store, Tag,
  PenTool, ShieldCheck, Clock, QrCode, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { Room, DormConfig } from '../../types';
import { useTenantProfile } from '../../hooks/useTenantProfiles';
import { fetchPortalUrl } from '../../utils/portalLinks';
import { getWorkspaceTerms } from '../../utils/workspaceTerminology';
import TenantProfilePage from '../TenantProfile/TenantProfilePage';
import InvitationModal from './InvitationModal';
import QrSheetModal from './QrSheetModal';
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

  const deposit = profile?.deposit_status;
  const contract = profile?.signed_contract;

  // Laid out top to bottom — who, the facts, a warning, the actions — so a narrow card grows taller instead of
  // squeezing the name and badges into a sliver beside the buttons.
  return (
    <div
      onClick={() => onOpenProfile(room)}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpenProfile(room); } }}
      role="button"
      tabIndex={0}
      className={`tenant-card tenant-card-hover${riskLevel !== 'none' ? ` is-risk-${riskLevel}` : ''}`}
    >
      <div className="tenant-card-top">
        <div className={`tenant-card-avatar${hasProfile ? (terms.isMarket ? ' is-market' : ' is-filled') : ''}`} aria-hidden>
          {hasProfile ? profile.full_name.charAt(0).toUpperCase() : <User size={20} />}
        </div>
        <div className="tenant-card-who">
          <div className="tenant-card-name">
            <span>{loading ? '...' : (profile?.full_name || 'ยังไม่มีข้อมูล')}</span>
            {room.line_user_id && <MessageCircle size={14} color="#06C755" aria-label="เชื่อมต่อ LINE แล้ว" />}
          </div>
          <div className="tenant-card-room">
            {terms.isMarket ? <Store size={13} color="#E8740C" aria-hidden /> : <Home size={13} aria-hidden />}
            {terms.unitPrefix}{room.room_number}
            {room.stall_size && <span className="tenant-card-muted">({room.stall_size})</span>}
          </div>
        </div>
        <ChevronRight size={18} className="tenant-card-go" aria-hidden />
      </div>

      <div className="tenant-card-facts">
        {room.business_type && <span className="tenant-chip is-green"><Tag size={11} aria-hidden /> {room.business_type}</span>}
        <span className="tenant-fact is-blue"><Users size={13} aria-hidden /> {profile?.tenant_count ?? room.tenant_count ?? 1} คน</span>
        {profile?.phone && <span className="tenant-fact"><Phone size={13} aria-hidden /> {profile.phone}</span>}
        {profile?.move_in_date && <span className="tenant-fact"><LogIn size={13} aria-hidden /> {formatDate(profile.move_in_date)}</span>}
        {deposit && (
          <span className={`tenant-chip ${deposit === 'returned' ? 'is-green' : deposit === 'deducted' ? 'is-red' : 'is-amber'}`}>
            <Banknote size={12} aria-hidden />
            {deposit === 'held' ? `${terms.depositLabel}: ถือไว้` : deposit === 'returned' ? 'คืนมัดจำแล้ว' : 'หักมัดจำ'}
          </span>
        )}
        {contract ? (
          contract.lessee_signature ? (
            <span className="tenant-chip is-green" title={`สัญญาเลขที่: ${contract.contract_number} (ลงนามครบ 2 ฝ่าย)`}>
              <ShieldCheck size={12} aria-hidden /> E-Sign: {contract.contract_number}
            </span>
          ) : (
            <span className="tenant-chip is-amber" title={`สัญญาเลขที่: ${contract.contract_number} (ส่งร่างแล้ว รอผู้เช่าเซ็น)`}>
              <Clock size={12} aria-hidden /> รอเซ็น: {contract.contract_number}
            </span>
          )
        ) : (
          <span className="tenant-chip"><PenTool size={11} aria-hidden /> ยังไม่เซ็นสัญญา</span>
        )}
      </div>

      {riskLevel !== 'none' && (
        <div className="tenant-card-risk">
          <AlertTriangle size={14} aria-hidden />
          {moveOutDays !== null && moveOutDays >= 0 ? `ย้ายออกใน ${moveOutDays} วัน` : `สัญญาหมดใน ${contractDays} วัน`}
        </div>
      )}

      <div className="tenant-card-actions">
        {/* Invite: owner-issued code that binds the tenant's LINE to exactly this room */}
        <button type="button" className="tenant-card-btn is-line" onClick={e => { e.stopPropagation(); onInvite(room, profile?.full_name); }}
          title={`สร้างรหัสเชิญให้${terms.tenantLabel}ลงทะเบียน${terms.unitName}นี้`}>
          <MessageCircle size={15} aria-hidden /> เชิญเข้า LINE
        </button>
        <button type="button" className={`tenant-card-btn${copied ? ' is-done' : ''}`} onClick={copyTenantLink} title={`คัดลอกลิงก์หน้า${terms.tenantLabel}`}>
          {copied ? <CheckCheck size={15} aria-hidden /> : <Link2 size={15} aria-hidden />} {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
        </button>
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
  const [qrSheetOpen, setQrSheetOpen] = useState(false);
  const canInvite = permissions === null || permissions.includes('invitation.create');

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
      <div className="page-header tenants-head">
        <div className="tenants-head-text">
          <h1 className="page-title tenants-title">
            {terms.isMarket ? <Store size={28} color="#E8740C" aria-hidden /> : <Users size={28} aria-hidden />} ข้อมูล{terms.tenantPlural}
          </h1>
          <p className="page-subtitle">
            จัดการและดูข้อมูล{terms.tenantLabel}ทั้งหมด {activeRooms.length} {terms.unitName}
          </p>
        </div>
        {canInvite && (
          <button className="btn btn-outline" onClick={() => setQrSheetOpen(true)}>
            <QrCode size={16} aria-hidden /> QR ลงทะเบียน LINE ราย{terms.unitName}
          </button>
        )}
      </div>

      {/* ── Room Status Dashboard ── */}
      <RoomStatusDashboard rooms={rooms} occupancy={occupancy} onOpenRoom={r => setSelectedRoomId(r.id)} buildingType={buildingType} />

      {/* Search + Filter Bar */}
      <div className="card mb-6 tenants-toolbar">
        <div className="tenants-search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            placeholder={`ค้นหาชื่อ, เบอร์โทร หรือ${terms.unitNumberLabel}...`}
            aria-label={`ค้นหา${terms.tenantLabel}`}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="ล้างคำค้น"><X size={16} aria-hidden /></button>
          )}
        </div>

        {/* One row that scrolls sideways on a phone, instead of wrapping into uneven rows */}
        <div className="tenants-filters" role="tablist" aria-label="กรองรายการ">
          {([
            { id: 'all',         label: 'ทั้งหมด',       icon: <Users size={14} aria-hidden /> },
            { id: 'has_profile', label: 'มีข้อมูล',      icon: <UserCheck size={14} aria-hidden /> },
            { id: 'signed',      label: 'สัญญา E-Sign',  icon: <PenTool size={14} aria-hidden /> },
            { id: 'no_profile',  label: 'ไม่มีข้อมูล',     icon: <UserX size={14} aria-hidden /> },
            { id: 'risk',        label: 'เสี่ยงย้ายออก',   icon: <AlertTriangle size={14} aria-hidden /> },
          ] as { id: FilterMode; label: string; icon: React.ReactNode }[]).map(f => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`tenants-filter${filter === f.id ? ' is-on' : ''}${f.id === 'risk' ? ' is-risk' : f.id === 'signed' ? ' is-signed' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.icon} {f.label}
            </button>
          ))}
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
          buildingType={buildingType ?? config?.building_type}
          onClose={() => setInviteTarget(null)}
        />
      )}

      {qrSheetOpen && (
        <QrSheetModal
          ownerUid={uid}
          buildingId={buildingId}
          rooms={rooms}
          unitName={terms.unitName}
          dormName={config?.bill_customization?.dorm_name}
          canDecide={permissions === null || permissions.includes('tenant.update')}
          onClose={() => setQrSheetOpen(false)}
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
    <div className="tenant-grid">
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
