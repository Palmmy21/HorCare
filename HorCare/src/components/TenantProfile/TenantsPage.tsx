import { useState } from 'react';
import {
  Users, User, Phone, AlertTriangle, Search,
  LogIn, Banknote, ChevronRight, Home, MessageCircle,
  UserCheck, UserX, Link2, CheckCheck,
} from 'lucide-react';
import type { Room } from '../../types';
import { useTenantProfile } from '../../hooks/useTenantProfiles';
import TenantProfilePage from '../TenantProfile/TenantProfilePage';

interface TenantsPageProps {
  rooms: Room[];
  uid: string;
  buildingId: string;
  isPaid: boolean;
  onUpgrade?: () => void;
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

// ── Single room card (fetches its own profile) ───────────────────────────────
function TenantCard({
  room, uid, buildingId, onOpenProfile, filter, search,
}: {
  room: Room;
  uid: string;
  buildingId: string;
  isPaid?: boolean;
  onUpgrade?: () => void;
  onOpenProfile: (room: Room) => void;
  filter: FilterMode;
  search: string;
}) {
  const { profile, loading } = useTenantProfile(uid, buildingId, room.id);
  const [copied, setCopied] = useState(false);

  const copyTenantLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}${window.location.pathname}?uid=${uid}&bid=${buildingId}&rid=${room.id}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
    if (filter === 'risk'        && riskLevel === 'none') return null;
    if (search) {
      const q = search.toLowerCase();
      const hit = room.room_number.toLowerCase().includes(q)
        || (profile?.full_name ?? '').toLowerCase().includes(q)
        || (profile?.phone ?? '').includes(q);
      if (!hit) return null;
    }
  }

  return (
    <div
      onClick={() => onOpenProfile(room)}
      style={{
        border: `1px solid ${
          riskLevel === 'high' ? 'rgba(220,38,38,0.35)' :
          riskLevel === 'medium' ? 'rgba(245,158,11,0.35)' :
          'var(--color-border, #E5E7EB)'
        }`,
        borderRadius: '14px',
        padding: '1rem 1.125rem',
        cursor: 'pointer',
        background: riskLevel === 'high'
          ? 'rgba(220,38,38,0.04)'
          : riskLevel === 'medium'
          ? 'rgba(245,158,11,0.04)'
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
          ? 'linear-gradient(135deg, #8B5CF6, #EC4899)'
          : 'var(--color-gray-100, #F3F4F6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.125rem', fontWeight: 800,
        color: hasProfile ? '#fff' : 'var(--color-gray-400, #9CA3AF)',
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
            color: 'var(--color-text, #111827)',
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
          display: 'flex', alignItems: 'center', gap: '0.875rem',
          fontSize: '0.775rem', color: 'var(--color-text-muted, #6B7280)',
          flexWrap: 'wrap',
        }}>
          {/* Room badge */}
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}>
            <Home size={12} /> {room.room_number}
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
                profile.deposit_status === 'returned' ? 'rgba(5,150,105,0.1)' :
                profile.deposit_status === 'deducted' ? 'rgba(220,38,38,0.1)' :
                'rgba(245,158,11,0.1)',
              color:
                profile.deposit_status === 'returned' ? '#059669' :
                profile.deposit_status === 'deducted' ? '#DC2626' :
                '#D97706',
            }}>
              <Banknote size={11} />
              {profile.deposit_status === 'held' ? 'มัดจำ: ถือไว้' :
               profile.deposit_status === 'returned' ? 'คืนมัดจำแล้ว' : 'หักมัดจำ'}
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
            background: riskLevel === 'high' ? 'rgba(220,38,38,0.15)' : 'rgba(245,158,11,0.15)',
            color: riskLevel === 'high' ? '#F87171' : '#FCD34D',
            border: `1px solid ${riskLevel === 'high' ? 'rgba(220,38,38,0.3)' : 'rgba(245,158,11,0.3)'}`,
          }}>
            ⚠️ {moveOutDays !== null && moveOutDays >= 0
              ? `ย้ายออกใน ${moveOutDays} วัน`
              : `สัญญาหมดใน ${contractDays} วัน`}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          {/* Copy tenant portal link */}
          <button
            onClick={copyTenantLink}
            title="คัดลอกลิงก์หน้าผู้เช่า"
            style={{
              background: copied ? 'rgba(5,150,105,0.1)' : 'rgba(139,92,246,0.08)',
              border: `1px solid ${copied ? 'rgba(5,150,105,0.25)' : 'rgba(139,92,246,0.2)'}`,
              borderRadius: '8px', padding: '0.3rem 0.5rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
              color: copied ? '#059669' : '#8B5CF6',
              fontSize: '0.7rem', fontWeight: 700,
              transition: 'all 0.2s',
            }}
          >
            {copied ? <CheckCheck size={13} /> : <Link2 size={13} />}
            <span className="tenant-link-label">{copied ? 'คัดลอกแล้ว' : 'ลิงก์'}</span>
          </button>
          <ChevronRight size={16} color="var(--color-gray-300, #D1D5DB)" />
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
type FilterMode = 'all' | 'has_profile' | 'no_profile' | 'risk';

export default function TenantsPage({
  rooms, uid, buildingId, isPaid, onUpgrade,
}: TenantsPageProps) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);

  const activeRooms = rooms.filter(r => r.is_active);

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={28} /> ข้อมูลผู้เช่า
        </h1>
        <p className="page-subtitle">
          จัดการและดูข้อมูลผู้เช่าทั้งหมด {activeRooms.length} ห้อง
        </p>
      </div>

      {/* Search + Filter Bar */}
      <div className="card mb-6" style={{ padding: '0.75rem 0.875rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'var(--color-gray-50, #F9FAFB)',
          border: '1px solid var(--color-border, #E5E7EB)',
          borderRadius: '10px', padding: '0.5rem 0.75rem',
        }}>
          <Search size={15} color="var(--color-text-muted, #9CA3AF)" />
          <input
            type="text"
            placeholder="ค้นหาชื่อ, เบอร์โทร หรือเลขห้อง..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              border: 'none', background: 'none', outline: 'none',
              flex: 1, fontSize: '0.875rem',
              color: 'var(--color-text, #111827)',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--color-text-muted, #9CA3AF)', display: 'flex' }}>
              <UserX size={15} />
            </button>
          )}
        </div>

        {/* Filter tabs — segmented control */}
        <div style={{
          display: 'flex', background: 'var(--color-gray-100, #F3F4F6)',
          borderRadius: '10px', padding: '3px', gap: '2px',
        }}>
          {([
            { id: 'all',         label: 'ทั้งหมด',   icon: <Users size={13} /> },
            { id: 'has_profile', label: 'มีข้อมูล',  icon: <UserCheck size={13} /> },
            { id: 'no_profile',  label: 'ไม่มีข้อมูล', icon: <UserX size={13} /> },
            { id: 'risk',        label: 'เสี่ยงย้ายออก', icon: <AlertTriangle size={13} /> },
          ] as { id: FilterMode; label: string; icon: React.ReactNode }[]).map(f => {
            const active = filter === f.id;
            const isRisk = f.id === 'risk';
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
                    ? (isRisk ? 'rgba(220,38,38,0.12)' : '#fff')
                    : 'transparent',
                  color: active
                    ? (isRisk ? '#DC2626' : 'var(--color-primary, #8B5CF6)')
                    : 'var(--color-text-muted, #6B7280)',
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
        onOpenProfile={setSelectedRoom}
      />

      {/* Profile Modal */}
      {selectedRoom && (
        <TenantProfilePage
          room={selectedRoom}
          uid={uid}
          buildingId={buildingId}
          isPaid={isPaid}
          onUpgrade={onUpgrade}
          onClose={() => setSelectedRoom(null)}
        />
      )}
    </div>
  );
}

// ── Tenant Grid (separated to avoid hook-in-loop issues) ────────────────────
function TenantGrid({
  rooms, uid, buildingId, isPaid, onUpgrade, search, filter, onOpenProfile,
}: {
  rooms: Room[];
  uid: string;
  buildingId: string;
  isPaid: boolean;
  onUpgrade?: () => void;
  search: string;
  filter: FilterMode;
  onOpenProfile: (room: Room) => void;
}) {
  // NOTE: We render TenantCard per room — each card fetches its own profile.
  // Filtering by search/profile happens inside each card but since we need
  // to filter at grid level, we do a two-pass: render all, but hide via CSS.
  // For correctness we render all and let TenantCard manage its own data.

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))',
      gap: '0.75rem',
    }}>
      {rooms.length === 0 ? (
        <div className="empty-state" style={{ gridColumn: '1/-1' }}>
          <Users size={48} />
          <h3>ยังไม่มีห้องพัก</h3>
          <p>เพิ่มห้องพักใน "จัดการห้อง" ก่อน</p>
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
            filter={filter}
            search={search}
          />
        ))
      )}
    </div>
  );
}
