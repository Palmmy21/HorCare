import { useState } from 'react';
import {
  Sparkles, CheckCircle2, Clock, Calendar, Gauge, LogOut,
  ChevronRight
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useCleaningRequests } from '../../hooks/useCleaningRequests';
import type { CleaningRequest, HousekeeperSession } from '../../types';
import { CLEANING_SERVICE_CONFIG, CLEANING_STATUS_CONFIG } from './CleaningPage';

// ── Lazy Photo Component ───────────────────────────────────────────────────────
function MaidPhotoViewer({ uid, buildingId, req }: { uid: string; buildingId: string; req: CleaningRequest }) {
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
          fontSize: '0.75rem', fontWeight: 600, color: '#0284C7',
          background: '#F0F9FF', border: '1px solid #BAE6FD',
          padding: '0.25rem 0.625rem', borderRadius: '6px', cursor: 'pointer',
        }}
      >
        {loading ? 'กำลังโหลด...' : (src ? (expanded ? 'ซ่อนรูป' : 'ดูรูปห้อง') : 'ดูรูปประกอบ')}
      </button>
      {expanded && src && (
        <img
          src={src}
          alt="รูปงานทำความสะอาด"
          style={{ display: 'block', marginTop: '0.5rem', width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 8, border: '1px solid #E2E8F0' }}
        />
      )}
    </div>
  );
}

interface Props {
  session: HousekeeperSession;
  buildingName?: string;
  onGoToRecording: () => void;
  onLogout: () => void;
}

export default function MaidPortalView({ session, buildingName, onGoToRecording, onLogout }: Props) {
  const { requests, loading, acceptRequest, completeRequest } = useCleaningRequests(
    session.owner_uid,
    session.building_id
  );

  const [activeTab, setActiveTab] = useState<'todo' | 'done'>('todo');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [completingReq, setCompletingReq] = useState<CleaningRequest | null>(null);
  const [completeNote, setCompleteNote] = useState('');

  // Tasks relevant to this maid:
  // - Either assigned directly to this maid
  // - Or unassigned pending tasks that any maid can pick up
  const myTasks = requests.filter(r => {
    const isMineOrOpen = !r.assigned_maid_id || r.assigned_maid_id === session.maid_id;
    const isTodo = r.status === 'pending' || r.status === 'open' || r.status === 'in_progress' || r.status === 'assigned';
    const isDone = r.status === 'completed' || r.status === 'done';

    if (activeTab === 'todo') {
      return isMineOrOpen && isTodo;
    } else {
      return (r.assigned_maid_id === session.maid_id || !r.assigned_maid_id) && isDone;
    }
  });

  const pendingCount = requests.filter(r => {
    const isMineOrOpen = !r.assigned_maid_id || r.assigned_maid_id === session.maid_id;
    const isTodo = r.status === 'pending' || r.status === 'open' || r.status === 'in_progress' || r.status === 'assigned';
    return isMineOrOpen && isTodo;
  }).length;

  const handleAccept = async (req: CleaningRequest) => {
    setActionLoadingId(req.id);
    try {
      await acceptRequest(req.id, session.maid_id, session.maid_name || session.name || '', session.phone);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleConfirmComplete = async () => {
    if (!completingReq) return;
    setActionLoadingId(completingReq.id);
    try {
      await completeRequest(completingReq.id, completeNote);
      setCompletingReq(null);
      setCompleteNote('');
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1rem', minHeight: '100vh', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* ── Welcome Header ────────────────────────────────────────── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0284C7, #0369A1)',
          borderRadius: 16,
          padding: '1.25rem 1.5rem',
          color: '#fff',
          boxShadow: '0 8px 24px rgba(2, 132, 199, 0.25)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(255,255,255,0.2)', padding: '0.2rem 0.6rem', borderRadius: 20, fontSize: '0.75rem', fontWeight: 600, marginBottom: '0.5rem' }}>
              <Sparkles size={12} /> ระบบแม่บ้านประจำหอพัก
            </div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, margin: '0 0 0.25rem 0' }}>
              สวัสดีคุณ {session.maid_name || session.name}
            </h1>
            <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
              {buildingName ? `หอพัก: ${buildingName}` : 'ระบบบันทึกงานแม่บ้าน'} • เบอร์โทร: {session.phone}
            </div>
          </div>

          <button
            onClick={onLogout}
            type="button"
            title="ออกจากระบบ"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.35rem',
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff',
              padding: '0.4rem 0.75rem',
              borderRadius: 8,
              fontSize: '0.775rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            <LogOut size={14} /> ออกจากระบบ
          </button>
        </div>
      </div>

      {/* ── Quick Shortcut: Record Meter Water & Electric ────────── */}
      <div
        onClick={onGoToRecording}
        role="button"
        tabIndex={0}
        style={{
          background: '#fff',
          borderRadius: 14,
          border: '1px solid #E2E8F0',
          padding: '1rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #10B981, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <Gauge size={22} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.975rem', color: '#0F172A' }}>
              จดมิเตอร์น้ำ - ไฟ
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748B' }}>
              กดที่นี่เพื่อเปิดหน้าจดเลขมิเตอร์ประจำเดือน
            </div>
          </div>
        </div>
        <ChevronRight size={20} style={{ color: '#94A3B8' }} />
      </div>

      {/* ── Tabs: งานที่ต้องทำ vs ประวัติงานเสร็จสิ้น ──────────────── */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '2px solid #E2E8F0' }}>
        <button
          onClick={() => setActiveTab('todo')}
          style={{
            padding: '0.75rem 1rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'todo' ? '2px solid #0284C7' : '2px solid transparent',
            marginBottom: '-2px',
            fontWeight: 700,
            fontSize: '0.9rem',
            color: activeTab === 'todo' ? '#0284C7' : '#64748B',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <Sparkles size={16} />
          งานทำความสะอาดที่ต้องทำ
          {pendingCount > 0 && (
            <span style={{ background: '#DC2626', color: '#fff', fontSize: '0.725rem', padding: '0.1rem 0.45rem', borderRadius: 999, fontWeight: 700 }}>
              {pendingCount}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('done')}
          style={{
            padding: '0.75rem 1rem',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'done' ? '2px solid #0284C7' : '2px solid transparent',
            marginBottom: '-2px',
            fontWeight: 700,
            fontSize: '0.9rem',
            color: activeTab === 'done' ? '#0284C7' : '#64748B',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <CheckCircle2 size={16} />
          ประวัติงานที่เสร็จสิ้น
        </button>
      </div>

      {/* ── Jobs List ──────────────────────────────────────────────── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#64748B' }}>
          กำลังโหลดรายการงาน...
        </div>
      ) : myTasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3.5rem 1rem', background: '#fff', borderRadius: 14, border: '1px dashed #CBD5E1' }}>
          <Sparkles size={38} style={{ color: '#94A3B8', marginBottom: '0.5rem' }} />
          <div style={{ fontWeight: 700, color: '#334155' }}>
            {activeTab === 'todo' ? 'ไม่มีงานทำความสะอาดที่ค้างอยู่' : 'ยังไม่มีประวัติงานที่เสร็จสิ้น'}
          </div>
          <div style={{ fontSize: '0.825rem', color: '#64748B', marginTop: '0.25rem' }}>
            เมื่อมีผู้เช่าหรือเจ้าของหอแจ้งทำความสะอาด รายการจะปรากฏที่นี่ทันที
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {myTasks.map(req => {
            const sType = CLEANING_SERVICE_CONFIG[req.service_type] || CLEANING_SERVICE_CONFIG.general;
            const statusCfg = CLEANING_STATUS_CONFIG[req.status] || CLEANING_STATUS_CONFIG.pending;
            const isAssignedToMe = req.assigned_maid_id === session.maid_id;
            const isActing = actionLoadingId === req.id;

            return (
              <div
                key={req.id}
                style={{
                  background: '#fff',
                  borderRadius: 14,
                  border: isAssignedToMe ? '2px solid #BAE6FD' : '1px solid #E2E8F0',
                  padding: '1.125rem',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.625rem',
                }}
              >
                {/* Header: Room & Status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0284C7' }}>
                      ห้อง {req.room_number}
                    </span>
                    {isAssignedToMe ? (
                      <span style={{ fontSize: '0.725rem', fontWeight: 700, background: '#E0F2FE', color: '#0369A1', padding: '0.15rem 0.5rem', borderRadius: 6 }}>
                        งานของคุณ
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.725rem', fontWeight: 600, background: '#FEF3C7', color: '#B45309', padding: '0.15rem 0.5rem', borderRadius: 6 }}>
                        รองานรับมอบหมาย
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

                {/* Service Type Tag */}
                <div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      padding: '0.25rem 0.65rem',
                      borderRadius: 6,
                      color: sType.color,
                      background: sType.bg,
                    }}
                  >
                    <Sparkles size={13} />
                    {sType.label}
                  </span>
                </div>

                {/* Description */}
                {req.description && (
                  <div style={{ fontSize: '0.875rem', color: '#334155', background: '#F8FAFC', padding: '0.5rem 0.75rem', borderRadius: 8 }}>
                    {req.description}
                  </div>
                )}

                {/* Time Slot */}
                {(req.preferred_date || req.preferred_time_slot) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: '#64748B' }}>
                    <Calendar size={14} />
                    <span>
                      {req.preferred_date ? new Date(req.preferred_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : 'วันนี้ / ตามนัดหมาย'}{' '}
                      {req.preferred_time_slot ? `• ${req.preferred_time_slot}` : ''}
                    </span>
                  </div>
                )}

                {/* Photo Viewer */}
                <MaidPhotoViewer uid={session.owner_uid} buildingId={session.building_id} req={req} />

                {/* Completed Note if done */}
                {(req.completed_note || req.completion_notes) && (
                  <div style={{ fontSize: '0.8rem', color: '#16A34A', background: '#F0FDF4', padding: '0.45rem 0.65rem', borderRadius: 6 }}>
                    <strong>บันทึกปิดงาน:</strong> {req.completed_note || req.completion_notes}
                  </div>
                )}

                {/* Action Buttons for Maid */}
                {activeTab === 'todo' && (
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem', paddingTop: '0.625rem', borderTop: '1px solid #F1F5F9' }}>
                    {(req.status === 'pending' || req.status === 'open') && (
                      <button
                        onClick={() => handleAccept(req)}
                        disabled={isActing}
                        type="button"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          background: '#0284C7',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          padding: '0.5rem 1rem',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <Clock size={15} />
                        {isActing ? 'กำลังรับงาน...' : 'รับงานนี้'}
                      </button>
                    )}

                    {(req.status === 'in_progress' || req.status === 'assigned') && (
                      <button
                        onClick={() => {
                          setCompletingReq(req);
                          setCompleteNote('');
                        }}
                        disabled={isActing}
                        type="button"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          background: '#16A34A',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 8,
                          padding: '0.5rem 1.125rem',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        <CheckCircle2 size={16} />
                        ปิดงาน / เสร็จสิ้นแล้ว
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal: Complete Job (Maid) ────────────────────────────── */}
      {completingReq && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: 14, maxWidth: 400, width: '100%', overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)' }}>
            <div style={{ padding: '1.25rem', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#15803D', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <CheckCircle2 size={18} />
                ปิดงานทำความสะอาดห้อง {completingReq.room_number}
              </div>
              <button onClick={() => setCompletingReq(null)} type="button" style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#94A3B8' }}>✕</button>
            </div>

            <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.35rem', color: '#334155' }}>
                  บันทึกผลงาน / ข้อความถึงเจ้าของหอ (ถ้ามี)
                </label>
                <textarea
                  rows={3}
                  placeholder="เช่น ทำความสะอาดห้องน้ำและระเบียงเรียบร้อยแล้วค่ะ..."
                  value={completeNote}
                  onChange={e => setCompleteNote(e.target.value)}
                  style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: '0.875rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.625rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setCompletingReq(null)}
                  style={{ padding: '0.45rem 0.875rem', borderRadius: 8, border: '1px solid #CBD5E1', background: '#F8FAFC', color: '#475569', fontSize: '0.825rem', cursor: 'pointer' }}
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={handleConfirmComplete}
                  disabled={actionLoadingId === completingReq.id}
                  style={{ padding: '0.45rem 1.125rem', borderRadius: 8, border: 'none', background: '#16A34A', color: '#fff', fontSize: '0.825rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  {actionLoadingId === completingReq.id ? 'กำลังบันทึก...' : 'ยืนยันปิดงาน'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
