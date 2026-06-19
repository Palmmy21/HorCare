import { useState, useEffect } from 'react';
import {
  collection, doc, onSnapshot, query, where, addDoc,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Room, DormConfig, MonthlyBill, TenantProfile, MaintenanceRequest, MaintenanceCategory } from '../../types';
import {
  Home, Zap, Droplets, Phone, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, AlertCircle, Link2Off,
  Building2, CalendarDays, CreditCard, Receipt,
  Wrench, Plus, AlertTriangle, Plug, Wind, DoorOpen,
  Bath, Armchair, Send, Pencil,
} from 'lucide-react';
import horcareLogo from '../../assets/horcare_logo.png';

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n?: number) {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString('th-TH');
}
function fmtCurrency(n?: number) {
  if (n === undefined || n === null) return '—';
  return `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
}
function fmtMonth(m?: string) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  const names = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return `${names[parseInt(mo)]} ${parseInt(y) + 543}`;
}
function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Maintenance config ────────────────────────────────────────────────────────
const PORTAL_CATEGORY_OPTIONS: { value: MaintenanceCategory; label: string; Icon: React.ElementType; color: string }[] = [
  { value: 'electric',    label: 'ไฟฟ้า',          Icon: Zap,      color: '#F59E0B' },
  { value: 'plumbing',    label: 'ประปา',           Icon: Droplets, color: '#3B82F6' },
  { value: 'appliance',   label: 'เครื่องใช้ไฟฟ้า', Icon: Plug,     color: '#8B5CF6' },
  { value: 'ac',          label: 'แอร์',            Icon: Wind,     color: '#06B6D4' },
  { value: 'door_window', label: 'ประตู/หน้าต่าง',  Icon: DoorOpen, color: '#6B7280' },
  { value: 'bathroom',    label: 'ห้องน้ำ',          Icon: Bath,     color: '#0EA5E9' },
  { value: 'furniture',   label: 'เฟอร์นิเจอร์',    Icon: Armchair, color: '#92400E' },
  { value: 'other',       label: 'อื่นๆ',            Icon: Wrench,   color: '#374151' },
];

const PORTAL_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  open:        { label: 'รอดำเนินการ',     color: '#DC2626', bg: '#FEE2E2' },
  in_progress: { label: 'กำลังดำเนินการ', color: '#D97706', bg: '#FEF3C7' },
  done:        { label: 'เสร็จสิ้น',      color: '#059669', bg: '#D1FAE5' },
  rejected:    { label: 'ปฏิเสธ',         color: '#6B7280', bg: '#F3F4F6' },
};

// ── Maintenance hook (room-scoped) ────────────────────────────────────────────
function useRoomMaintenance(uid: string, buildingId: string, roomId: string) {
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, `users/${uid}/buildings/${buildingId}/maintenance`),
      where('room_id', '==', roomId),
    );
    const unsub = onSnapshot(q,
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as MaintenanceRequest));
        docs.sort((a, b) => b.created_at.localeCompare(a.created_at));
        setRequests(docs);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [uid, buildingId, roomId]);

  return { requests, loading };
}

// ── Load tenant data (simplified query — no composite index required) ─────────
interface PortalData {
  room: Room | null;
  config: DormConfig | null;
  profile: TenantProfile | null;
  bills: MonthlyBill[];
  buildingName: string;
}

function useTenantData(uid: string, buildingId: string, roomId: string) {
  const [data, setData] = useState<PortalData>({ room: null, config: null, profile: null, bills: [], buildingName: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const basePath = `users/${uid}/buildings/${buildingId}`;

  useEffect(() => {
    const done = { room: false, config: false, bills: false, profile: false };
    const trySettle = () => { if (Object.values(done).every(Boolean)) setLoading(false); };

    const u1 = onSnapshot(doc(db, basePath, 'rooms', roomId),
      s => { done.room = true; setData(d => ({ ...d, room: s.exists() ? { ...s.data(), id: s.id } as Room : null })); trySettle(); },
      () => { done.room = true; setError('ไม่สามารถโหลดข้อมูลห้องได้'); trySettle(); });

    const u2 = onSnapshot(doc(db, basePath, 'data', 'config'),
      s => { done.config = true; setData(d => ({ ...d, config: s.exists() ? s.data() as DormConfig : null })); trySettle(); },
      () => { done.config = true; trySettle(); });

    const u3 = onSnapshot(doc(db, basePath, 'tenants', roomId),
      s => { done.profile = true; setData(d => ({ ...d, profile: s.exists() ? s.data() as TenantProfile : null })); trySettle(); },
      () => { done.profile = true; trySettle(); });

    // Simplified query: filter by room_id only, sort client-side → no composite index needed
    const u4 = onSnapshot(
      query(collection(db, basePath, 'bills'), where('room_id', '==', roomId)),
      s => {
        const all = s.docs.map(b => ({ ...b.data(), id: b.id } as MonthlyBill));
        all.sort((a, b) => b.month.localeCompare(a.month)); // newest first
        done.bills = true;
        setData(d => ({ ...d, bills: all }));
        trySettle();
      },
      () => { done.bills = true; trySettle(); });

    const u5 = onSnapshot(doc(db, `users/${uid}/buildings`, buildingId),
      s => { if (s.exists()) setData(d => ({ ...d, buildingName: s.data().name ?? '' })); });

    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [uid, buildingId, roomId, basePath]);

  return { data, loading, error };
}

// ── Payment Status component ─────────────────────────────────────────────────
function PaymentStatus({ status }: { status?: string }) {
  const cfg = {
    paid:    { label: 'ชำระแล้ว',    Icon: CheckCircle2, bg: '#DCFCE7', color: '#16A34A', border: '#86EFAC' },
    pending: { label: 'รอตรวจสอบ',   Icon: Clock,        bg: '#FEF9C3', color: '#92400E', border: '#FDE047' },
    unpaid:  { label: 'ยังไม่ชำระ',  Icon: XCircle,      bg: '#FEE2E2', color: '#B91C1C', border: '#FCA5A5' },
  }[status ?? 'unpaid'] ?? { label: 'ยังไม่ชำระ', Icon: XCircle, bg: '#FEE2E2', color: '#B91C1C', border: '#FCA5A5' };
  const { Icon } = cfg;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
      padding: '0.3rem 0.75rem', borderRadius: '20px',
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.border}`,
      fontWeight: 700, fontSize: '0.8125rem',
    }}>
      <Icon size={13} />
      {cfg.label}
    </span>
  );
}

// ── PromptPay QR ─────────────────────────────────────────────────────────────
function PromptPayCard({ number, name, amount }: { number: string; name: string; amount: number }) {
  const ppNum = number.replace(/-/g, '');
  const qrUrl = `https://promptpay.io/${ppNum}/${amount}.png`;
  return (
    <div style={{
      background: 'linear-gradient(135deg, #F0F9FF, #EFF6FF)',
      borderRadius: '16px', padding: '1.25rem',
      border: '1px solid #BFDBFE', textAlign: 'center',
    }}>
      <p style={{ fontSize: '0.8125rem', color: '#1D4ED8', margin: '0 0 0.75rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem' }}>
        <CreditCard size={14} /> สแกน QR ชำระเงิน
      </p>
      <img src={qrUrl} alt="PromptPay QR"
        style={{ width: 160, height: 160, borderRadius: '8px', imageRendering: 'pixelated', display: 'block', margin: '0 auto' }}
        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <div style={{ marginTop: '0.875rem', fontWeight: 800, fontSize: '1.125rem', color: '#111827' }}>
        {fmtCurrency(amount)}
      </div>
      <div style={{ fontSize: '0.775rem', color: '#6B7280', marginTop: '0.2rem' }}>{name} · {number}</div>
    </div>
  );
}

// ── Bill Card ─────────────────────────────────────────────────────────────────
function BillCard({ bill, config, defaultOpen, promptpay }: {
  bill: MonthlyBill; config: DormConfig | null;
  defaultOpen: boolean; promptpay: { number: string; name: string };
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isUnpaid = !bill.payment_status || bill.payment_status === 'unpaid';
  const isPaid = bill.payment_status === 'paid';

  const accentColor = isPaid ? '#16A34A' : isUnpaid ? '#DC2626' : '#92400E';
  const borderColor = isPaid ? '#BBF7D0' : isUnpaid ? '#FECACA' : '#FDE047';

  return (
    <div style={{
      background: '#fff', borderRadius: '16px',
      border: `1.5px solid ${borderColor}`,
      overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
    }}>
      {/* Header row */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: '1rem 1.125rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
        }}
      >
        <div style={{ textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CalendarDays size={15} color={accentColor} />
            <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: '#111827' }}>{fmtMonth(bill.month)}</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6B7280', marginTop: '0.2rem' }}>
            รวม {fmtCurrency(bill.total_bill)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <PaymentStatus status={bill.payment_status} />
          {open ? <ChevronUp size={16} color="#9CA3AF" /> : <ChevronDown size={16} color="#9CA3AF" />}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '0 1.125rem 1.125rem', borderTop: '1px solid #F3F4F6' }}>
          {/* Cost breakdown */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.75rem' }}>
            <tbody>
              {[
                { label: 'ค่าเช่าห้อง', value: bill.room_rent, icon: <Home size={13} color="#8B5CF6" /> },
                { label: `ค่าไฟ (${fmt(bill.elec_units)} หน่วย)`, value: bill.elec_bill, icon: <Zap size={13} color="#F59E0B" /> },
                ...(bill.water_flat_amount ? [{ label: `ค่าน้ำเหมา`, value: bill.water_flat_amount, icon: <Droplets size={13} color="#3B82F6" /> }] : []),
                ...(bill.water_excess_amount ? [{ label: `ค่าน้ำส่วนเกิน (${fmt(bill.water_excess_units)} หน่วย)`, value: bill.water_excess_amount, icon: <Droplets size={13} color="#2563EB" /> }] : []),
                ...(!bill.water_flat_amount ? [{ label: `ค่าน้ำ (${fmt(bill.water_units)} หน่วย)`, value: bill.water_bill, icon: <Droplets size={13} color="#3B82F6" /> }] : []),
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F9FAFB' }}>
                  <td style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem', color: '#374151' }}>
                    {row.icon} {row.label}
                  </td>
                  <td style={{ padding: '0.5rem 0', textAlign: 'right', fontWeight: 600, fontSize: '0.875rem', color: '#111827' }}>
                    {fmtCurrency(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ paddingTop: '0.625rem', fontWeight: 800, fontSize: '0.9375rem', color: '#111827' }}>รวมทั้งหมด</td>
                <td style={{ paddingTop: '0.625rem', textAlign: 'right', fontWeight: 800, fontSize: '0.9375rem', color: '#7C3AED' }}>{fmtCurrency(bill.total_bill)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Meter readings */}
          <div style={{ marginTop: '0.875rem', padding: '0.75rem', background: '#F9FAFB', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#9CA3AF', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              ค่ามิเตอร์
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8rem', color: '#374151' }}>
                  <Zap size={13} color="#F59E0B" /> มิเตอร์ไฟ
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.825rem', color: '#111827', fontWeight: 600 }}>
                  {fmt(bill.prev_elec)} → {fmt(bill.curr_elec)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8rem', color: '#374151' }}>
                  <Droplets size={13} color="#3B82F6" /> มิเตอร์น้ำ
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.825rem', color: '#111827', fontWeight: 600 }}>
                  {fmt(bill.prev_water)} → {fmt(bill.curr_water)}
                </span>
              </div>
            </div>
          </div>

          {/* QR for unpaid */}
          {isUnpaid && promptpay.number && (
            <div style={{ marginTop: '1rem' }}>
              <PromptPayCard number={promptpay.number} name={promptpay.name} amount={bill.total_bill} />
            </div>
          )}

          {/* Paid confirmation */}
          {isPaid && (
            <div style={{ marginTop: '0.875rem', padding: '0.75rem', background: '#F0FDF4', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={16} color="#16A34A" />
              <span style={{ fontSize: '0.8125rem', color: '#15803D', fontWeight: 600 }}>
                ชำระแล้วเมื่อ {bill.paid_at ? new Date(bill.paid_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                {bill.paid_method === 'auto' ? ' (อัตโนมัติ)' : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function TenantPortalPage() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid') ?? '';
  const buildingId = params.get('bid') ?? '';
  const roomId = params.get('rid') ?? '';

  const { data, loading, error } = useTenantData(uid, buildingId, roomId);
  const { room, config, profile, bills, buildingName } = data;

  const currentMonth = getCurrentMonth();
  const currentBill = bills.find(b => b.month === currentMonth);
  const prevBills = bills.filter(b => b.month !== currentMonth);

  const promptpay = {
    number: config?.bill_customization?.promptpay_number ?? '',
    name: config?.bill_customization?.promptpay_name ?? '',
  };

  // ── Invalid link ──
  if (!uid || !buildingId || !roomId) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', background: '#F3F4F6' }}>
        <img src={horcareLogo} alt="HorCare" style={{ width: 72, height: 72, borderRadius: 16, marginBottom: '1.25rem' }} />
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
          <Link2Off size={24} color="#DC2626" />
        </div>
        <h2 style={{ fontWeight: 800, color: '#111827', margin: '0 0 0.5rem' }}>ลิงก์ไม่ถูกต้อง</h2>
        <p style={{ color: '#6B7280', fontSize: '0.9rem', textAlign: 'center' }}>กรุณาใช้ลิงก์ที่ได้รับจากเจ้าของหอพักโดยตรง</p>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}>
        <img src={horcareLogo} alt="HorCare" style={{ width: 80, height: 80, borderRadius: 20, marginBottom: '1.5rem', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }} />
        <div style={{ width: 36, height: 36, border: '3px solid rgba(255,255,255,0.25)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: '1rem' }} />
        <p style={{ color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>กำลังโหลด...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Error ──
  if (error || !room) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <img src={horcareLogo} alt="HorCare" style={{ width: 64, height: 64, borderRadius: 14, marginBottom: '1.25rem' }} />
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
          <AlertCircle size={24} color="#DC2626" />
        </div>
        <h2 style={{ fontWeight: 800, color: '#111827', margin: '0 0 0.5rem' }}>{error ?? 'ไม่พบข้อมูล'}</h2>
        <p style={{ color: '#6B7280', fontSize: '0.875rem' }}>กรุณาติดต่อเจ้าของหอพัก</p>
      </div>
    );
  }

  // ── Main Portal ──
  return (
    <div className="portal-shell" style={{ minHeight: '100vh', background: '#E8EBF0', fontFamily: "'Sarabun', 'Inter', sans-serif" }}>
    <div style={{ maxWidth: 600, margin: '0 auto', background: '#F3F4F6', minHeight: '100vh' }}>

      {/* ── Hero ── */}
      <div style={{
        background: 'linear-gradient(135deg, #4F46E5 0%, #6D28D9 50%, #7C3AED 100%)',
        padding: '1.5rem 1.25rem 2.5rem',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Background circles */}
        <div style={{ position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ position: 'absolute', bottom: -30, left: -30, width: 140, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />

        {/* Top bar: logo + building name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '1.375rem' }}>
          <img src={horcareLogo} alt="HorCare"
            style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.25)' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: 'rgba(255,255,255,0.75)', fontSize: '0.8125rem' }}>
            <Building2 size={13} />
            <span>{buildingName || 'HorCare'}</span>
          </div>
        </div>

        {/* Tenant identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: 56, height: 56, borderRadius: '16px', flexShrink: 0,
            background: 'rgba(255,255,255,0.18)',
            border: '2px solid rgba(255,255,255,0.25)',
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.5rem', fontWeight: 900, color: '#fff',
          }}>
            {profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : <Home size={24} color="#fff" />}
          </div>
          <div>
            <div style={{ color: '#fff', fontWeight: 900, fontSize: '1.25rem', lineHeight: 1.2 }}>
              {profile?.full_name ?? 'ผู้เช่า'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.825rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <Home size={12} /> ห้อง {room.room_number}
              {profile?.phone && (
                <><span style={{ opacity: 0.4 }}>·</span> <Phone size={11} /> {profile.phone}</>
              )}
            </div>
          </div>
        </div>

        {/* Stats pills */}
        <div style={{ display: 'flex', gap: '0.625rem', marginTop: '1.25rem', flexWrap: 'wrap' }}>
          {[
            { label: 'ค่าเช่า', value: fmtCurrency(room.rent_amount) },
            { label: 'เดือนนี้', value: currentBill ? fmtCurrency(currentBill.total_bill) : '—' },
            {
              label: 'สถานะ',
              value: currentBill?.payment_status === 'paid' ? 'ชำระแล้ว'
                : currentBill?.payment_status === 'pending' ? 'รอตรวจสอบ'
                : 'ค้างชำระ',
              Icon: currentBill?.payment_status === 'paid' ? CheckCircle2
                : currentBill?.payment_status === 'pending' ? Clock
                : XCircle,
            },
          ].map((s, i) => (
            <div key={i} style={{
              flex: 1, minWidth: 80,
              background: 'rgba(255,255,255,0.13)',
              backdropFilter: 'blur(8px)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: '12px', padding: '0.625rem 0.75rem',
            }}>
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.68rem', fontWeight: 600, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
              <div style={{ color: '#fff', fontWeight: 800, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                {s.Icon && <s.Icon size={13} />} {s.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bills section ── */}
      <div style={{ padding: '0 1rem 2.5rem', marginTop: '0' }}>

        {/* Current month */}
        <section>
          <SectionLabel icon={<Receipt size={14} />} label={`บิลเดือน ${fmtMonth(currentMonth)}`} />
          {currentBill ? (
            <BillCard bill={currentBill} config={config} defaultOpen={true} promptpay={promptpay} />
          ) : (
            <div style={{
              background: '#fff', borderRadius: '16px', padding: '1.5rem',
              border: '1px solid #E5E7EB', textAlign: 'center',
              boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
            }}>
              <Receipt size={28} color="#D1D5DB" style={{ marginBottom: '0.5rem' }} />
              <p style={{ color: '#9CA3AF', fontSize: '0.875rem', margin: 0 }}>
                ยังไม่มีบิลสำหรับ{fmtMonth(currentMonth)}
              </p>
            </div>
          )}
        </section>

        {/* PromptPay standalone (when no bill yet) */}
        {!currentBill && promptpay.number && (
          <section>
            <SectionLabel icon={<CreditCard size={14} />} label="ช่องทางชำระเงิน" />
            <PromptPayCard number={promptpay.number} name={promptpay.name} amount={room.rent_amount} />
          </section>
        )}

        {/* History */}
        {prevBills.length > 0 && (
          <section>
            <SectionLabel icon={<CalendarDays size={14} />} label={`ประวัติบิล (${prevBills.length} เดือน)`} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              {prevBills.map(b => (
                <BillCard key={b.id} bill={b} config={config} defaultOpen={false} promptpay={promptpay} />
              ))}
            </div>
          </section>
        )}

        {/* Contact */}
        {config?.bill_customization?.dorm_phone && (
          <section>
            <div style={{
              background: '#fff', borderRadius: '14px', padding: '0.875rem 1rem',
              border: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: '0.75rem',
              boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
            }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Phone size={16} color="#fff" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#111827' }}>ติดต่อหอพัก</div>
                <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>{config.bill_customization.dorm_phone}</div>
              </div>
              <a href={`tel:${config.bill_customization.dorm_phone}`}
                style={{ background: 'linear-gradient(135deg,#4F46E5,#7C3AED)', color: '#fff', borderRadius: '10px', padding: '0.425rem 1rem', fontWeight: 700, fontSize: '0.8125rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Phone size={13} /> โทร
              </a>
            </div>
          </section>
        )}

        {/* Maintenance */}
        <section>
          <SectionLabel icon={<Wrench size={14} />} label="แจ้งซ่อม" />
          <MaintenanceSection
            uid={uid}
            buildingId={buildingId}
            roomId={roomId}
            roomNumber={room.room_number}
          />
        </section>

        {/* Footer */}
        <div style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', opacity: 0.45 }}>
          <img src={horcareLogo} alt="" style={{ width: 20, height: 20, borderRadius: 5 }} />
          <span style={{ fontSize: '0.75rem', color: '#6B7280', fontWeight: 600 }}>Powered by HorCare</span>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800;900&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (min-width: 640px) {
          .portal-shell { padding: 1.5rem 0; }
          .portal-shell > div { border-radius: 20px; overflow: hidden; box-shadow: 0 8px 48px rgba(0,0,0,0.14); min-height: auto !important; }
        }
      `}</style>
    </div>
    </div>
  );
}

// ── Maintenance section (shown in tenant portal) ──────────────────────────────
function MaintenanceSection({ uid, buildingId, roomId, roomNumber }: {
  uid: string; buildingId: string; roomId: string; roomNumber: string;
}) {
  const { requests, loading } = useRoomMaintenance(uid, buildingId, roomId);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState<{
    category: MaintenanceCategory; description: string; urgency: 'urgent' | 'normal';
  }>({ category: 'other', description: '', urgency: 'normal' });

  const handleSubmit = async () => {
    if (!form.description.trim()) return;
    setSubmitting(true);
    try {
      await addDoc(collection(db, `users/${uid}/buildings/${buildingId}/maintenance`), {
        room_id: roomId,
        room_number: roomNumber,
        category: form.category,
        description: form.description.trim(),
        urgency: form.urgency,
        status: 'open',
        created_at: new Date().toISOString(),
      });
      setForm({ category: 'other', description: '', urgency: 'normal' });
      setShowForm(false);
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 4000);
    } catch (e: any) {
      console.error(e);
      alert('Error submitting request: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* Success toast */}
      {submitted && (
        <div style={{
          background: '#D1FAE5', color: '#059669', border: '1px solid #6EE7B7',
          borderRadius: '12px', padding: '0.75rem 1rem', marginBottom: '0.75rem',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          fontSize: '0.875rem', fontWeight: 600,
        }}>
          <CheckCircle2 size={16} /> ส่งคำขอแจ้งซ่อมเรียบร้อยแล้ว
        </div>
      )}

      {/* Existing requests */}
      {!loading && requests.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.875rem' }}>
          {requests.map(req => {
            const catOpt = PORTAL_CATEGORY_OPTIONS.find(c => c.value === req.category);
            const st = PORTAL_STATUS_CFG[req.status] ?? PORTAL_STATUS_CFG.open;
            return (
              <div key={req.id} style={{
                background: '#fff', borderRadius: '12px', padding: '0.75rem 1rem',
                border: '1px solid #E5E7EB', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem', flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8125rem', fontWeight: 600, color: '#374151' }}>
                    {catOpt && <catOpt.Icon size={13} color={catOpt.color} />}
                    {catOpt?.label ?? req.category}
                  </span>
                  {req.urgency === 'urgent' && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem', fontWeight: 700, color: '#DC2626', background: '#FEE2E2', padding: '0.1rem 0.4rem', borderRadius: '6px' }}>
                      <AlertTriangle size={11} /> ด่วน
                    </span>
                  )}
                  <span style={{
                    marginLeft: 'auto', fontSize: '0.75rem', fontWeight: 700,
                    color: st.color, background: st.bg,
                    padding: '0.15rem 0.5rem', borderRadius: '6px',
                  }}>
                    {st.label}
                  </span>
                </div>
                <p style={{ fontSize: '0.8125rem', color: '#6B7280', margin: 0, lineHeight: 1.5 }}>
                  {req.description}
                </p>
                {req.admin_note && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#374151', borderLeft: '3px solid #8B5CF6', paddingLeft: '0.625rem', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: '0.3rem' }}>
                    <Pencil size={11} color="#8B5CF6" style={{ marginTop: '0.15rem', flexShrink: 0 }} />
                    {req.admin_note}
                  </div>
                )}
                <div style={{ fontSize: '0.7rem', color: '#9CA3AF', marginTop: '0.375rem' }}>
                  {new Date(req.created_at).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form / button */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          style={{
            width: '100%', background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
            color: '#fff', border: 'none', borderRadius: '14px',
            padding: '0.875rem', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            boxShadow: '0 2px 12px rgba(79,70,229,0.25)',
          }}
        >
          <Plus size={18} /> แจ้งซ่อมใหม่
        </button>
      ) : (
        <div style={{
          background: '#fff', borderRadius: '16px', padding: '1.125rem',
          border: '1px solid #E5E7EB', boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        }}>
          <h3 style={{ fontWeight: 800, fontSize: '0.9375rem', color: '#111827', margin: '0 0 1rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Wrench size={16} /> แจ้งซ่อมใหม่
          </h3>

          {/* Category grid */}
          <div style={{ marginBottom: '0.875rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6B7280', display: 'block', marginBottom: '0.4rem' }}>ประเภทปัญหา</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.375rem' }}>
              {PORTAL_CATEGORY_OPTIONS.map(opt => {
                const active = form.category === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => setForm(f => ({ ...f, category: opt.value }))}
                    style={{
                      padding: '0.5rem 0.25rem', borderRadius: '10px', cursor: 'pointer',
                      border: active ? `2px solid ${opt.color}` : '1.5px solid #E5E7EB',
                      background: active ? `${opt.color}18` : '#fff',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem',
                      transition: 'all 0.15s',
                    }}
                  >
                    <opt.Icon size={18} color={active ? opt.color : '#9CA3AF'} />
                    <span style={{ fontSize: '0.62rem', textAlign: 'center', lineHeight: 1.2, fontWeight: active ? 700 : 500, color: active ? opt.color : '#374151' }}>
                      {opt.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Urgency */}
          <div style={{ marginBottom: '0.875rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6B7280', display: 'block', marginBottom: '0.4rem' }}>ความเร่งด่วน</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {([
                { value: 'normal', label: 'ปกติ',   dotColor: '#16A34A' },
                { value: 'urgent', label: 'ด่วนมาก', dotColor: '#DC2626' },
              ] as const).map(u => {
                const active = form.urgency === u.value;
                const borderColor = active ? (u.value === 'urgent' ? '#DC2626' : '#4F46E5') : '#E5E7EB';
                const bgColor    = active ? (u.value === 'urgent' ? 'rgba(220,38,38,0.08)' : 'rgba(79,70,229,0.08)') : '#fff';
                const textColor  = active ? (u.value === 'urgent' ? '#DC2626' : '#4F46E5') : '#374151';
                return (
                  <button
                    key={u.value}
                    onClick={() => setForm(f => ({ ...f, urgency: u.value }))}
                    style={{
                      flex: 1, padding: '0.625rem', borderRadius: '10px', cursor: 'pointer',
                      border: `${active ? '2px' : '1.5px'} solid ${borderColor}`,
                      background: bgColor,
                      fontWeight: active ? 700 : 500,
                      color: textColor, fontSize: '0.875rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: u.dotColor, flexShrink: 0 }} />
                    {u.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6B7280', display: 'block', marginBottom: '0.4rem' }}>
              รายละเอียดปัญหา *
            </label>
            <textarea
              rows={3}
              placeholder={'อธิบายปัญหา เช่น "ไฟในห้องน้ำดับ เปิดสวิตช์ไม่ติด"'}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{
                width: '100%', borderRadius: '10px', border: '1.5px solid #E5E7EB',
                padding: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6, outline: 'none',
                resize: 'vertical', minHeight: '80px',
                fontFamily: "'Sarabun', 'Inter', sans-serif", boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={handleSubmit}
              disabled={submitting || !form.description.trim()}
              style={{
                flex: 1, background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                color: '#fff', border: 'none', borderRadius: '12px',
                padding: '0.875rem', fontWeight: 700, fontSize: '0.9375rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                opacity: submitting || !form.description.trim() ? 0.5 : 1,
              }}
            >
              {submitting
                ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /> กำลังส่ง...</>
                : <><Send size={16} /> ส่งคำขอ</>
              }
            </button>
            <button
              onClick={() => setShowForm(false)}
              style={{
                padding: '0.875rem 1.25rem', borderRadius: '12px', cursor: 'pointer',
                background: '#F3F4F6', border: '1px solid #E5E7EB',
                color: '#6B7280', fontWeight: 600, fontSize: '0.875rem',
              }}
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section label helper ──────────────────────────────────────────────────────
function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '1.25rem 0 0.625rem' }}>
      {icon} {label}
    </div>
  );
}
