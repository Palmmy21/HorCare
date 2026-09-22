import { useState } from 'react';
import {
  Sparkles, Clock, CheckCircle2, XCircle, Trash2,
  Calendar, Phone, UserCheck, Plus, Search,
  KeyRound, ShieldCheck, Eye, EyeOff, Edit2
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useCleaningRequests } from '../../hooks/useCleaningRequests';
import { useHousekeepers } from '../../hooks/useHousekeepers';
import type { CleaningRequest, CleaningServiceType, Housekeeper } from '../../types';

// ── Lazy Photo Component ───────────────────────────────────────────────────────
function CleaningPhoto({ uid, buildingId, req }: { uid: string; buildingId: string; req: CleaningRequest }) {
  const [src, setSrc] = useState<string | null>(req.image_url || req.photo_url || null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (src) { setExpanded(e => !e); return; }
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, `users/${uid}/buildings/${buildingId}/cleaning_images`, req.id));
      if (snap.exists()) setSrc(snap.data().data as string);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setExpanded(true);
    }
  };

  if (!req.has_photo && !req.image_url && !req.photo_url) return null;

  return (
    <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
      <button
        onClick={load}
        type="button"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)',
          background: 'var(--color-primary-50, #EFF6FF)', border: '1px solid var(--color-primary-200, #BFDBFE)',
          padding: '0.25rem 0.625rem', borderRadius: '6px', cursor: 'pointer',
        }}
      >
        {loading ? 'กำลังโหลด...' : (src ? (expanded ? 'ซ่อนรูปถ่าย' : 'ดูรูปถ่าย') : 'ดูรูปประกอบ')}
      </button>
      {expanded && src && (
        <img
          src={src}
          alt="รูปงานทำความสะอาด"
          style={{ display: 'block', marginTop: '0.5rem', width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, border: '1px solid #E2E8F0' }}
        />
      )}
    </div>
  );
}

// ── Constants & Helpers ────────────────────────────────────────────────────────
export const CLEANING_SERVICE_CONFIG: Record<string, { label: string; desc: string; color: string; bg: string }> = {
  general:           { label: 'ทำความสะอาดทั่วไป', desc: 'กวาด ถู ปัดฝุ่น เช็ดกระจก', color: '#0284C7', bg: '#E0F2FE' },
  general_cleaning:  { label: 'ทำความสะอาดทั่วไป', desc: 'กวาด ถู ปัดฝุ่น เช็ดกระจก', color: '#0284C7', bg: '#E0F2FE' },
  deep:              { label: 'บิ๊กคลีนนิ่ง (Big Clean)', desc: 'ทำความสะอาดละเอียดทั้งห้อง', color: '#7C3AED', bg: '#F5F3FF' },
  deep_cleaning:     { label: 'บิ๊กคลีนนิ่ง (Big Clean)', desc: 'ทำความสะอาดละเอียดทั้งห้อง', color: '#7C3AED', bg: '#F5F3FF' },
  bathroom:          { label: 'ขัดล้างห้องน้ำ', desc: 'ล้างพื้น สุขภัณฑ์ กระจก ผนังห้องน้ำ', color: '#0D9488', bg: '#CCFBF1' },
  bathroom_cleaning: { label: 'ขัดล้างห้องน้ำ', desc: 'ล้างพื้น สุขภัณฑ์ กระจก ผนังห้องน้ำ', color: '#0D9488', bg: '#CCFBF1' },
  balcony:           { label: 'ล้างระเบียง / ซักล้าง', desc: 'ขัดพื้นระเบียง ราวระเบียง', color: '#D97706', bg: '#FEF3C7' },
  checkout:          { label: 'เคลียร์ห้องก่อนย้ายออก', desc: 'ทำความสะอาดเตรียมส่งมอบห้อง', color: '#E11D48', bg: '#FFE4E6' },
  move_out_cleaning: { label: 'เคลียร์ห้องก่อนย้ายออก', desc: 'ทำความสะอาดเตรียมส่งมอบห้อง', color: '#E11D48', bg: '#FFE4E6' },
  bed_linen:         { label: 'เปลี่ยนผ้าปู / ซักรีด', desc: 'เปลี่ยนชุดเครื่องนอน', color: '#6366F1', bg: '#EEF2FF' },
  other:             { label: 'อื่นๆ', desc: 'บริการอื่นๆ', color: '#64748B', bg: '#F1F5F9' },
};

export const CLEANING_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  open:        { label: 'รอดำเนินการ',      color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  pending:     { label: 'รอดำเนินการ',      color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  assigned:    { label: 'มอบหมายแล้ว',      color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE' },
  in_progress: { label: 'กำลังดำเนินการ',  color: '#D97706', bg: '#FFFBEB', border: '#FDE68A' },
  done:        { label: 'เสร็จสิ้น',       color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' },
  completed:   { label: 'เสร็จสิ้น',       color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' },
  cancelled:   { label: 'ยกเลิก',          color: '#64748B', bg: '#F8FAFC', border: '#E2E8F0' },
};

function fmtRelative(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'เมื่อกี้';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ชม. ที่แล้ว`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

interface Props {
  uid: string;
  buildingId: string;
}

export default function CleaningPage({ uid, buildingId }: Props) {
  const {
    requests,
    loading: requestsLoading,
    addRequest,
    assignMaid,
    completeRequest,
    updateStatus,
    deleteRequest,
  } = useCleaningRequests(uid, buildingId);

  const {
    housekeepers,
    loading: maidsLoading,
    addHousekeeper,
    updateHousekeeper,
    deleteHousekeeper,
  } = useHousekeepers(uid, buildingId);

  const [activeTab, setActiveTab] = useState<'requests' | 'housekeepers'>('requests');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  // Modals state
  const [showAddReqModal, setShowAddReqModal] = useState(false);
  const [showMaidModal, setShowMaidModal] = useState(false);
  const [editingMaid, setEditingMaid] = useState<Housekeeper | null>(null);
  const [assigningReq, setAssigningReq] = useState<CleaningRequest | null>(null);
  const [selectedMaidId, setSelectedMaidId] = useState('');
  const [completingReq, setCompletingReq] = useState<CleaningRequest | null>(null);
  const [completeNote, setCompleteNote] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showPasscodes, setShowPasscodes] = useState<Record<string, boolean>>({});

  // Manual Add Request Form
  const [reqRoom, setReqRoom] = useState('');
  const [reqServiceType, setReqServiceType] = useState<CleaningServiceType>('general');
  const [reqDate, setReqDate] = useState('');
  const [reqTimeSlot, setReqTimeSlot] = useState('เช้า (09:00 - 12:00)');
  const [reqDesc, setReqDesc] = useState('');
  const [reqMaidId, setReqMaidId] = useState('');

  // Maid Form
  const [maidName, setMaidName] = useState('');
  const [maidPhone, setMaidPhone] = useState('');
  const [maidPasscode, setMaidPasscode] = useState('');
  const [maidIsActive, setMaidIsActive] = useState(true);

  // Filter requests
  const filteredRequests = requests.filter(r => {
    if (filterStatus !== 'all') {
      if (filterStatus === 'pending' && r.status !== 'pending' && r.status !== 'open') return false;
      if (filterStatus === 'completed' && r.status !== 'completed' && r.status !== 'done') return false;
      if (filterStatus !== 'pending' && filterStatus !== 'completed' && r.status !== filterStatus) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchRoom = r.room_number?.toLowerCase().includes(q);
      const matchDesc = r.description?.toLowerCase().includes(q);
      const matchMaid = r.assigned_maid_name?.toLowerCase().includes(q);
      const matchTenant = r.tenant_name?.toLowerCase().includes(q);
      return matchRoom || matchDesc || matchMaid || matchTenant;
    }
    return true;
  });

  const counts = {
    all: requests.length,
    pending: requests.filter(r => r.status === 'pending' || r.status === 'open').length,
    in_progress: requests.filter(r => r.status === 'in_progress' || r.status === 'assigned').length,
    completed: requests.filter(r => r.status === 'completed' || r.status === 'done').length,
    cancelled: requests.filter(r => r.status === 'cancelled').length,
  };

  // Handlers
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reqRoom.trim()) return;
    setSavingId('create_req');
    try {
      const assignedMaid = housekeepers.find(m => m.id === reqMaidId);
      await addRequest({
        room_number: reqRoom.trim(),
        service_type: reqServiceType,
        preferred_date: reqDate || undefined,
        preferred_time_slot: reqTimeSlot,
        description: reqDesc.trim(),
        assigned_maid_id: assignedMaid?.id,
        assigned_maid_name: assignedMaid?.name,
        assigned_maid_phone: assignedMaid?.phone,
      });
      setShowAddReqModal(false);
      setReqRoom('');
      setReqDesc('');
      setReqDate('');
      setReqMaidId('');
    } finally {
      setSavingId(null);
    }
  };

  const handleOpenAssign = (req: CleaningRequest) => {
    setAssigningReq(req);
    setSelectedMaidId(req.assigned_maid_id || '');
  };

  const handleConfirmAssign = async () => {
    if (!assigningReq) return;
    setSavingId(assigningReq.id);
    try {
      const maid = housekeepers.find(m => m.id === selectedMaidId);
      if (maid) {
        await assignMaid(assigningReq.id, maid.id, maid.name, maid.phone);
      } else {
        await updateStatus(assigningReq.id, assigningReq.status);
      }
      setAssigningReq(null);
    } finally {
      setSavingId(null);
    }
  };

  const handleConfirmComplete = async () => {
    if (!completingReq) return;
    setSavingId(completingReq.id);
    try {
      await completeRequest(completingReq.id, completeNote);
      setCompletingReq(null);
      setCompleteNote('');
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveMaid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!maidName.trim() || !maidPhone.trim() || !maidPasscode.trim()) return;
    setSavingId('maid_save');
    try {
      if (editingMaid) {
        await updateHousekeeper(editingMaid.id, {
          name: maidName.trim(),
          phone: maidPhone.trim(),
          passcode: maidPasscode.trim(),
          is_active: maidIsActive,
        });
      } else {
        await addHousekeeper({
          name: maidName.trim(),
          phone: maidPhone.trim(),
          passcode: maidPasscode.trim(),
          is_active: maidIsActive,
        });
      }
      setShowMaidModal(false);
      setEditingMaid(null);
      setMaidName('');
      setMaidPhone('');
      setMaidPasscode('');
      setMaidIsActive(true);
    } finally {
      setSavingId(null);
    }
  };

  const openEditMaid = (m: Housekeeper) => {
    setEditingMaid(m);
    setMaidName(m.name);
    setMaidPhone(m.phone);
    setMaidPasscode(m.passcode);
    setMaidIsActive(m.is_active !== false);
    setShowMaidModal(true);
  };

  return (
    <div style={{ padding: '1.25rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* ── Top Header ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #0284C7, #0369A1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 4px 12px rgba(2, 132, 199, 0.25)' }}>
              <Sparkles size={22} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0, color: 'var(--color-text)' }}>งานแม่บ้าน & ทำความสะอาด</h1>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>ระบบจัดการคำขอทำความสะอาด มอบหมายงาน และบัญชีแม่บ้านประจำหอพัก</p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
          {activeTab === 'requests' ? (
            <button
              onClick={() => setShowAddReqModal(true)}
              type="button"
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem' }}
            >
              <Plus size={16} />
              + สร้างงานทำความสะอาด
            </button>
          ) : (
            <button
              onClick={() => {
                setEditingMaid(null);
                setMaidName('');
                setMaidPhone('');
                setMaidPasscode('');
                setMaidIsActive(true);
                setShowMaidModal(true);
              }}
              type="button"
              className="btn btn-primary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.875rem' }}
            >
              <Plus size={16} />
              + เพิ่มรายชื่อแม่บ้าน
            </button>
          )}
        </div>
      </div>

      {/* ── Main Tab Navigation ──────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '2px solid var(--color-gray-200)', marginBottom: '1.25rem' }}>
        <button
          onClick={() => setActiveTab('requests')}
          style={{
            padding: '0.75rem 1.25rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'requests' ? '2px solid var(--color-primary)' : '2px solid transparent',
            marginBottom: '-2px',
            fontWeight: 600,
            fontSize: '0.925rem',
            color: activeTab === 'requests' ? 'var(--color-primary)' : 'var(--color-gray-500)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <Sparkles size={16} />
          คิวงานทำความสะอาด
          {counts.pending > 0 && (
            <span style={{ background: '#DC2626', color: '#fff', fontSize: '0.725rem', padding: '0.1rem 0.45rem', borderRadius: 999, fontWeight: 700 }}>
              {counts.pending}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('housekeepers')}
          style={{
            padding: '0.75rem 1.25rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'housekeepers' ? '2px solid var(--color-primary)' : '2px solid transparent',
            marginBottom: '-2px',
            fontWeight: 600,
            fontSize: '0.925rem',
            color: activeTab === 'housekeepers' ? 'var(--color-primary)' : 'var(--color-gray-500)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <UserCheck size={16} />
          รายชื่อแม่บ้าน ({housekeepers.length})
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: REQUESTS QUEUE
      ───────────────────────────────────────────────────────────── */}
      {activeTab === 'requests' && (
        <div>
          {/* Filters & Search */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {[
                { id: 'all', label: 'ทั้งหมด', count: counts.all },
                { id: 'pending', label: 'รอดำเนินการ', count: counts.pending },
                { id: 'in_progress', label: 'กำลังดำเนินการ', count: counts.in_progress },
                { id: 'completed', label: 'เสร็จสิ้น', count: counts.completed },
                { id: 'cancelled', label: 'ยกเลิก', count: counts.cancelled },
              ].map(st => {
                const isSel = filterStatus === st.id;
                return (
                  <button
                    key={st.id}
                    onClick={() => setFilterStatus(st.id)}
                    style={{
                      padding: '0.35rem 0.75rem',
                      borderRadius: 20,
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: isSel ? '1px solid var(--color-primary)' : '1px solid var(--color-gray-300)',
                      background: isSel ? 'var(--color-primary)' : '#fff',
                      color: isSel ? '#fff' : 'var(--color-gray-700)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                    }}
                  >
                    <span>{st.label}</span>
                    <span style={{ fontSize: '0.725rem', opacity: isSel ? 0.9 : 0.6 }}>({st.count})</span>
                  </button>
                );
              })}
            </div>

            <div style={{ position: 'relative', minWidth: 220 }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-gray-400)' }} />
              <input
                type="text"
                placeholder="ค้นหาห้อง, รายละเอียด, แม่บ้าน..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.75rem 0.4rem 2rem',
                  fontSize: '0.825rem',
                  borderRadius: 8,
                  border: '1px solid var(--color-gray-300)',
                }}
              />
            </div>
          </div>

          {/* Cards List */}
          {requestsLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-gray-500)' }}>
              กำลังโหลดข้อมูล...
            </div>
          ) : filteredRequests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3.5rem 1rem', background: '#fff', borderRadius: 12, border: '1px dashed var(--color-gray-300)' }}>
              <Sparkles size={36} style={{ color: 'var(--color-gray-400)', marginBottom: '0.75rem' }} />
              <div style={{ fontWeight: 600, color: 'var(--color-gray-700)' }}>ยังไม่มีรายการงานทำความสะอาด</div>
              <div style={{ fontSize: '0.825rem', color: 'var(--color-gray-500)', marginTop: '0.25rem' }}>
                เมื่อผู้เช่าส่งคำขอผ่านพอร์ทัล หรือเจ้าของหอกดเพิ่มงาน รายการจะแสดงที่นี่
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1rem' }}>
              {filteredRequests.map(req => {
                const sType = CLEANING_SERVICE_CONFIG[req.service_type] || CLEANING_SERVICE_CONFIG.general;
                const statusCfg = CLEANING_STATUS_CONFIG[req.status] || CLEANING_STATUS_CONFIG.pending;
                const isSaving = savingId === req.id;

                return (
                  <div
                    key={req.id}
                    style={{
                      background: '#fff',
                      borderRadius: 12,
                      border: '1px solid var(--color-gray-200)',
                      padding: '1rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      position: 'relative',
                    }}
                  >
                    <div>
                      {/* Card Header: Room & Status */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.625rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                            ห้อง {req.room_number}
                          </span>
                          {req.tenant_name && (
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>
                              ({req.tenant_name})
                            </span>
                          )}
                        </div>

                        <span
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            padding: '0.2rem 0.6rem',
                            borderRadius: 20,
                            color: statusCfg.color,
                            background: statusCfg.bg,
                            border: `1px solid ${statusCfg.border}`,
                          }}
                        >
                          {statusCfg.label}
                        </span>
                      </div>

                      {/* Service Type Badge */}
                      <div style={{ marginBottom: '0.625rem' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            padding: '0.25rem 0.6rem',
                            borderRadius: 6,
                            color: sType.color,
                            background: sType.bg,
                          }}
                        >
                          <Sparkles size={12} />
                          {sType.label}
                        </span>
                      </div>

                      {/* Details & Dates */}
                      <div style={{ fontSize: '0.825rem', color: 'var(--color-gray-600)', marginBottom: '0.625rem', lineHeight: 1.4 }}>
                        {req.description ? req.description : <span style={{ color: 'var(--color-gray-400)' }}>ไม่มีบันทึกเพิ่มเติม</span>}
                      </div>

                      {/* Preferred Time / Slot */}
                      {(req.preferred_date || req.preferred_time_slot) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--color-gray-500)', marginBottom: '0.5rem' }}>
                          <Calendar size={13} />
                          <span>
                            {req.preferred_date ? new Date(req.preferred_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : 'ไม่ระบุวัน'}{' '}
                            {req.preferred_time_slot ? `(${req.preferred_time_slot})` : ''}
                          </span>
                        </div>
                      )}

                      {/* Photo if present */}
                      <CleaningPhoto uid={uid} buildingId={buildingId} req={req} />

                      {/* Assigned Maid */}
                      <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.625rem', borderRadius: 8, background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                          <UserCheck size={15} style={{ color: req.assigned_maid_name ? '#0284C7' : 'var(--color-gray-400)' }} />
                          {req.assigned_maid_name ? (
                            <div>
                              <span style={{ fontWeight: 600, color: '#0F172A' }}>{req.assigned_maid_name}</span>
                              {req.assigned_maid_phone && (
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', marginLeft: '0.4rem' }}>
                                  ({req.assigned_maid_phone})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--color-gray-400)' }}>ยังไม่ได้มอบหมายแม่บ้าน</span>
                          )}
                        </div>

                        <button
                          onClick={() => handleOpenAssign(req)}
                          type="button"
                          style={{
                            border: 'none',
                            background: 'none',
                            color: 'var(--color-primary)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                          }}
                        >
                          {req.assigned_maid_name ? 'เปลี่ยน' : 'มอบหมาย'}
                        </button>
                      </div>

                      {/* Completed note if any */}
                      {(req.completed_note || req.completion_notes) && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#16A34A', background: '#F0FDF4', padding: '0.4rem 0.6rem', borderRadius: 6 }}>
                          <strong>บันทึกปิดงาน:</strong> {req.completed_note || req.completion_notes}
                        </div>
                      )}
                    </div>

                    {/* Card Footer: Timestamps & Action Buttons */}
                    <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-gray-100)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.625rem', fontSize: '0.725rem', color: 'var(--color-gray-400)' }}>
                        <span>แจ้งเมื่อ {fmtRelative(req.created_at)}</span>
                        {req.completed_at && <span>เสร็จเมื่อ {fmtRelative(req.completed_at)}</span>}
                      </div>

                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end', alignItems: 'center' }}>
                        {(req.status === 'pending' || req.status === 'open') && (
                          <button
                            onClick={() => updateStatus(req.id, 'in_progress')}
                            disabled={isSaving}
                            type="button"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                              padding: '0.3rem 0.65rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600,
                              background: '#FEF3C7', color: '#B45309', border: '1px solid #FDE68A', cursor: 'pointer',
                            }}
                          >
                            <Clock size={13} />
                            เริ่มดำเนินการ
                          </button>
                        )}

                        {req.status !== 'completed' && req.status !== 'done' && req.status !== 'cancelled' && (
                          <button
                            onClick={() => {
                              setCompletingReq(req);
                              setCompleteNote('');
                            }}
                            disabled={isSaving}
                            type="button"
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                              padding: '0.3rem 0.65rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600,
                              background: '#DCFCE7', color: '#15803D', border: '1px solid #BBF7D0', cursor: 'pointer',
                            }}
                          >
                            <CheckCircle2 size={13} />
                            ปิดงานเสร็จสิ้น
                          </button>
                        )}

                        {req.status !== 'cancelled' && req.status !== 'completed' && req.status !== 'done' && (
                          <button
                            onClick={() => updateStatus(req.id, 'cancelled')}
                            disabled={isSaving}
                            type="button"
                            title="ยกเลิกคำขอ"
                            style={{
                              padding: '0.3rem 0.5rem', borderRadius: 6, fontSize: '0.75rem',
                              background: '#F1F5F9', color: '#64748B', border: '1px solid #E2E8F0', cursor: 'pointer',
                            }}
                          >
                            <XCircle size={13} />
                          </button>
                        )}

                        {confirmDeleteId === req.id ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <button
                              onClick={() => deleteRequest(req.id)}
                              type="button"
                              style={{ padding: '0.25rem 0.5rem', background: '#DC2626', color: '#fff', border: 'none', borderRadius: 4, fontSize: '0.725rem', cursor: 'pointer' }}
                            >
                              ยืนยันลบ
                            </button>
                            <button
                              onClick={() => setConfirmDeleteId(null)}
                              type="button"
                              style={{ padding: '0.25rem 0.4rem', background: '#E2E8F0', color: '#475569', border: 'none', borderRadius: 4, fontSize: '0.725rem', cursor: 'pointer' }}
                            >
                              ยกเลิก
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(req.id)}
                            type="button"
                            title="ลบรายการนี้"
                            style={{
                              padding: '0.3rem 0.5rem', borderRadius: 6, fontSize: '0.75rem',
                              background: 'none', color: '#EF4444', border: 'none', cursor: 'pointer',
                            }}
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: HOUSEKEEPERS DIRECTORY
      ───────────────────────────────────────────────────────────── */}
      {activeTab === 'housekeepers' && (
        <div>
          <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 10, padding: '0.875rem 1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
            <KeyRound size={20} style={{ color: '#0284C7', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: '0.85rem', color: '#1E40AF', lineHeight: 1.4 }}>
              <strong>ระบบเข้าสู่ระบบของแม่บ้าน (Housekeeper Login):</strong>
              <div style={{ marginTop: '0.25rem', color: '#1E3A8A' }}>
                เจ้าของหอสามารถบันทึกแม่บ้าน พร้อมตั้งเบอร์โทรศัพท์และรหัสผ่าน (Passcode) แล้วส่งมอบให้แม่บ้านใช้ Login ได้ที่หน้าแรก โดยแม่บ้านจะเห็นเฉพาะ <strong>งานแม่บ้าน</strong> และ <strong>จดมิเตอร์น้ำไฟ</strong> เท่านั้น
              </div>
            </div>
          </div>

          {maidsLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--color-gray-500)' }}>
              กำลังโหลดรายชื่อแม่บ้าน...
            </div>
          ) : housekeepers.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3.5rem 1rem', background: '#fff', borderRadius: 12, border: '1px dashed var(--color-gray-300)' }}>
              <UserCheck size={36} style={{ color: 'var(--color-gray-400)', marginBottom: '0.75rem' }} />
              <div style={{ fontWeight: 600, color: 'var(--color-gray-700)' }}>ยังไม่มีรายชื่อแม่บ้านในระบบ</div>
              <div style={{ fontSize: '0.825rem', color: 'var(--color-gray-500)', marginTop: '0.25rem' }}>
                กดปุ่ม "+ เพิ่มรายชื่อแม่บ้าน" เพื่อกำหนดเบอร์โทรและรหัสผ่านสำหรับเข้าใช้งาน
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
              {housekeepers.map(m => {
                const showPin = !!showPasscodes[m.id];
                return (
                  <div
                    key={m.id}
                    style={{
                      background: '#fff',
                      borderRadius: 12,
                      border: '1px solid var(--color-gray-200)',
                      padding: '1.25rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#F0F9FF', border: '1px solid #BAE6FD', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0284C7', fontWeight: 700 }}>
                            {m.name.slice(0, 1)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0F172A' }}>{m.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <Phone size={11} /> {m.phone}
                            </div>
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: '0.725rem',
                            fontWeight: 700,
                            padding: '0.15rem 0.55rem',
                            borderRadius: 12,
                            background: m.is_active !== false ? '#DCFCE7' : '#F1F5F9',
                            color: m.is_active !== false ? '#15803D' : '#64748B',
                            border: `1px solid ${m.is_active !== false ? '#BBF7D0' : '#E2E8F0'}`,
                          }}
                        >
                          {m.is_active !== false ? 'พร้อมทำงาน' : 'พักงาน'}
                        </span>
                      </div>

                      {/* Login Credential Box */}
                      <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '0.625rem 0.75rem', marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <ShieldCheck size={13} style={{ color: '#0284C7' }} /> ข้อมูลสำหรับเข้าสู่ระบบแม่บ้าน:
                        </div>
                        <div style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#334155' }}>
                          <span>เบอร์โทร: <strong>{m.phone}</strong></span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span>รหัส: <strong>{showPin ? m.passcode : '••••••'}</strong></span>
                            <button
                              type="button"
                              onClick={() => setShowPasscodes(p => ({ ...p, [m.id]: !showPin }))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray-400)', padding: 0 }}
                            >
                              {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-gray-100)' }}>
                      <button
                        onClick={() => openEditMaid(m)}
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                      >
                        <Edit2 size={13} />
                        แก้ไข
                      </button>

                      <button
                        onClick={() => {
                          if (window.confirm(`ต้องการลบแม่บ้าน "${m.name}" ออกจากระบบหรือไม่?`)) {
                            deleteHousekeeper(m.id, m.phone);
                          }
                        }}
                        type="button"
                        style={{
                          background: 'none', border: '1px solid #FEE2E2', borderRadius: 6,
                          color: '#EF4444', padding: '0.3rem 0.6rem', fontSize: '0.75rem', cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                        }}
                      >
                        <Trash2 size={13} />
                        ลบ
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: ADD CLEANING REQUEST (LANDLORD)
      ───────────────────────────────────────────────────────────── */}
      {showAddReqModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: 14, maxWidth: 480, width: '100%', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--color-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Sparkles size={18} style={{ color: 'var(--color-primary)' }} />
                สร้างงานทำความสะอาดใหม่
              </div>
              <button onClick={() => setShowAddReqModal(false)} type="button" style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--color-gray-400)' }}>✕</button>
            </div>

            <form onSubmit={handleCreateRequest} style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>เลขที่ห้อง *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น 101, A203"
                  value={reqRoom}
                  onChange={e => setReqRoom(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.9rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>ประเภทบริการทำความสะอาด</label>
                <select
                  value={reqServiceType}
                  onChange={e => setReqServiceType(e.target.value as CleaningServiceType)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.9rem' }}
                >
                  {Object.entries(CLEANING_SERVICE_CONFIG).filter(([k]) => ['general', 'deep', 'bathroom', 'balcony', 'checkout'].includes(k)).map(([key, val]) => (
                    <option key={key} value={key}>{val.label} - {val.desc}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>วันที่ต้องการ</label>
                  <input
                    type="date"
                    value={reqDate}
                    onChange={e => setReqDate(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.875rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>ช่วงเวลา</label>
                  <select
                    value={reqTimeSlot}
                    onChange={e => setReqTimeSlot(e.target.value)}
                    style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.875rem' }}
                  >
                    <option value="เช้า (09:00 - 12:00)">เช้า (09:00 - 12:00)</option>
                    <option value="บ่าย (13:00 - 16:00)">บ่าย (13:00 - 16:00)</option>
                    <option value="เย็น (16:00 - 18:00)">เย็น (16:00 - 18:00)</option>
                    <option value="ตลอดทั้งวัน">ตลอดทั้งวัน</option>
                  </select>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>มอบหมายแม่บ้านทันที (ถ้ามี)</label>
                <select
                  value={reqMaidId}
                  onChange={e => setReqMaidId(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.9rem' }}
                >
                  <option value="">-- ยังไม่ระบุ --</option>
                  {housekeepers.filter(m => m.is_active !== false).map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.phone})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>รายละเอียด / โน้ตเพิ่มเติม</label>
                <textarea
                  rows={3}
                  placeholder="เช่น ทำความสะอาดห้องน้ำเป็นพิเศษ, มีแมวอยู่ในห้อง..."
                  value={reqDesc}
                  onChange={e => setReqDesc(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.875rem', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowAddReqModal(false)}
                  className="btn btn-secondary"
                  style={{ padding: '0.5rem 1rem' }}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingId === 'create_req'}
                  className="btn btn-primary"
                  style={{ padding: '0.5rem 1.25rem' }}
                >
                  {savingId === 'create_req' ? 'กำลังบันทึก...' : 'สร้างงาน'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: ADD / EDIT HOUSEKEEPER
      ───────────────────────────────────────────────────────────── */}
      {showMaidModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: 14, maxWidth: 440, width: '100%', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--color-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <UserCheck size={18} style={{ color: 'var(--color-primary)' }} />
                {editingMaid ? 'แก้ไขข้อมูลแม่บ้าน' : 'เพิ่มรายชื่อแม่บ้าน'}
              </div>
              <button onClick={() => setShowMaidModal(false)} type="button" style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--color-gray-400)' }}>✕</button>
            </div>

            <form onSubmit={handleSaveMaid} style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>ชื่อ-นามสกุล หรือ ชื่อเรียกแม่บ้าน *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น ป้าสมศรี, พี่วรรณ"
                  value={maidName}
                  onChange={e => setMaidName(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.9rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>เบอร์โทรศัพท์ (ใช้สำหรับเข้าสู่ระบบ) *</label>
                <input
                  type="tel"
                  required
                  placeholder="เช่น 0812345678"
                  value={maidPhone}
                  onChange={e => setMaidPhone(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.9rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>รหัสผ่าน Login (Passcode / PIN) *</label>
                <input
                  type="text"
                  required
                  placeholder="เช่น 123456 หรือ ตัวเลข 4-6 หลัก"
                  value={maidPasscode}
                  onChange={e => setMaidPasscode(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.9rem' }}
                />
                <div style={{ fontSize: '0.725rem', color: 'var(--color-gray-500)', marginTop: '0.25rem' }}>
                  เจ้าของหอสามารถกำหนดรหัสนี้และส่งให้แม่บ้านใช้ Login ที่หน้าแรก
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                <input
                  type="checkbox"
                  id="maid_status_active"
                  checked={maidIsActive}
                  onChange={e => setMaidIsActive(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="maid_status_active" style={{ fontSize: '0.85rem', cursor: 'pointer', fontWeight: 500 }}>
                  สถานะพร้อมรับงาน (Active)
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowMaidModal(false)}
                  className="btn btn-secondary"
                  style={{ padding: '0.5rem 1rem' }}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={savingId === 'maid_save'}
                  className="btn btn-primary"
                  style={{ padding: '0.5rem 1.25rem' }}
                >
                  {savingId === 'maid_save' ? 'กำลังบันทึก...' : 'บันทึก'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: ASSIGN MAID
      ───────────────────────────────────────────────────────────── */}
      {assigningReq && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: 14, maxWidth: 400, width: '100%', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--color-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-text)' }}>
                มอบหมายงานห้อง {assigningReq.room_number}
              </div>
              <button onClick={() => setAssigningReq(null)} type="button" style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--color-gray-400)' }}>✕</button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>เลือกแม่บ้านผู้รับผิดชอบ</label>
                <select
                  value={selectedMaidId}
                  onChange={e => setSelectedMaidId(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.9rem' }}
                >
                  <option value="">-- ไม่ระบุแม่บ้าน --</option>
                  {housekeepers.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.phone}) {m.is_active !== false ? '' : '[พักงาน]'}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setAssigningReq(null)}
                  className="btn btn-secondary"
                  style={{ padding: '0.5rem 1rem' }}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAssign}
                  disabled={savingId === assigningReq.id}
                  className="btn btn-primary"
                  style={{ padding: '0.5rem 1.25rem' }}
                >
                  {savingId === assigningReq.id ? 'กำลังบันทึก...' : 'ยืนยันมอบหมาย'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: COMPLETE REQUEST
      ───────────────────────────────────────────────────────────── */}
      {completingReq && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: 14, maxWidth: 420, width: '100%', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--color-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#15803D', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={18} />
                ปิดงานทำความสะอาดห้อง {completingReq.room_number}
              </div>
              <button onClick={() => setCompletingReq(null)} type="button" style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: 'var(--color-gray-400)' }}>✕</button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem' }}>บันทึกปิดงาน / ผลการทำความสะอาด (ถ้ามี)</label>
                <textarea
                  rows={3}
                  placeholder="เช่น ทำความสะอาดเรียบร้อย, ล้างห้องน้ำและระเบียงสะอาดพร้อมใช้งาน..."
                  value={completeNote}
                  onChange={e => setCompleteNote(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid var(--color-gray-300)', fontSize: '0.875rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setCompletingReq(null)}
                  className="btn btn-secondary"
                  style={{ padding: '0.5rem 1rem' }}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmComplete}
                  disabled={savingId === completingReq.id}
                  className="btn btn-primary"
                  style={{ padding: '0.5rem 1.25rem', background: '#16A34A', borderColor: '#16A34A' }}
                >
                  {savingId === completingReq.id ? 'กำลังบันทึก...' : 'ยืนยันเสร็จสิ้น'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
