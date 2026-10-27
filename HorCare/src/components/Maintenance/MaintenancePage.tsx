import { useState } from 'react';
import {
  Wrench, AlertTriangle, Clock, CheckCircle2, XCircle,
  Edit3, Check, Zap, Droplets, Wind, DoorOpen,
  ShowerHead, Sofa, Package, RefreshCw, Trash2,
  PackageOpen, Layers, ChevronDown, ChevronUp, Minus, Plus,
  ImageIcon, HardHat, Calendar, Phone,
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useMaintenanceRequests, useStockItems, useAssets, useVendors } from '../../hooks/useMaintenanceRequests';
import type { MaintenanceRequest, MaintenanceCategory, MaintenanceStatus, AssetCondition, MaintenancePartUsed } from '../../types';

// ── Lazy photo loader ─────────────────────────────────────────────────────────
function MaintenancePhoto({ uid, buildingId, reqId }: { uid: string; buildingId: string; reqId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (src) { setExpanded(e => !e); return; }
    setLoading(true);
    try {
      const snap = await getDoc(doc(db, `users/${uid}/buildings/${buildingId}/maintenance_images`, reqId));
      if (snap.exists()) setSrc(snap.data().data as string);
    } catch { /* ignore */ } finally { setLoading(false); setExpanded(true); }
  };

  return (
    <div style={{ marginBottom: '0.625rem' }}>
      <button
        onClick={load}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
          fontSize: '0.75rem', fontWeight: 600, color: '#0F4C81',
          background: '#F2F7FC', border: '1px solid #CFE2F6',
          padding: '0.25rem 0.625rem', borderRadius: '6px', cursor: 'pointer',
        }}
      >
        {loading
          ? <span style={{ width: 12, height: 12, border: '1.5px solid #CFE2F6', borderTopColor: '#0F4C81', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} />
          : <ImageIcon size={13} />
        }
        {src ? (expanded ? 'ซ่อนรูป' : 'ดูรูป') : 'ดูรูปประกอบ'}
      </button>
      {expanded && src && (
        <img
          src={src}
          alt="รูปแจ้งซ่อม"
          style={{ display: 'block', marginTop: '0.5rem', width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 8, border: '1px solid #DCE5EF' }}
        />
      )}
    </div>
  );
}

// ── Config ────────────────────────────────────────────────────────────────────

interface CatCfg { label: string; Icon: React.ComponentType<{ size?: number }>; color: string }

const CATEGORY_CFG: Record<MaintenanceCategory, CatCfg> = {
  electric:    { label: 'ไฟฟ้า',            Icon: Zap,       color: '#F59E2E' },
  plumbing:    { label: 'ประปา',             Icon: Droplets,  color: '#0A6CC2' },
  appliance:   { label: 'เครื่องใช้ไฟฟ้า',  Icon: Package,   color: 'var(--color-primary)' },
  door_window: { label: 'ประตู/หน้าต่าง',    Icon: DoorOpen,  color: 'var(--color-gray-500)' },
  bathroom:    { label: 'ห้องน้ำ',            Icon: ShowerHead, color: '#0A6CC2' },
  ac:          { label: 'แอร์',               Icon: Wind,      color: '#0A6CC2' },
  furniture:   { label: 'เฟอร์นิเจอร์',      Icon: Sofa,      color: '#9A3412' },
  other:       { label: 'อื่นๆ',              Icon: Wrench,    color: 'var(--color-gray-700)' },
};

const STATUS_CFG: Record<MaintenanceStatus, { label: string; color: string; bg: string; border: string }> = {
  open:        { label: 'รอดำเนินการ',      color: '#DC2626', bg: 'var(--color-danger-ultra-light)', border: 'var(--color-danger-light)' },
  in_progress: { label: 'กำลังดำเนินการ',  color: '#E8740C', bg: 'var(--color-warning-ultra-light)', border: 'var(--color-warning-light)' },
  done:        { label: 'เสร็จสิ้น',       color: 'var(--color-success)', bg: 'var(--color-success-ultra-light)', border: 'var(--color-success-light)' },
  rejected:    { label: 'ปฏิเสธ',          color: 'var(--color-gray-500)', bg: 'var(--color-gray-100)', border: 'var(--color-gray-300)' },
};

const CONDITION_CFG: Record<AssetCondition, { label: string; color: string }> = {
  good:   { label: 'ดี',         color: 'var(--color-success)' },
  fair:   { label: 'พอใช้',      color: '#E8740C' },
  poor:   { label: 'แย่',        color: '#DC2626' },
  broken: { label: 'ชำรุด/เสีย', color: '#0F4C81' },
};

function fmtRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'เมื่อกี้';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} วันที่แล้ว`;
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

// ── Types ─────────────────────────────────────────────────────────────────────
type FilterMode = 'all' | MaintenanceStatus;

interface CompletionState {
  note: string;
  partQty: Record<string, number>; // stockId → qty
  assetId: string;
  conditionAfter: AssetCondition;
}

const EMPTY_COMPLETION: CompletionState = { note: '', partQty: {}, assetId: '', conditionAfter: 'good' };

interface AssignState {
  vendorId: string;
  vendorName: string;
  vendorPhone: string;
  scheduledDate: string;
}
const EMPTY_ASSIGN: AssignState = { vendorId: '', vendorName: '', vendorPhone: '', scheduledDate: '' };

interface Props { uid: string; buildingId: string; }

// ── Component ─────────────────────────────────────────────────────────────────
export default function MaintenancePage({ uid, buildingId }: Props) {
  const { requests, loading, updateStatus, completeRequest, deleteRequest } = useMaintenanceRequests(uid, buildingId);
  const { items: stockItems, decrementMany } = useStockItems(uid, buildingId);
  const { assets, updateCondition } = useAssets(uid, buildingId);
  const { vendors } = useVendors(uid, buildingId);

  const [filter, setFilter] = useState<FilterMode>('all');
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completion, setCompletion] = useState<CompletionState>(EMPTY_COMPLETION);
  const [stockSearch, setStockSearch] = useState('');
  const [stockExpanded, setStockExpanded] = useState(true);
  const [assetExpanded, setAssetExpanded] = useState(true);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignForm, setAssignForm] = useState<AssignState>(EMPTY_ASSIGN);

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);

  const counts = {
    all:         requests.length,
    open:        requests.filter(r => r.status === 'open').length,
    in_progress: requests.filter(r => r.status === 'in_progress').length,
    done:        requests.filter(r => r.status === 'done').length,
    rejected:    requests.filter(r => r.status === 'rejected').length,
  };

  const handleStatus = async (req: MaintenanceRequest, next: MaintenanceStatus) => {
    setSaving(req.id);
    try { await updateStatus(req.id, next); }
    finally { setSaving(null); }
  };

  const openAssign = (req: MaintenanceRequest) => {
    setAssigningId(req.id);
    setAssignForm({
      vendorId: req.vendor_id ?? '',
      vendorName: req.vendor_name ?? '',
      vendorPhone: req.vendor_phone ?? '',
      scheduledDate: req.scheduled_date ?? '',
    });
  };

  const handleAssignConfirm = async (req: MaintenanceRequest) => {
    setSaving(req.id);
    try {
      const extra: Record<string, string> = {};
      if (assignForm.vendorName) {
        extra.vendor_name = assignForm.vendorName;
        if (assignForm.vendorId) extra.vendor_id = assignForm.vendorId;
        if (assignForm.vendorPhone) extra.vendor_phone = assignForm.vendorPhone;
      }
      if (assignForm.scheduledDate) extra.scheduled_date = assignForm.scheduledDate;
      await updateStatus(req.id, 'in_progress', undefined, Object.keys(extra).length ? extra : undefined);
      setAssigningId(null);
    } finally { setSaving(null); }
  };

  const handleSaveNote = async (req: MaintenanceRequest) => {
    setSaving(req.id);
    try {
      await updateStatus(req.id, req.status, noteText);
      setEditingNoteId(null);
    } finally { setSaving(null); }
  };

  const handleDelete = async (reqId: string) => {
    setSaving(reqId);
    try { await deleteRequest(reqId); }
    finally { setSaving(null); setConfirmDeleteId(null); }
  };

  const openCompletion = (req: MaintenanceRequest) => {
    setCompletingId(req.id);
    setCompletion({
      note: req.admin_note ?? '',
      partQty: {},
      assetId: req.asset_id ?? '',
      conditionAfter: req.asset_condition_after ?? 'good',
    });
    setStockSearch('');
    setStockExpanded(true);
    setAssetExpanded(true);
  };

  const handleComplete = async (req: MaintenanceRequest) => {
    setSaving(req.id);
    try {
      const stockMap = new Map(stockItems.map(s => [s.id, s]));
      const partsUsed: MaintenancePartUsed[] = Object.entries(completion.partQty)
        .filter(([, qty]) => qty > 0)
        .map(([stockId, qty]) => {
          const item = stockMap.get(stockId);
          return { stock_id: stockId, stock_name: item?.name ?? '', qty, unit: item?.unit ?? '' };
        });

      const assetRef = assets.find(a => a.id === completion.assetId);
      const assetUpdate = assetRef
        ? { asset_id: assetRef.id, asset_name: assetRef.name, condition: completion.conditionAfter }
        : undefined;

      await completeRequest(req.id, completion.note, partsUsed, assetUpdate);
      if (partsUsed.length > 0) await decrementMany(partsUsed, stockMap);
      if (assetUpdate) await updateCondition(assetUpdate.asset_id, assetUpdate.condition);

      setCompletingId(null);
    } finally { setSaving(null); }
  };

  // Filtered stock list for the picker
  const filteredStock = stockItems.filter(s =>
    !stockSearch || s.name.toLowerCase().includes(stockSearch.toLowerCase())
  );

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Wrench size={28} /> แจ้งซ่อม
        </h1>
        <p className="page-subtitle">คำขอซ่อมแซมจากผู้เช่า</p>
      </div>

      {/* Filter tabs */}
      <div className="card mb-6" style={{ padding: '0.625rem' }}>
        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
          {([
            { id: 'all'        , label: 'ทั้งหมด'          },
            { id: 'open'       , label: 'รอดำเนินการ'      },
            { id: 'in_progress', label: 'กำลังดำเนินการ'   },
            { id: 'done'       , label: 'เสร็จสิ้น'        },
            { id: 'rejected'   , label: 'ปฏิเสธ'           },
          ] as const).map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.4rem 0.75rem', borderRadius: '8px', cursor: 'pointer',
                border: filter === f.id ? '1px solid var(--color-primary, #0F4C81)' : '1px solid var(--color-border, #DCE5EF)',
                background: filter === f.id ? 'rgba(15, 76, 129,0.1)' : 'none',
                color: filter === f.id ? 'var(--color-primary, #0F4C81)' : 'var(--color-text-muted, #557089)',
                fontSize: '0.8rem', fontWeight: filter === f.id ? 700 : 500,
              }}
            >
              {f.label}
              {f.id !== 'all' && counts[f.id] > 0 && (
                <span style={{
                  fontSize: '0.7rem', fontWeight: 700,
                  background: filter === f.id ? 'var(--color-primary, #0F4C81)' : 'var(--color-gray-200)',
                  color: filter === f.id ? 'var(--color-white)' : 'var(--color-gray-500)',
                  padding: '0.1rem 0.35rem', borderRadius: '4px',
                }}>
                  {counts[f.id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <div className="loading-spinner" style={{ width: 32, height: 32 }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <Wrench size={48} />
          <h3>{filter === 'all' ? 'ยังไม่มีคำขอแจ้งซ่อม' : 'ไม่มีรายการในหมวดนี้'}</h3>
          <p>เมื่อผู้เช่าแจ้งซ่อมผ่านลิงก์ portal รายการจะแสดงที่นี่</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {filtered.map(req => {
            const cat = CATEGORY_CFG[req.category] ?? CATEGORY_CFG.other;
            const status = STATUS_CFG[req.status] ?? STATUS_CFG.open;
            const CatIcon = cat.Icon;
            const isEditingNote = editingNoteId === req.id;
            const isSaving = saving === req.id;
            const isCompleting = completingId === req.id;

            return (
              <div key={req.id} style={{
                background: 'var(--color-white, #fff)', borderRadius: '14px',
                border: `1px solid ${req.urgency === 'urgent' ? 'rgba(220,38,38,0.3)' : 'var(--color-border, #DCE5EF)'}`,
                padding: '1rem 1.125rem',
                boxShadow: req.urgency === 'urgent' ? '0 2px 12px rgba(220,38,38,0.07)' : 'none',
              }}>
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.625rem' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                    padding: '0.2rem 0.6rem', borderRadius: '7px',
                    background: 'var(--color-gray-100, #EBF1F7)', color: 'var(--color-gray-800, #1A3350)',
                    fontSize: '0.8125rem', fontWeight: 800, fontFamily: 'var(--font-mono)',
                  }}>
                    ห้อง {req.room_number}
                  </span>
                  {req.urgency === 'urgent' && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                      padding: '0.15rem 0.45rem', borderRadius: '6px',
                      background: 'rgba(220,38,38,0.1)', color: '#DC2626',
                      border: '1px solid rgba(220,38,38,0.25)',
                      fontSize: '0.7rem', fontWeight: 700,
                    }}>
                      <AlertTriangle size={11} /> ด่วน
                    </span>
                  )}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                    padding: '0.15rem 0.5rem', borderRadius: '6px',
                    background: `${cat.color}18`, color: cat.color,
                    border: `1px solid ${cat.color}30`,
                    fontSize: '0.75rem', fontWeight: 600,
                  }}>
                    <CatIcon size={12} /> {cat.label}
                  </span>
                  <span style={{
                    marginLeft: 'auto', display: 'inline-flex', alignItems: 'center',
                    padding: '0.15rem 0.5rem', borderRadius: '6px',
                    background: status.bg, color: status.color, border: `1px solid ${status.border}`,
                    fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
                  }}>
                    {status.label}
                  </span>
                </div>

                {/* Description */}
                <p style={{ fontSize: '0.875rem', color: 'var(--color-gray-700, #29435E)', margin: '0 0 0.375rem', lineHeight: 1.55 }}>
                  {req.description}
                </p>

                {/* Photo attachment */}
                {req.has_photo && (
                  <MaintenancePhoto uid={uid} buildingId={buildingId} reqId={req.id} />
                )}

                {/* Timestamp */}
                <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-400, #8FA3B8)', marginBottom: '0.375rem' }}>
                  {fmtRelative(req.created_at)}
                  {req.updated_at && ` · อัปเดต ${fmtRelative(req.updated_at)}`}
                </div>

                {/* Vendor + schedule badges (in_progress) */}
                {req.status === 'in_progress' && (req.vendor_name || req.scheduled_date) && (
                  <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.625rem' }}>
                    {req.vendor_name && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        padding: '0.2rem 0.55rem', borderRadius: '6px',
                        background: '#FEF6EC', color: '#E8740C',
                        border: '1px solid #FBD9A8', fontSize: '0.75rem', fontWeight: 600,
                      }}>
                        <HardHat size={11} /> {req.vendor_name}
                        {req.vendor_phone && (
                          <a href={`tel:${req.vendor_phone}`} style={{ color: '#E8740C', marginLeft: '0.2rem' }}
                            onClick={e => e.stopPropagation()}>
                            <Phone size={10} />
                          </a>
                        )}
                      </span>
                    )}
                    {req.scheduled_date && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                        padding: '0.2rem 0.55rem', borderRadius: '6px',
                        background: '#F2F7FC', color: '#0A6CC2',
                        border: '1px solid #CFE2F6', fontSize: '0.75rem', fontWeight: 600,
                      }}>
                        <Calendar size={11} />
                        {new Date(req.scheduled_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                      </span>
                    )}
                  </div>
                )}

                {/* Admin note display */}
                {req.admin_note && !isEditingNote && (
                  <div style={{
                    fontSize: '0.8125rem', color: 'var(--color-gray-700, #29435E)', lineHeight: 1.5,
                    background: 'var(--color-gray-50, #F4F7FB)',
                    borderRadius: '8px', padding: '0.5rem 0.75rem',
                    borderLeft: '3px solid var(--color-primary, #0F4C81)',
                    marginBottom: '0.625rem',
                  }}>
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-primary)', display: 'block', marginBottom: '0.2rem' }}>
                      หมายเหตุผู้ดูแล
                    </span>
                    {req.admin_note}
                  </div>
                )}

                {/* Parts used (done cards) */}
                {req.status === 'done' && req.parts_used && req.parts_used.length > 0 && (
                  <div style={{
                    background: 'var(--color-success-ultra-light)', borderRadius: '8px', padding: '0.5rem 0.75rem',
                    border: '1px solid #A7DDBB', marginBottom: '0.625rem',
                  }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-success)', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <PackageOpen size={12} /> อะไหล่ที่ใช้
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                      {req.parts_used.map((p, i) => (
                        <span key={i} style={{
                          fontSize: '0.75rem', fontWeight: 600,
                          padding: '0.15rem 0.5rem', borderRadius: '6px',
                          background: 'var(--color-success-ultra-light)', color: 'var(--color-success)',
                        }}>
                          {p.stock_name} × {p.qty} {p.unit}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Linked asset (done cards) */}
                {req.status === 'done' && req.asset_name && (
                  <div style={{
                    background: 'var(--color-primary-ultra-light)', borderRadius: '8px', padding: '0.5rem 0.75rem',
                    border: '1px solid #CFE2F6', marginBottom: '0.625rem',
                    display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem',
                  }}>
                    <Layers size={13} color="#0A6CC2" />
                    <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{req.asset_name}</span>
                    {req.asset_condition_after && (
                      <span style={{ color: CONDITION_CFG[req.asset_condition_after].color, fontWeight: 700, fontSize: '0.75rem' }}>
                        → {CONDITION_CFG[req.asset_condition_after].label}
                      </span>
                    )}
                  </div>
                )}

                {/* Edit note form */}
                {isEditingNote && (
                  <div style={{ marginBottom: '0.625rem' }}>
                    <textarea
                      className="form-input"
                      rows={2}
                      placeholder="หมายเหตุ / รายละเอียดการซ่อม..."
                      value={noteText}
                      onChange={e => setNoteText(e.target.value)}
                      style={{ fontSize: '0.8125rem', resize: 'vertical', minHeight: '64px' }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.375rem' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => handleSaveNote(req)} disabled={isSaving}>
                        {isSaving ? <span className="loading-spinner" style={{ width: 14, height: 14 }} /> : <Check size={14} />}
                        บันทึก
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setEditingNoteId(null)}>ยกเลิก</button>
                    </div>
                  </div>
                )}

                {/* ── Completion Panel ── */}
                {isCompleting && (
                  <div style={{
                    background: 'var(--color-gray-50)', borderRadius: '12px', padding: '1rem',
                    border: '1px solid var(--color-gray-200)', marginBottom: '0.75rem',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-gray-800)', marginBottom: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                      <CheckCircle2 size={15} color="#15803D" /> บันทึกการซ่อมเสร็จ
                    </div>

                    {/* Note */}
                    <div style={{ marginBottom: '0.875rem' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.3rem' }}>
                        หมายเหตุ (ไม่จำเป็น)
                      </label>
                      <textarea
                        className="form-input"
                        rows={2}
                        placeholder="รายละเอียดการซ่อม..."
                        value={completion.note}
                        onChange={e => setCompletion(c => ({ ...c, note: e.target.value }))}
                        style={{ fontSize: '0.8125rem', resize: 'vertical', minHeight: '56px' }}
                      />
                    </div>

                    {/* Stock picker */}
                    <div style={{ marginBottom: '0.875rem' }}>
                      <button
                        onClick={() => setStockExpanded(v => !v)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0.3rem',
                        }}
                      >
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <PackageOpen size={13} /> อะไหล่ที่ใช้ (สต็อก)
                          {Object.values(completion.partQty).filter(q => q > 0).length > 0 && (
                            <span style={{ background: '#0F4C81', color: 'var(--color-white)', borderRadius: '4px', padding: '0 0.3rem', fontSize: '0.65rem' }}>
                              {Object.values(completion.partQty).filter(q => q > 0).length} รายการ
                            </span>
                          )}
                        </span>
                        {stockExpanded ? <ChevronUp size={14} color="#8FA3B8" /> : <ChevronDown size={14} color="#8FA3B8" />}
                      </button>

                      {stockExpanded && (
                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '10px', background: 'var(--color-white)', overflow: 'hidden' }}>
                          {stockItems.length === 0 ? (
                            <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--color-gray-400)' }}>
                              ยังไม่มีสต็อกวัสดุ — เพิ่มได้ที่หน้า "ระบบจัดการ"
                            </div>
                          ) : (
                            <>
                              <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--color-gray-100)' }}>
                                <input
                                  className="form-input"
                                  placeholder="ค้นหาวัสดุ..."
                                  value={stockSearch}
                                  onChange={e => setStockSearch(e.target.value)}
                                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.625rem' }}
                                />
                              </div>
                              <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                {filteredStock.map(item => {
                                  const qty = completion.partQty[item.id] ?? 0;
                                  const selected = qty > 0;
                                  return (
                                    <div key={item.id} style={{
                                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                                      padding: '0.5rem 0.75rem',
                                      borderBottom: '1px solid var(--color-gray-100)',
                                      background: selected ? 'rgba(15, 76, 129,0.04)' : 'transparent',
                                    }}>
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-gray-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                          {item.name}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-gray-400)' }}>
                                          คงเหลือ {item.quantity} {item.unit}
                                        </div>
                                      </div>
                                      {/* Qty stepper */}
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                                        <button
                                          onClick={() => setCompletion(c => {
                                            const next = Math.max(0, (c.partQty[item.id] ?? 0) - 1);
                                            const copy = { ...c.partQty };
                                            if (next === 0) delete copy[item.id]; else copy[item.id] = next;
                                            return { ...c, partQty: copy };
                                          })}
                                          disabled={qty === 0}
                                          style={{
                                            width: 26, height: 26, borderRadius: '6px', cursor: qty === 0 ? 'default' : 'pointer',
                                            border: '1px solid var(--color-gray-200)', background: qty === 0 ? 'var(--color-gray-50)' : 'var(--color-white)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: qty === 0 ? 'var(--color-gray-300)' : 'var(--color-gray-700)',
                                          }}
                                        >
                                          <Minus size={12} />
                                        </button>
                                        <span style={{ minWidth: 24, textAlign: 'center', fontSize: '0.8125rem', fontWeight: 700, color: selected ? '#0F4C81' : 'var(--color-gray-400)' }}>
                                          {qty}
                                        </span>
                                        <button
                                          onClick={() => setCompletion(c => ({
                                            ...c,
                                            partQty: { ...c.partQty, [item.id]: Math.min(item.quantity, (c.partQty[item.id] ?? 0) + 1) },
                                          }))}
                                          disabled={qty >= item.quantity}
                                          style={{
                                            width: 26, height: 26, borderRadius: '6px', cursor: qty >= item.quantity ? 'default' : 'pointer',
                                            border: '1px solid var(--color-gray-200)', background: qty >= item.quantity ? 'var(--color-gray-50)' : 'var(--color-white)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: qty >= item.quantity ? 'var(--color-gray-300)' : 'var(--color-gray-700)',
                                          }}
                                        >
                                          <Plus size={12} />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Asset picker */}
                    <div style={{ marginBottom: '1rem' }}>
                      <button
                        onClick={() => setAssetExpanded(v => !v)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 0.3rem',
                        }}
                      >
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <Layers size={13} /> ทรัพย์สินที่ซ่อม (ไม่จำเป็น)
                          {completion.assetId && (
                            <span style={{ background: '#0A6CC2', color: 'var(--color-white)', borderRadius: '4px', padding: '0 0.3rem', fontSize: '0.65rem' }}>
                              เลือกแล้ว
                            </span>
                          )}
                        </span>
                        {assetExpanded ? <ChevronUp size={14} color="#8FA3B8" /> : <ChevronDown size={14} color="#8FA3B8" />}
                      </button>

                      {assetExpanded && (
                        <div style={{ border: '1px solid var(--color-gray-200)', borderRadius: '10px', background: 'var(--color-white)', overflow: 'hidden' }}>
                          {assets.length === 0 ? (
                            <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--color-gray-400)' }}>
                              ยังไม่มีทรัพย์สิน — เพิ่มได้ที่หน้า "ระบบจัดการ"
                            </div>
                          ) : (
                            <>
                              <div style={{ padding: '0.375rem 0.5rem', borderBottom: '1px solid var(--color-gray-100)' }}>
                                <select
                                  className="form-input"
                                  value={completion.assetId}
                                  onChange={e => setCompletion(c => ({ ...c, assetId: e.target.value }))}
                                  style={{ fontSize: '0.8125rem' }}
                                >
                                  <option value="">— ไม่ระบุ —</option>
                                  {assets.map(a => (
                                    <option key={a.id} value={a.id}>
                                      {a.name}{a.room_number ? ` (ห้อง ${a.room_number})` : ''} · {CONDITION_CFG[a.condition].label}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {completion.assetId && (
                                <div style={{ padding: '0.5rem 0.75rem' }}>
                                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-gray-500)', marginBottom: '0.375rem' }}>
                                    สภาพหลังซ่อม
                                  </div>
                                  <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                                    {(Object.entries(CONDITION_CFG) as [AssetCondition, { label: string; color: string }][]).map(([key, cfg]) => (
                                      <button
                                        key={key}
                                        onClick={() => setCompletion(c => ({ ...c, conditionAfter: key }))}
                                        style={{
                                          padding: '0.3rem 0.7rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem',
                                          border: completion.conditionAfter === key ? `2px solid ${cfg.color}` : '1.5px solid #DCE5EF',
                                          background: completion.conditionAfter === key ? `${cfg.color}18` : 'var(--color-white)',
                                          color: completion.conditionAfter === key ? cfg.color : 'var(--color-gray-500)',
                                          fontWeight: completion.conditionAfter === key ? 700 : 500,
                                        }}
                                      >
                                        {cfg.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => handleComplete(req)}
                        disabled={isSaving}
                        style={{ background: '#15803D', color: 'var(--color-white)', border: 'none', flex: 1 }}
                      >
                        {isSaving
                          ? <span className="loading-spinner" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,0.4)', borderTopColor: 'var(--color-white)' }} />
                          : <CheckCircle2 size={14} />}
                        บันทึกและปิดงาน
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setCompletingId(null)}
                        disabled={isSaving}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                )}

                {/* Confirm delete */}
                {confirmDeleteId === req.id && (
                  <div style={{
                    background: '#FEE2E2', borderRadius: '8px', padding: '0.625rem 0.875rem',
                    marginBottom: '0.625rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap',
                    border: '1px solid #FCA5A5', fontSize: '0.8125rem', color: '#DC2626', fontWeight: 600,
                  }}>
                    <span style={{ flex: 1 }}>ยืนยันลบคำขอนี้?</span>
                    <button className="btn btn-sm" onClick={() => handleDelete(req.id)} disabled={isSaving}
                      style={{ background: '#DC2626', color: 'var(--color-white)', border: 'none' }}>
                      {isSaving ? '...' : 'ลบ'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDeleteId(null)}>ยกเลิก</button>
                  </div>
                )}

                {/* Assignment panel */}
                {assigningId === req.id && (
                  <div style={{
                    background: '#FEF6EC', borderRadius: '12px', padding: '0.875rem 1rem',
                    border: '1px solid #FBD9A8', marginBottom: '0.75rem',
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#9A3412', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                      <HardHat size={15} /> มอบหมายงาน
                    </div>

                    {/* Vendor select */}
                    <div style={{ marginBottom: '0.625rem' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.25rem' }}>
                        ช่าง / ผู้รับเหมา (ไม่จำเป็น)
                      </label>
                      {vendors.length > 0 ? (
                        <select
                          className="form-input"
                          value={assignForm.vendorId}
                          onChange={e => {
                            const v = vendors.find(v => v.id === e.target.value);
                            setAssignForm(f => ({
                              ...f,
                              vendorId: e.target.value,
                              vendorName: v?.name ?? f.vendorName,
                              vendorPhone: v?.phone ?? f.vendorPhone,
                            }));
                          }}
                          style={{ fontSize: '0.8125rem', marginBottom: '0.375rem' }}
                        >
                          <option value="">— เลือกจากรายชื่อ —</option>
                          {vendors.map(v => (
                            <option key={v.id} value={v.id}>{v.name} · {v.specialty}</option>
                          ))}
                        </select>
                      ) : null}
                      <input
                        className="form-input"
                        placeholder={vendors.length > 0 ? 'หรือพิมพ์ชื่อช่างเอง...' : 'ชื่อช่าง / ผู้รับเหมา...'}
                        value={assignForm.vendorId ? (vendors.find(v => v.id === assignForm.vendorId)?.name ?? assignForm.vendorName) : assignForm.vendorName}
                        readOnly={!!assignForm.vendorId}
                        onChange={e => setAssignForm(f => ({ ...f, vendorName: e.target.value, vendorId: '' }))}
                        style={{ fontSize: '0.8125rem', background: assignForm.vendorId ? 'var(--color-gray-50)' : undefined }}
                      />
                      {assignForm.vendorId && (
                        <input
                          className="form-input"
                          placeholder="เบอร์โทรช่าง"
                          value={assignForm.vendorPhone}
                          onChange={e => setAssignForm(f => ({ ...f, vendorPhone: e.target.value }))}
                          style={{ fontSize: '0.8125rem', marginTop: '0.375rem' }}
                        />
                      )}
                    </div>

                    {/* Scheduled date */}
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.25rem' }}>
                        <Calendar size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                        วันนัดซ่อม (ไม่จำเป็น)
                      </label>
                      <input
                        type="date"
                        className="form-input"
                        value={assignForm.scheduledDate}
                        onChange={e => setAssignForm(f => ({ ...f, scheduledDate: e.target.value }))}
                        style={{ fontSize: '0.8125rem' }}
                      />
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="btn btn-sm"
                        onClick={() => handleAssignConfirm(req)}
                        disabled={isSaving}
                        style={{ background: '#E8740C', color: 'var(--color-white)', border: 'none', flex: 1 }}
                      >
                        {isSaving
                          ? <span className="loading-spinner" style={{ width: 14, height: 14, borderColor: 'rgba(255,255,255,0.4)', borderTopColor: 'var(--color-white)' }} />
                          : <Clock size={14} />}
                        รับเรื่องและดำเนินการ
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setAssigningId(null)} disabled={isSaving}>
                        ยกเลิก
                      </button>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {req.status === 'open' && assigningId !== req.id && (
                    <button
                      className="btn btn-sm"
                      onClick={() => openAssign(req)}
                      disabled={isSaving}
                      style={{ background: '#FDEBD3', color: '#E8740C', border: '1px solid #FBD9A8' }}
                    >
                      {isSaving ? <span className="loading-spinner" style={{ width: 14, height: 14 }} /> : <Clock size={14} />}
                      รับเรื่อง
                    </button>
                  )}
                  {req.status === 'in_progress' && !isCompleting && (
                    <button
                      className="btn btn-sm"
                      onClick={() => openCompletion(req)}
                      disabled={isSaving}
                      style={{ background: 'var(--color-success-ultra-light)', color: 'var(--color-success)', border: '1px solid #A7DDBB' }}
                    >
                      <CheckCircle2 size={14} /> เสร็จสิ้น
                    </button>
                  )}
                  {req.status === 'open' && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleStatus(req, 'rejected')}
                      disabled={isSaving}
                    >
                      <XCircle size={14} /> ปฏิเสธ
                    </button>
                  )}
                  {(req.status === 'done' || req.status === 'rejected') && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleStatus(req, 'open')}
                      disabled={isSaving}
                    >
                      <RefreshCw size={14} /> เปิดใหม่
                    </button>
                  )}

                  <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.375rem' }}>
                    {!isEditingNote && !isCompleting && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => { setEditingNoteId(req.id); setNoteText(req.admin_note ?? ''); }}
                      >
                        <Edit3 size={13} />
                        {req.admin_note ? 'แก้หมายเหตุ' : 'หมายเหตุ'}
                      </button>
                    )}
                    <button
                      className="btn btn-sm"
                      onClick={() => setConfirmDeleteId(req.id)}
                      style={{ color: '#DC2626', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


