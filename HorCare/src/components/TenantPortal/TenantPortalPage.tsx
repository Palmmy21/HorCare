import { useState, useEffect, useRef } from 'react';
import {
  collection, doc, onSnapshot, query, where, addDoc, setDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Room, DormConfig, MonthlyBill, TenantProfile, MaintenanceRequest, MaintenanceCategory, Fine, BillLanguage, CleaningRequest, CleaningServiceType } from '../../types';
import {
  PORTAL_TRANSLATIONS,
  LANGUAGE_OPTIONS,
  formatPortalMonth,
  formatPortalDate,
  translateCategory,
  translateMaintenanceStatus,
} from '../../utils/i18n/portalTranslations';
import {
  Home, Zap, Droplets, Phone, ChevronDown, ChevronUp,
  CheckCircle2, XCircle, Clock, AlertCircle, Link2Off,
  Building2, CalendarDays, CreditCard, Receipt,
  Wrench, Plus, AlertTriangle, Plug, Wind, DoorOpen,
  Bath, Armchair, Send, Pencil, Camera, X as XIcon,
  User, Save, Heart, Lock, Sparkles,
} from 'lucide-react';
import horcareLogo from '../../assets/horcare_logo.png';
import { QRCodeSVG } from 'qrcode.react';
import generatePayload from 'promptpay-qr';
import { PROMPTPAY_LOGO_DATA_URI } from '../../assets/promptpayLogo';
import toast from 'react-hot-toast';

// ── Image compression (canvas) ────────────────────────────────────────────────
async function compressImageToBase64(file: File, maxPx = 900, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n?: number) {
  if (n === undefined || n === null) return '—';
  return n.toLocaleString('th-TH');
}
function fmtCurrency(n?: number) {
  if (n === undefined || n === null) return '—';
  return `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
}
function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Maintenance config ────────────────────────────────────────────────────────
const PORTAL_CATEGORY_OPTIONS: { value: MaintenanceCategory; Icon: React.ElementType; color: string }[] = [
  { value: 'electric',    Icon: Zap,      color: '#F59E0B' },
  { value: 'plumbing',    Icon: Droplets, color: '#0EA5E9' },
  { value: 'appliance',   Icon: Plug,     color: '#F97316' },
  { value: 'ac',          Icon: Wind,     color: '#06B6D4' },
  { value: 'door_window', Icon: DoorOpen, color: 'var(--color-gray-500)' },
  { value: 'bathroom',    Icon: Bath,     color: '#0EA5E9' },
  { value: 'furniture',   Icon: Armchair, color: '#92400E' },
  { value: 'other',       Icon: Wrench,   color: 'var(--color-gray-700)' },
];

function getStatusCfg(status: string, lang: BillLanguage) {
  const base = {
    open:        { color: '#DC2626', bg: '#FEE2E2' },
    in_progress: { color: '#D97706', bg: '#FEF3C7' },
    done:        { color: '#059669', bg: '#D1FAE5' },
    rejected:    { color: 'var(--color-gray-500)', bg: 'var(--color-gray-100)' },
  }[status] ?? { color: 'var(--color-gray-500)', bg: 'var(--color-gray-100)' };

  return {
    ...base,
    label: translateMaintenanceStatus(status, lang)
  };
}

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

// ── Cleaning hook (room-scoped) ───────────────────────────────────────────────
function useRoomCleaning(uid: string, buildingId: string, roomId: string) {
  const [requests, setRequests] = useState<CleaningRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, `users/${uid}/buildings/${buildingId}/cleaning`),
      where('room_id', '==', roomId),
    );
    const unsub = onSnapshot(q,
      snap => {
        const docs = snap.docs.map(d => ({ ...d.data(), id: d.id } as CleaningRequest));
        docs.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
        setRequests(docs);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [uid, buildingId, roomId]);

  return { requests, loading };
}

// ── Load tenant data ──────────────────────────────────────────────────────────
interface PortalData {
  room: Room | null;
  config: DormConfig | null;
  profile: TenantProfile | null;
  bills: MonthlyBill[];
  fines: Fine[];
  buildingName: string;
}

function useTenantData(uid: string, buildingId: string, roomId: string) {
  const [data, setData] = useState<PortalData>({ room: null, config: null, profile: null, bills: [], fines: [], buildingName: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const basePath = `users/${uid}/buildings/${buildingId}`;

  useEffect(() => {
    const done = { room: false, config: false, bills: false, profile: false };
    const trySettle = () => { if (Object.values(done).every(Boolean)) setLoading(false); };

    const u1 = onSnapshot(doc(db, basePath, 'rooms', roomId),
      s => { done.room = true; setData(d => ({ ...d, room: s.exists() ? { ...s.data(), id: s.id } as Room : null })); trySettle(); },
      () => { done.room = true; setError('room_error'); trySettle(); });

    const u2 = onSnapshot(doc(db, basePath, 'data', 'config'),
      s => { done.config = true; setData(d => ({ ...d, config: s.exists() ? s.data() as DormConfig : null })); trySettle(); },
      () => { done.config = true; trySettle(); });

    const u3 = onSnapshot(doc(db, basePath, 'tenants', roomId),
      s => { done.profile = true; setData(d => ({ ...d, profile: s.exists() ? s.data() as TenantProfile : null })); trySettle(); },
      () => { done.profile = true; trySettle(); });

    const u4 = onSnapshot(
      query(collection(db, basePath, 'bills'), where('room_id', '==', roomId)),
      s => {
        const all = s.docs.map(b => ({ ...b.data(), id: b.id } as MonthlyBill));
        all.sort((a, b) => b.month.localeCompare(a.month));
        done.bills = true;
        setData(d => ({ ...d, bills: all }));
        trySettle();
      },
      () => { done.bills = true; trySettle(); });

    const u5 = onSnapshot(doc(db, `users/${uid}/buildings`, buildingId),
      s => { if (s.exists()) setData(d => ({ ...d, buildingName: s.data().name ?? '' })); });

    const u6 = onSnapshot(
      query(collection(db, basePath, 'fines'), where('room_id', '==', roomId)),
      s => {
        const allFines = s.docs.map(d => ({ ...d.data(), id: d.id } as Fine));
        allFines.sort((a, b) => b.date.localeCompare(a.date));
        setData(d => ({ ...d, fines: allFines }));
      }
    );

    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, [uid, buildingId, roomId, basePath]);

  return { data, loading, error };
}

// ── Language Selector Component ───────────────────────────────────────────────
export function PortalLanguageSelector({
  lang,
  onSelect,
  variant = 'hero',
}: {
  lang: BillLanguage;
  onSelect: (l: BillLanguage) => void;
  variant?: 'hero' | 'card';
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const currentOpt = LANGUAGE_OPTIONS.find(o => o.code === lang) ?? LANGUAGE_OPTIONS[0];

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setOpen(v => !v)}
        type="button"
        aria-label="Change language"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          background: variant === 'hero' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.95)',
          border: variant === 'hero' ? '1px solid rgba(255, 255, 255, 0.45)' : '1.5px solid #BAE6FD',
          color: variant === 'hero' ? '#FFFFFF' : '#0369A1',
          padding: '0.35rem 0.75rem',
          borderRadius: '9999px',
          fontWeight: 700,
          fontSize: '0.8125rem',
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          boxShadow: variant === 'hero' ? '0 2px 8px rgba(0,0,0,0.06)' : '0 2px 10px rgba(14, 165, 233, 0.12)',
          transition: 'all 0.15s ease',
        }}
      >
        <span style={{ fontSize: '1.05rem', lineHeight: 1 }}>{currentOpt.flag}</span>
        <span>{currentOpt.nativeName}</span>
        <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', opacity: 0.8 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          zIndex: 999,
          minWidth: '175px',
          background: '#FFFFFF',
          borderRadius: '16px',
          padding: '0.45rem',
          boxShadow: '0 12px 32px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(0, 0, 0, 0.06)',
          border: '1px solid #E2E8F0',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.2rem',
          animation: 'scaleIn 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          {LANGUAGE_OPTIONS.map(opt => {
            const isSelected = opt.code === lang;
            return (
              <button
                key={opt.code}
                type="button"
                onClick={() => {
                  onSelect(opt.code);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.55rem 0.75rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: isSelected ? 'rgba(14, 165, 233, 0.1)' : 'transparent',
                  color: isSelected ? '#0284C7' : '#1E293B',
                  fontWeight: isSelected ? 700 : 500,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#F8FAFC';
                }}
                onMouseLeave={e => {
                  if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>{opt.flag}</span>
                  <span>{opt.nativeName}</span>
                </span>
                {isSelected && <CheckCircle2 size={15} color="#0EA5E9" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Payment Status component ─────────────────────────────────────────────────
function PaymentStatus({ status, lang }: { status?: string; lang: BillLanguage }) {
  const t = PORTAL_TRANSLATIONS[lang] ?? PORTAL_TRANSLATIONS.th;
  const cfg = {
    paid:    { label: t.paid,    Icon: CheckCircle2, bg: '#DCFCE7', color: '#16A34A', border: '#86EFAC' },
    pending: { label: t.pending, Icon: Clock,        bg: '#FEF9C3', color: '#92400E', border: '#FDE047' },
    unpaid:  { label: t.unpaid,  Icon: XCircle,      bg: '#FEE2E2', color: '#B91C1C', border: '#FCA5A5' },
  }[status ?? 'unpaid'] ?? { label: t.unpaid, Icon: XCircle, bg: '#FEE2E2', color: '#B91C1C', border: '#FCA5A5' };
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
function PromptPayCard({ number, name, amount, title, lang }: { number: string; name: string; amount: number; title?: string; lang: BillLanguage }) {
  const t = PORTAL_TRANSLATIONS[lang] ?? PORTAL_TRANSLATIONS.th;
  return (
    <div style={{
      background: 'linear-gradient(135deg, #034A6E 0%, #0369A1 100%)',
      borderRadius: '20px',
      padding: '1.25rem',
      color: '#FFFFFF',
      boxShadow: '0 8px 24px -4px rgba(3, 105, 161, 0.35)',
      marginTop: '0.75rem',
      textAlign: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.8125rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.875rem' }}>
        <CreditCard size={14} /> {title || t.scan_qr}
      </div>

      {/* QR Code Container */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: '16px',
        padding: '0.875rem',
        display: 'inline-block',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      }}>
        <QRCodeSVG
          value={generatePayload(number, { amount })}
          size={168}
          imageSettings={{
            src: PROMPTPAY_LOGO_DATA_URI,
            x: undefined,
            y: undefined,
            height: 36,
            width: 36,
            excavate: true,
          }}
        />
      </div>

      <div style={{ marginTop: '0.875rem' }}>
        <div style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#38BDF8' }}>
          {fmtCurrency(amount)}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.85)', marginTop: '0.2rem' }}>
          PromptPay: <strong>{number}</strong> {name ? `(${name})` : ''}
        </div>
      </div>
    </div>
  );
}

// ── Slip Uploader ─────────────────────────────────────────────────────────────
function SlipUploader({
  uid, buildingId, roomId, itemId, itemType, lang,
}: {
  uid: string; buildingId: string; roomId: string; itemId: string; itemType: 'bill' | 'fine'; lang: BillLanguage;
}) {
  const t = PORTAL_TRANSLATIONS[lang] ?? PORTAL_TRANSLATIONS.th;
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const base64 = await compressImageToBase64(file);
      const res = await fetch('/api/upload-slip?route=upload-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, buildingId, roomId, itemId, itemType, base64 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      toast.success(data.autoVerified ? t.slip_success_auto : t.slip_success_wait);
    } catch (err: any) {
      toast.error(`${t.slip_fail}: ${err.message}`);
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div style={{ marginTop: '0.75rem' }}>
      <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} style={{ display: 'none' }} />
      <button
        disabled={loading}
        onClick={() => fileInputRef.current?.click()}
        style={{
          width: '100%', padding: '0.75rem', borderRadius: '12px',
          background: 'linear-gradient(135deg, #0EA5E9, #10B981)',
          color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.875rem',
          cursor: loading ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
          boxShadow: '0 4px 14px rgba(14,165,233,0.3)',
          opacity: loading ? 0.7 : 1
        }}
      >
        {loading ? <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /> : <Camera size={16} />}
        {loading ? t.uploading_slip : t.attach_slip}
      </button>
    </div>
  );
}

// ── Bill Card ─────────────────────────────────────────────────────────────────
function BillCard({ bill, defaultOpen, promptpay, portalIds, lang }: {
  bill: MonthlyBill;
  defaultOpen: boolean; promptpay: { number: string; name: string };
  portalIds: { uid: string, buildingId: string, roomId: string };
  lang: BillLanguage;
}) {
  const t = PORTAL_TRANSLATIONS[lang] ?? PORTAL_TRANSLATIONS.th;
  const [open, setOpen] = useState(defaultOpen);
  const isUnpaid = !bill.payment_status || bill.payment_status === 'unpaid';
  const isPaid = bill.payment_status === 'paid';

  const accentColor = isPaid ? '#16A34A' : isUnpaid ? '#DC2626' : '#92400E';
  const borderColor = isPaid ? '#BBF7D0' : isUnpaid ? '#FECACA' : '#FDE047';

  return (
    <div style={{
      background: 'var(--color-white)', borderRadius: '16px',
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
            <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'var(--color-gray-800)' }}>
              {formatPortalMonth(bill.month, lang)}
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)', marginTop: '0.2rem' }}>
            {t.total_with_amount} {fmtCurrency(bill.total_bill)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <PaymentStatus status={bill.payment_status} lang={lang} />
          {open ? <ChevronUp size={16} color="#9CA3AF" /> : <ChevronDown size={16} color="#9CA3AF" />}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '0 1.125rem 1.125rem', borderTop: '1px solid var(--color-gray-100)' }}>
          {/* Cost breakdown */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.75rem' }}>
            <tbody>
              {[
                { label: t.room_rent, value: bill.room_rent, icon: <Home size={13} color="#0EA5E9" /> },
                { label: `${t.elec_bill} (${fmt(bill.elec_units)} ${t.unit})`, value: bill.elec_bill, icon: <Zap size={13} color="#F59E0B" /> },
                ...(bill.water_flat_amount ? [{ label: t.water_flat, value: bill.water_flat_amount, icon: <Droplets size={13} color="#0EA5E9" /> }] : []),
                ...(bill.water_excess_amount ? [{ label: `${t.water_excess} (${fmt(bill.water_excess_units)} ${t.unit})`, value: bill.water_excess_amount, icon: <Droplets size={13} color="#0284C7" /> }] : []),
                ...(!bill.water_flat_amount ? [{ label: `${t.water_bill} (${fmt(bill.water_units)} ${t.unit})`, value: bill.water_bill, icon: <Droplets size={13} color="#0EA5E9" /> }] : []),
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-gray-100)' }}>
                  <td style={{ padding: '0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem', color: 'var(--color-gray-700)' }}>
                    {row.icon} {row.label}
                  </td>
                  <td style={{ padding: '0.5rem 0', textAlign: 'right', fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-gray-800)' }}>
                    {fmtCurrency(row.value)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td style={{ paddingTop: '0.625rem', fontWeight: 800, fontSize: '0.9375rem', color: 'var(--color-gray-800)' }}>{t.grand_total}</td>
                <td style={{ paddingTop: '0.625rem', textAlign: 'right', fontWeight: 800, fontSize: '0.9375rem', color: '#0EA5E9' }}>{fmtCurrency(bill.total_bill)}</td>
              </tr>
            </tfoot>
          </table>

          {/* Meter readings */}
          <div style={{ marginTop: '0.875rem', padding: '0.75rem', background: 'var(--color-gray-50)', borderRadius: '12px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-gray-400)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.meter_readings}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8rem', color: 'var(--color-gray-700)' }}>
                  <Zap size={13} color="#F59E0B" /> {t.elec_meter}
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.825rem', color: 'var(--color-gray-800)', fontWeight: 600 }}>
                  {fmt(bill.prev_elec)} → {fmt(bill.curr_elec)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8rem', color: 'var(--color-gray-700)' }}>
                  <Droplets size={13} color="#3B82F6" /> {t.water_meter}
                </span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.825rem', color: 'var(--color-gray-800)', fontWeight: 600 }}>
                  {fmt(bill.prev_water)} → {fmt(bill.curr_water)}
                </span>
              </div>
            </div>
          </div>

          {/* QR for unpaid */}
          {isUnpaid && promptpay.number && (
            <div style={{ marginTop: '1rem' }}>
              <PromptPayCard number={promptpay.number} name={promptpay.name} amount={bill.total_bill} title={t.scan_qr} lang={lang} />
              <SlipUploader
                uid={portalIds.uid} buildingId={portalIds.buildingId} roomId={portalIds.roomId}
                itemId={bill.id} itemType="bill" lang={lang}
              />
            </div>
          )}

          {/* Pending confirmation */}
          {bill.payment_status === 'pending' && (
            <div style={{ marginTop: '0.875rem', padding: '0.75rem', background: '#FEF9C3', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={16} color="#B45309" />
              <span style={{ fontSize: '0.8125rem', color: '#92400E', fontWeight: 600 }}>{t.fine_wait_verify}</span>
            </div>
          )}

          {/* Paid confirmation */}
          {isPaid && (
            <div style={{ marginTop: '0.875rem', padding: '0.75rem', background: '#F0FDF4', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={16} color="#16A34A" />
              <span style={{ fontSize: '0.8125rem', color: '#15803D', fontWeight: 600 }}>
                {t.fine_paid_on} {formatPortalDate(bill.paid_at, lang)}
                {bill.paid_method === 'auto' ? ` ${t.auto_verified}` : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Fine Card ─────────────────────────────────────────────────────────────────
function FineCard({ fine, promptpay, portalIds, lang }: { fine: Fine; promptpay: { number: string; name: string }; portalIds: { uid: string, buildingId: string, roomId: string }; lang: BillLanguage }) {
  const t = PORTAL_TRANSLATIONS[lang] ?? PORTAL_TRANSLATIONS.th;
  const [open, setOpen] = useState(fine.status !== 'paid');
  const isUnpaid = !fine.status || fine.status === 'unpaid';
  const isPaid = fine.status === 'paid';

  const accentColor = isPaid ? '#16A34A' : isUnpaid ? '#DC2626' : '#92400E';
  const borderColor = isPaid ? '#BBF7D0' : isUnpaid ? '#FECACA' : '#FDE047';

  return (
    <div style={{
      background: 'var(--color-white)', borderRadius: '16px',
      border: `1.5px solid ${borderColor}`,
      overflow: 'hidden', boxShadow: '0 1px 8px rgba(0,0,0,0.05)',
      marginTop: '0.75rem'
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
            <AlertTriangle size={15} color={accentColor} />
            <span style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'var(--color-gray-800)' }}>
              {t.fine_reason}: {fine.reason}
            </span>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)', marginTop: '0.2rem' }}>
            {t.total_with_amount} {fmtCurrency(fine.amount)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <PaymentStatus status={fine.status} lang={lang} />
          {open ? <ChevronUp size={16} color="#9CA3AF" /> : <ChevronDown size={16} color="#9CA3AF" />}
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '0 1.125rem 1.125rem', borderTop: '1px solid var(--color-gray-100)' }}>
          <div style={{ marginTop: '0.875rem', fontSize: '0.875rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
            <strong>{t.fine_date}:</strong> {formatPortalDate(fine.date, lang)}<br/>
            {fine.note && <><strong style={{ color: '#DC2626' }}>{t.fine_note}:</strong> {fine.note}</>}
          </div>

          {/* QR for unpaid */}
          {isUnpaid && promptpay.number && (
            <div style={{ marginTop: '1rem' }}>
              <PromptPayCard number={promptpay.number} name={promptpay.name} amount={fine.amount} title={t.scan_qr_fine} lang={lang} />
              <SlipUploader
                uid={portalIds.uid} buildingId={portalIds.buildingId} roomId={portalIds.roomId}
                itemId={fine.id} itemType="fine" lang={lang}
              />
            </div>
          )}

          {/* Pending confirmation */}
          {fine.status === 'pending' && (
            <div style={{ marginTop: '0.875rem', padding: '0.75rem', background: '#FEF9C3', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={16} color="#B45309" />
              <span style={{ fontSize: '0.8125rem', color: '#92400E', fontWeight: 600 }}>{t.fine_wait_verify}</span>
            </div>
          )}

          {/* Paid confirmation */}
          {isPaid && (
            <div style={{ marginTop: '0.875rem', padding: '0.75rem', background: '#F0FDF4', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <CheckCircle2 size={16} color="#16A34A" />
              <span style={{ fontSize: '0.8125rem', color: '#15803D', fontWeight: 600 }}>
                {t.fine_paid_on} {formatPortalDate(fine.paid_at, lang)}
                {fine.paid_method === 'auto' ? ` ${t.auto_verified}` : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tenant Profile Section ────────────────────────────────────────────────────
function TenantProfileSection({ uid, buildingId, roomId, profile, lang }: {
  uid: string; buildingId: string; roomId: string; profile: TenantProfile | null; lang: BillLanguage;
}) {
  const t = PORTAL_TRANSLATIONS[lang] ?? PORTAL_TRANSLATIONS.th;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    full_name: '', nickname: '', phone: '', occupation: '',
    emergency_name: '', emergency_phone: '', emergency_relation: '',
  });

  // Sync form with profile
  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name ?? '',
        nickname: profile.nickname ?? '',
        phone: profile.phone ?? '',
        occupation: profile.occupation ?? '',
        emergency_name: profile.emergency_name ?? '',
        emergency_phone: profile.emergency_phone ?? '',
        emergency_relation: profile.emergency_relation ?? '',
      });
    }
  }, [profile]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const ref = doc(db, `users/${uid}/buildings/${buildingId}/tenants`, roomId);
      const now = new Date().toISOString();
      const payload = {
        full_name: form.full_name.trim(),
        nickname: form.nickname.trim(),
        phone: form.phone.trim(),
        occupation: form.occupation.trim(),
        emergency_name: form.emergency_name.trim(),
        emergency_phone: form.emergency_phone.trim(),
        emergency_relation: form.emergency_relation.trim(),
        updated_at: now,
      };
      if (profile) {
        await updateDoc(ref, payload);
      } else {
        await setDoc(ref, {
          ...payload,
          id: roomId,
          room_id: roomId,
          building_id: buildingId,
          created_at: now,
        });
      }
      toast.success(t.profile_saved_toast);
      setEditing(false);
    } catch {
      toast.error(t.profile_error_toast);
    } finally {
      setSaving(false);
    }
  };

  const hasData = profile?.full_name || profile?.phone;

  const inputStyle = {
    width: '100%', padding: '0.625rem 0.75rem', borderRadius: '10px',
    border: '1.5px solid var(--color-gray-200)', fontSize: '0.875rem',
    fontFamily: 'var(--font-sans)', background: 'var(--color-white)',
    outline: 'none', boxSizing: 'border-box' as const,
    transition: 'border-color 0.15s',
  };
  const labelStyle = {
    fontSize: '0.75rem', fontWeight: 600 as const, color: 'var(--color-gray-500)',
    marginBottom: '0.25rem', display: 'block' as const,
  };
  const valueStyle = {
    fontSize: '0.875rem', color: 'var(--color-gray-800)', fontWeight: 600 as const,
  };

  return (
    <div style={{
      background: 'var(--color-white)', borderRadius: '16px', padding: '1.25rem',
      border: '1px solid var(--color-gray-200)', boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: editing ? '1rem' : hasData ? '0.875rem' : '0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'linear-gradient(135deg, #0EA5E9, #10B981)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <User size={16} color="#fff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: 'var(--color-gray-800)' }}>
            {t.personal_info}
          </span>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            style={{
              background: 'var(--color-gray-100)', border: '1px solid var(--color-gray-200)',
              borderRadius: '8px', padding: '0.35rem 0.75rem',
              fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-gray-600)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem',
              transition: 'all 0.15s',
            }}
          >
            <Pencil size={12} /> {hasData ? t.edit : t.add_info}
          </button>
        )}
      </div>

      {/* View Mode */}
      {!editing && hasData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          {profile?.full_name && (
            <div><span style={labelStyle}>{t.full_name}</span><span style={valueStyle}>{profile.full_name}</span></div>
          )}
          {profile?.nickname && (
            <div><span style={labelStyle}>{t.nickname}</span><span style={valueStyle}>{profile.nickname}</span></div>
          )}
          {profile?.phone && (
            <div><span style={labelStyle}>{t.phone}</span><span style={valueStyle}>{profile.phone}</span></div>
          )}
          {profile?.occupation && (
            <div><span style={labelStyle}>{t.occupation}</span><span style={valueStyle}>{profile.occupation}</span></div>
          )}
          {(profile?.emergency_name || profile?.emergency_phone) && (
            <div style={{ gridColumn: '1 / -1', marginTop: '0.25rem', padding: '0.625rem', background: '#FEF2F2', borderRadius: '10px', border: '1px solid #FECACA' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.375rem' }}>
                <Heart size={12} color="#DC2626" />
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#DC2626' }}>{t.emergency_contact}</span>
              </div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {profile?.emergency_name && <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-700)' }}>{profile.emergency_name}{profile?.emergency_relation ? ` (${profile.emergency_relation})` : ''}</span>}
                {profile?.emergency_phone && <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-700)' }}><Phone size={11} style={{ verticalAlign: '-1px' }} /> {profile.emergency_phone}</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!editing && !hasData && (
        <div style={{ textAlign: 'center', padding: '0.75rem 0 0.25rem', color: 'var(--color-gray-400)', fontSize: '0.8125rem' }}>
          {t.no_profile_msg}
        </div>
      )}

      {/* Edit Mode */}
      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>{t.full_name} *</label>
            <input style={inputStyle} value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={labelStyle}>{t.nickname}</label>
              <input style={inputStyle} value={form.nickname}
                onChange={e => setForm(f => ({ ...f, nickname: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>{t.phone} *</label>
              <input style={inputStyle} type="tel" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>{t.occupation}</label>
            <input style={inputStyle} value={form.occupation}
              onChange={e => setForm(f => ({ ...f, occupation: e.target.value }))} />
          </div>

          {/* Emergency contact */}
          <div style={{ padding: '0.875rem', background: '#FEF2F2', borderRadius: '12px', border: '1px solid #FECACA' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.625rem' }}>
              <Heart size={13} color="#DC2626" />
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#DC2626' }}>{t.emergency_contact}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
                <div>
                  <label style={labelStyle}>{t.emergency_name}</label>
                  <input style={{ ...inputStyle, background: '#fff' }} value={form.emergency_name}
                    onChange={e => setForm(f => ({ ...f, emergency_name: e.target.value }))} />
                </div>
                <div>
                  <label style={labelStyle}>{t.emergency_relation}</label>
                  <input style={{ ...inputStyle, background: '#fff' }} value={form.emergency_relation}
                    onChange={e => setForm(f => ({ ...f, emergency_relation: e.target.value }))} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>{t.emergency_phone}</label>
                <input style={{ ...inputStyle, background: '#fff' }} type="tel" value={form.emergency_phone}
                  onChange={e => setForm(f => ({ ...f, emergency_phone: e.target.value }))} />
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
            <button
              onClick={() => { setEditing(false); if (profile) setForm({ full_name: profile.full_name ?? '', nickname: profile.nickname ?? '', phone: profile.phone ?? '', occupation: profile.occupation ?? '', emergency_name: profile.emergency_name ?? '', emergency_phone: profile.emergency_phone ?? '', emergency_relation: profile.emergency_relation ?? '' }); }}
              style={{
                flex: 1, padding: '0.75rem', borderRadius: '12px',
                border: '1.5px solid var(--color-gray-200)', background: 'var(--color-white)',
                fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-gray-600)',
                cursor: 'pointer',
              }}
            >
              {t.cancel}
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.full_name.trim() || !form.phone.trim()}
              style={{
                flex: 2, padding: '0.75rem', borderRadius: '12px', border: 'none',
                background: saving || !form.full_name.trim() || !form.phone.trim()
                  ? 'var(--color-gray-300)'
                  : 'linear-gradient(135deg, #0EA5E9, #10B981)',
                color: '#fff', fontWeight: 700, fontSize: '0.875rem',
                cursor: saving || !form.full_name.trim() || !form.phone.trim() ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
              }}
            >
              {saving
                ? <><span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /> {t.saving}</>
                : <><Save size={15} /> {t.save}</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TenantPortalPage() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid') ?? '';
  const buildingId = params.get('bid') ?? '';
  const roomId = params.get('rid') ?? '';

  const { data, loading, error } = useTenantData(uid, buildingId, roomId);
  const { room, config, profile, bills, buildingName } = data;

  // Language state management
  const [lang, setLang] = useState<BillLanguage>(() => {
    const urlLang = params.get('lang') as BillLanguage;
    if (urlLang && PORTAL_TRANSLATIONS[urlLang]) return urlLang;
    const saved = localStorage.getItem('horcare_tenant_lang') as BillLanguage;
    if (saved && PORTAL_TRANSLATIONS[saved]) return saved;
    return 'th';
  });

  // Sync with room preference or dorm default when loaded (if user hasn't explicitly saved a choice)
  useEffect(() => {
    const saved = localStorage.getItem('horcare_tenant_lang');
    if (!saved) {
      if (room?.language && PORTAL_TRANSLATIONS[room.language]) {
        setLang(room.language);
      } else if (config?.bill_customization?.default_language && PORTAL_TRANSLATIONS[config.bill_customization.default_language]) {
        setLang(config.bill_customization.default_language);
      }
    }
  }, [room?.language, config?.bill_customization?.default_language]);

  const handleLangChange = (newLang: BillLanguage) => {
    setLang(newLang);
    localStorage.setItem('horcare_tenant_lang', newLang);
  };

  const t = PORTAL_TRANSLATIONS[lang] ?? PORTAL_TRANSLATIONS.th;

  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [pinUnlocked, setPinUnlocked] = useState(false);

  const currentMonth = getCurrentMonth();
  const currentBill = bills.find(b => b.month === currentMonth);
  const prevBills = bills.filter(b => b.month !== currentMonth);
  const pendingFines = data.fines.filter(f => f.status !== 'paid');
  const paidFines = data.fines.filter(f => f.status === 'paid');

  const promptpay = {
    number: config?.bill_customization?.promptpay_number ?? '',
    name: config?.bill_customization?.promptpay_name ?? '',
  };

  // ── Invalid link ──
  if (!uid || !buildingId || !roomId) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', background: '#F8FAFC', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
          <PortalLanguageSelector lang={lang} onSelect={handleLangChange} variant="card" />
        </div>
        <img src={horcareLogo} alt="HorCare" style={{ width: 72, height: 72, borderRadius: 16, marginBottom: '1.25rem' }} />
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
          <Link2Off size={24} color="#DC2626" />
        </div>
        <h2 style={{ fontWeight: 800, color: 'var(--color-gray-800)', margin: '0 0 0.5rem' }}>{t.invalid_link}</h2>
        <p style={{ color: 'var(--color-gray-500)', fontSize: '0.9rem', textAlign: 'center' }}>{t.use_direct_link}</p>
      </div>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg, #E0F2FE 0%, #F0F9FF 50%, #F8FAFC 100%)', fontFamily: 'var(--font-sans)', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
          <PortalLanguageSelector lang={lang} onSelect={handleLangChange} variant="card" />
        </div>
        <img src={horcareLogo} alt="HorCare" style={{ width: 80, height: 80, borderRadius: 20, marginBottom: '1.5rem', boxShadow: '0 8px 32px rgba(14, 165, 233, 0.25)' }} />
        <div style={{ width: 36, height: 36, border: '3px solid rgba(14, 165, 233, 0.25)', borderTopColor: '#0EA5E9', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: '1rem' }} />
        <p style={{ color: '#0369A1', fontWeight: 700, fontSize: '0.95rem' }}>{t.loading}</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Error ──
  if (error || !room) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', background: 'linear-gradient(180deg, #E0F2FE 0%, #F0F9FF 50%, #F8FAFC 100%)', color: '#0F172A', fontFamily: 'var(--font-sans)', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
          <PortalLanguageSelector lang={lang} onSelect={handleLangChange} variant="card" />
        </div>
        <img src={horcareLogo} alt="HorCare" style={{ width: 64, height: 64, borderRadius: 14, marginBottom: '1.25rem' }} />
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem' }}>
          <AlertCircle size={24} color="#EF4444" />
        </div>
        <h2 style={{ fontWeight: 800, color: '#0F172A', margin: '0 0 0.5rem' }}>{t.error_title}</h2>
        <p style={{ color: '#64748B', fontSize: '0.875rem' }}>{t.contact_owner_hint}</p>
      </div>
    );
  }

  // ── PIN Gate ──
  const requiredPin = config?.portal_pin;
  if (requiredPin && !pinUnlocked) {
    const handlePinSubmit = () => {
      if (pinInput === requiredPin) {
        setPinUnlocked(true);
        setPinError(false);
      } else {
        setPinError(true);
        setPinInput('');
      }
    };
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', background: 'linear-gradient(180deg, #E0F2FE 0%, #F0F9FF 50%, #F8FAFC 100%)', fontFamily: 'var(--font-sans)', position: 'relative' }}>
        <div style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
          <PortalLanguageSelector lang={lang} onSelect={handleLangChange} variant="card" />
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes shake { 0%,100%{transform:translateX(0)} 20%,60%{transform:translateX(-6px)} 40%,80%{transform:translateX(6px)} }`}</style>
        <img src={horcareLogo} alt="HorCare" style={{ width: 72, height: 72, borderRadius: 18, marginBottom: '1.5rem', boxShadow: '0 8px 32px rgba(14, 165, 233, 0.25)' }} />
        <div style={{
          background: '#FFFFFF',
          borderRadius: '24px', padding: '2.25rem 2rem 2.5rem',
          border: '1px solid #BAE6FD',
          width: '100%', maxWidth: 360, textAlign: 'center',
          boxShadow: '0 20px 40px -10px rgba(14, 165, 233, 0.18), 0 1px 3px rgba(0, 0, 0, 0.05)',
          animation: pinError ? 'shake 0.4s ease' : 'none',
        }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(14, 165, 233, 0.1)', border: '1px solid rgba(14, 165, 233, 0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}><Lock size={26} color="#0EA5E9" /></div>
          <h2 style={{ fontWeight: 800, color: '#0F172A', margin: '0 0 0.375rem', fontSize: '1.25rem' }}>{t.verify_pin_title}</h2>
          <p style={{ color: '#64748B', fontSize: '0.875rem', margin: '0 0 1.5rem' }}>{t.verify_pin_desc}</p>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="• • • •"
            value={pinInput}
            onChange={e => { setPinInput(e.target.value.replace(/\D/g, '').slice(0, 4)); setPinError(false); }}
            onKeyDown={e => e.key === 'Enter' && handlePinSubmit()}
            style={{
              width: '100%', textAlign: 'center', fontSize: '2rem', letterSpacing: '0.5em',
              padding: '0.75rem 1rem', borderRadius: '14px', border: pinError ? '2px solid #EF4444' : '2px solid #BAE6FD',
              background: '#F8FAFC', color: '#0F172A', outline: 'none',
              fontFamily: 'monospace', boxSizing: 'border-box', marginBottom: '0.75rem',
            }}
            autoFocus
          />
          {pinError && <p style={{ color: '#EF4444', fontSize: '0.825rem', marginBottom: '0.75rem', fontWeight: 600 }}>{t.pin_incorrect}</p>}
          <button
            onClick={handlePinSubmit}
            disabled={pinInput.length !== 4}
            style={{
              width: '100%', padding: '0.875rem', borderRadius: '14px', border: 'none',
              background: pinInput.length === 4 ? 'linear-gradient(135deg, #0EA5E9 0%, #10B981 100%)' : '#E2E8F0',
              color: pinInput.length === 4 ? '#fff' : '#94A3B8',
              fontWeight: 800, fontSize: '1rem', cursor: pinInput.length === 4 ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              boxShadow: pinInput.length === 4 ? '0 4px 16px rgba(14, 165, 233, 0.35)' : 'none',
            }}
          >
            {t.enter_portal}
          </button>
        </div>
      </div>
    );
  }

  // ── Main Portal ──
  return (
    <div className="portal-shell" style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #E0F2FE 0%, #F0F9FF 320px, #F8FAFC 100%)',
      fontFamily: 'var(--font-sans)'
    }}>
      <div style={{
        maxWidth: 600,
        margin: '0 auto',
        background: '#FFFFFF',
        minHeight: '100vh',
        boxShadow: '0 20px 40px -10px rgba(14, 165, 233, 0.15)',
        borderLeft: '1px solid #E2E8F0',
        borderRight: '1px solid #E2E8F0'
      }}>

        {/* ── Hero ── */}
        <div style={{
          background: 'linear-gradient(135deg, #0284C7 0%, #0EA5E9 40%, #10B981 100%)',
          padding: '1.75rem 1.25rem 2rem',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 4px 20px rgba(14, 165, 233, 0.25)',
        }}>
          {/* Background glow effects */}
          <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255, 255, 255, 0.25) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: -30, left: -20, width: 180, height: 180, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16, 185, 129, 0.35) 0%, transparent 70%)', pointerEvents: 'none' }} />

          {/* Top bar: logo + building name + language switcher */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.625rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
              {config?.bill_customization?.dorm_logo ? (
                <img
                  src={config.bill_customization.dorm_logo}
                  alt="Dorm Logo"
                  style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'contain', flexShrink: 0, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', background: '#FFFFFF', padding: 2 }}
                />
              ) : (
                <img src={horcareLogo} alt="HorCare"
                  style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}
                />
              )}
              {/* Gen-Z Cyber Building Pill */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                background: 'rgba(255, 255, 255, 0.22)',
                border: '1px solid rgba(255, 255, 255, 0.45)',
                borderRadius: '9999px',
                padding: '0.35rem 0.85rem',
                backdropFilter: 'blur(8px)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#FFFFFF', boxShadow: '0 0 6px #FFFFFF', flexShrink: 0 }} />
                <Building2 size={13} color="#FFFFFF" style={{ flexShrink: 0 }} />
                <span style={{ color: '#FFFFFF', fontWeight: 700, fontSize: '0.8125rem', letterSpacing: '0.01em' }}>
                  {config?.bill_customization?.dorm_name || buildingName || 'HorCare'}
                </span>
              </div>
            </div>

            {/* Language Selector in Hero */}
            <PortalLanguageSelector lang={lang} onSelect={handleLangChange} variant="hero" />
          </div>

          {/* Tenant identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.25rem' }}>
            <div style={{
              width: 58, height: 58, borderRadius: '18px', flexShrink: 0,
              background: 'rgba(255, 255, 255, 0.25)',
              border: '1.5px solid rgba(255, 255, 255, 0.5)',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.1)',
              backdropFilter: 'blur(10px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.5rem', fontWeight: 800, color: '#FFFFFF',
            }}>
              {profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : <Home size={26} color="#FFFFFF" />}
            </div>
            <div>
              <div style={{ color: '#FFFFFF', fontWeight: 800, fontSize: '1.35rem', lineHeight: 1.2, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                {profile?.full_name ?? t.tenant}
              </div>
              <div style={{ color: 'rgba(255, 255, 255, 0.95)', fontSize: '0.825rem', marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', background: 'rgba(255, 255, 255, 0.2)', padding: '0.2rem 0.55rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.35)', color: '#FFFFFF', fontWeight: 700, fontSize: '0.8rem' }}>
                  <Home size={13} /> {t.room} {room.room_number}
                </span>
                {profile?.phone && (
                  <><span style={{ opacity: 0.5 }}>·</span> <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'rgba(255, 255, 255, 0.95)', fontWeight: 600 }}><Phone size={12} /> {profile.phone}</span></>
                )}
              </div>
            </div>
          </div>

          {/* Stats pills */}
          <div style={{ display: 'flex', gap: '0.625rem', marginTop: '1.35rem', flexWrap: 'wrap' }}>
            {[
              { label: t.rent, value: fmtCurrency(room.rent_amount) },
              { label: t.this_month, value: currentBill ? fmtCurrency(currentBill.total_bill) : '—' },
              {
                label: t.status,
                value: currentBill?.payment_status === 'paid' ? t.paid
                  : currentBill?.payment_status === 'pending' ? t.pending
                  : t.unpaid,
                Icon: currentBill?.payment_status === 'paid' ? CheckCircle2
                  : currentBill?.payment_status === 'pending' ? Clock
                  : XCircle,
              },
            ].map((s, i) => (
              <div key={i} style={{
                flex: 1, minWidth: 80,
                background: 'rgba(255, 255, 255, 0.22)',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(255, 255, 255, 0.4)',
                borderRadius: '14px', padding: '0.65rem 0.75rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              }}>
                <div style={{ color: 'rgba(255, 255, 255, 0.85)', fontSize: '0.7rem', fontWeight: 700, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
                <div style={{ color: '#FFFFFF', fontWeight: 800, fontSize: '0.925rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  {s.Icon && <s.Icon size={14} />} {s.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Main Body Sections ── */}
        <div style={{ padding: '0.75rem 1.125rem 3rem', background: '#F8FAFC' }}>

          {/* Personal info */}
          <section>
            <SectionLabel icon={<User size={14} />} label={t.personal_info} />
            <TenantProfileSection uid={uid} buildingId={buildingId} roomId={roomId} profile={profile} lang={lang} />
          </section>

          {/* Current month */}
          <section>
            <SectionLabel icon={<Receipt size={14} />} label={`${t.monthly_bill} ${formatPortalMonth(currentMonth, lang)}`} />
            {currentBill ? (
              <BillCard bill={currentBill} defaultOpen={true} promptpay={promptpay} portalIds={{uid, buildingId, roomId}} lang={lang} />
            ) : (
              <div style={{
                background: 'var(--color-white)', borderRadius: '16px', padding: '1.5rem',
                border: '1px solid var(--color-gray-200)', textAlign: 'center',
                boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
              }}>
                <Receipt size={28} color="#D1D5DB" style={{ marginBottom: '0.5rem' }} />
                <p style={{ color: 'var(--color-gray-400)', fontSize: '0.875rem', margin: 0 }}>
                  {t.no_bill_yet} {formatPortalMonth(currentMonth, lang)}
                </p>
              </div>
            )}
          </section>

          {/* PromptPay standalone (when no bill yet) */}
          {!currentBill && promptpay.number && (
            <section>
              <SectionLabel icon={<CreditCard size={14} />} label={t.payment_channel} />
              <PromptPayCard number={promptpay.number} name={promptpay.name} amount={room.rent_amount} title={t.payment_channel} lang={lang} />
            </section>
          )}

          {/* Pending Fines */}
          {pendingFines.length > 0 && (
            <section>
              <SectionLabel icon={<AlertTriangle size={14} />} label={`${t.unpaid_fines} (${pendingFines.length})`} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {pendingFines.map(f => (
                  <FineCard key={f.id} fine={f} promptpay={promptpay} portalIds={{uid, buildingId, roomId}} lang={lang} />
                ))}
              </div>
            </section>
          )}

          {/* History */}
          {(prevBills.length > 0 || paidFines.length > 0) && (
            <section>
              <SectionLabel icon={<CalendarDays size={14} />} label={t.history} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {paidFines.map(f => (
                  <FineCard key={f.id} fine={f} promptpay={promptpay} portalIds={{uid, buildingId, roomId}} lang={lang} />
                ))}
                {prevBills.map(b => (
                  <BillCard key={b.id} bill={b} defaultOpen={false} promptpay={promptpay} portalIds={{uid, buildingId, roomId}} lang={lang} />
                ))}
              </div>
            </section>
          )}

          {/* Contact */}
          {config?.bill_customization?.dorm_phone && (
            <section>
              <div style={{
                background: 'var(--color-white)', borderRadius: '14px', padding: '0.875rem 1rem',
                border: '1px solid var(--color-gray-200)', display: 'flex', alignItems: 'center', gap: '0.75rem',
                boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
              }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'linear-gradient(135deg,#0EA5E9,#10B981)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Phone size={16} color="#fff" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-gray-800)' }}>{t.contact_dorm}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>{config.bill_customization.dorm_phone}</div>
                </div>
                <a href={`tel:${config.bill_customization.dorm_phone}`}
                  style={{ background: 'linear-gradient(135deg,#0EA5E9,#10B981)', color: 'var(--color-white)', borderRadius: '10px', padding: '0.425rem 1rem', fontWeight: 700, fontSize: '0.8125rem', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <Phone size={13} /> {t.call}
                </a>
              </div>
            </section>
          )}

          {/* Maintenance */}
          <section>
            <SectionLabel icon={<Wrench size={14} />} label={t.maintenance} />
            <MaintenanceSection
              uid={uid}
              buildingId={buildingId}
              roomId={roomId}
              roomNumber={room.room_number}
              lang={lang}
            />
          </section>

          {/* Housekeeping / Cleaning */}
          <section>
            <SectionLabel icon={<Sparkles size={14} />} label={t.cleaning} />
            <CleaningSection
              uid={uid}
              buildingId={buildingId}
              roomId={roomId}
              roomNumber={room.room_number}
              tenantName={profile?.full_name || ''}
              lang={lang}
            />
          </section>

          {/* Footer */}
          <div style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', opacity: 0.55 }}>
            <img src={horcareLogo} alt="" style={{ width: 20, height: 20, borderRadius: 5 }} />
            <span style={{ fontSize: '0.75rem', color: '#0369A1', fontWeight: 700 }}>{t.powered_by}</span>
          </div>
        </div>

        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800;900&display=swap');
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes scaleIn {
            from { opacity: 0; transform: scale(0.95) translateY(-4px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          @media (min-width: 640px) {
            .portal-shell { padding: 2rem 1rem; }
            .portal-shell > div { border-radius: 24px; overflow: hidden; box-shadow: 0 20px 40px -10px rgba(14, 165, 233, 0.15), 0 1px 3px rgba(0,0,0,0.05); min-height: auto !important; }
          }
        `}</style>
      </div>
    </div>
  );
}

// ── Maintenance section (shown in tenant portal) ──────────────────────────────
function MaintenanceSection({ uid, buildingId, roomId, roomNumber, lang }: {
  uid: string; buildingId: string; roomId: string; roomNumber: string; lang: BillLanguage;
}) {
  const t = PORTAL_TRANSLATIONS[lang] ?? PORTAL_TRANSLATIONS.th;
  const { requests, loading } = useRoomMaintenance(uid, buildingId, roomId);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<{
    category: MaintenanceCategory; description: string; urgency: 'urgent' | 'normal';
  }>({ category: 'other', description: '', urgency: 'normal' });

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoLoading(true);
    try {
      const b64 = await compressImageToBase64(file);
      setPhoto(b64);
    } catch {
      toast.error(t.profile_error_toast);
    } finally {
      setPhotoLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.description.trim()) return;
    setSubmitting(true);
    try {
      const catLabel = translateCategory(form.category, 'th');
      await addDoc(collection(db, `users/${uid}/buildings/${buildingId}/maintenance`), {
        room_id: roomId,
        room_number: roomNumber,
        category: form.category,
        description: form.description.trim(),
        urgency: form.urgency,
        status: 'open',
        photo_url: photo ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Notification to admin
      try {
        await fetch('/api/notify-push?route=notify-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid,
            buildingId,
            title: `แจ้งซ่อมใหม่ ห้อง ${roomNumber}`,
            body: `[${catLabel}${form.urgency === 'urgent' ? ' (ด่วน)' : ''}] ${form.description.trim().slice(0, 80)}`,
            data: { type: 'maintenance', roomId, roomNumber },
          }),
        });
      } catch {
        // Push notification error shouldn't block repair submission
      }

      setForm({ category: 'other', description: '', urgency: 'normal' });
      setPhoto(null);
      setShowForm(false);
      toast.success(t.repair_success_toast);
    } catch (err: any) {
      toast.error(err.message || t.profile_error_toast);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      {/* Existing requests */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--color-gray-400)', fontSize: '0.85rem' }}>
          {t.loading}
        </div>
      ) : requests.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '0.875rem' }}>
          {requests.map(req => {
            const statusCfg = getStatusCfg(req.status, lang);
            return (
              <div
                key={req.id}
                style={{
                  background: 'var(--color-white)', borderRadius: '14px',
                  border: '1px solid var(--color-gray-200)', padding: '0.875rem 1rem',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.375rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-gray-800)' }}>
                      {translateCategory(req.category, lang)}
                    </span>
                    {req.urgency === 'urgent' && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.7rem', fontWeight: 700, color: '#DC2626', background: '#FEE2E2', padding: '0.15rem 0.45rem', borderRadius: 6 }}>
                        <AlertTriangle size={11} /> {t.urgent}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      fontSize: '0.75rem', fontWeight: 700,
                      color: statusCfg.color, background: statusCfg.bg,
                      padding: '0.2rem 0.55rem', borderRadius: 8,
                    }}>
                      {statusCfg.label}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-gray-400)' }}>
                      {formatPortalDate(req.created_at, lang)}
                    </span>
                  </div>
                </div>

                <p style={{ margin: 0, fontSize: '0.825rem', color: 'var(--color-gray-600)', lineHeight: 1.5 }}>
                  {req.description}
                </p>
                {req.admin_note && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--color-gray-700)', borderLeft: '3px solid #0EA5E9', paddingLeft: '0.625rem', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: '0.3rem' }}>
                    <Pencil size={11} color="#0EA5E9" style={{ marginTop: '0.15rem', flexShrink: 0 }} />
                    {req.admin_note}
                  </div>
                )}
                {req.photo_url && (
                  <img
                    src={req.photo_url}
                    alt="รูปแจ้งซ่อม"
                    style={{ marginTop: '0.5rem', width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--color-gray-200)', cursor: 'pointer' }}
                    onClick={() => window.open(req.photo_url, '_blank')}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Button to open form */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          style={{
            width: '100%', background: 'linear-gradient(135deg, #0EA5E9, #10B981)',
            color: 'var(--color-white)', border: 'none', borderRadius: '14px',
            padding: '0.875rem', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            boxShadow: '0 2px 12px rgba(14,165,233,0.25)',
          }}
        >
          <Plus size={18} /> {t.report_repair}
        </button>
      ) : (
        <div style={{
          background: 'var(--color-white)', borderRadius: '16px',
          border: '1.5px solid rgba(14, 165, 233, 0.4)', padding: '1.25rem',
          boxShadow: '0 4px 20px rgba(14, 165, 233, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'var(--color-gray-800)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Wrench size={16} color="#0EA5E9" /> {t.report_repair}
            </div>
            <button
              onClick={() => setShowForm(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray-400)', padding: 4 }}
            >
              <XIcon size={16} />
            </button>
          </div>

          {/* Category selection */}
          <div style={{ marginBottom: '0.875rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.4rem' }}>
              {t.category}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.375rem' }}>
              {PORTAL_CATEGORY_OPTIONS.map(opt => {
                const active = form.category === opt.value;
                const catLabel = translateCategory(opt.value, lang);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, category: opt.value }))}
                    style={{
                      border: `${active ? '2px' : '1px'} solid ${active ? opt.color : 'var(--color-gray-200)'}`,
                      background: active ? `${opt.color}15` : 'var(--color-gray-50)',
                      borderRadius: '10px', padding: '0.5rem 0.25rem', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem',
                      transition: 'all 0.15s',
                    }}
                  >
                    <opt.Icon size={18} color={active ? opt.color : 'var(--color-gray-500)'} />
                    <span style={{ fontSize: '0.62rem', textAlign: 'center', lineHeight: 1.2, fontWeight: active ? 700 : 500, color: active ? opt.color : 'var(--color-gray-700)' }}>
                      {catLabel}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Urgency */}
          <div style={{ marginBottom: '0.875rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.4rem' }}>
              {t.urgency}
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {([
                { value: 'normal', label: t.normal, dotColor: '#16A34A' },
                { value: 'urgent', label: t.urgent, dotColor: '#DC2626' },
              ] as const).map(u => {
                const active = form.urgency === u.value;
                const borderColor = active ? (u.value === 'urgent' ? '#DC2626' : '#0EA5E9') : 'var(--color-gray-200)';
                const bgColor    = active ? (u.value === 'urgent' ? 'rgba(220,38,38,0.08)' : 'rgba(14,165,233,0.08)') : 'var(--color-white)';
                const textColor  = active ? (u.value === 'urgent' ? '#DC2626' : '#0EA5E9') : 'var(--color-gray-700)';
                return (
                  <button
                    key={u.value}
                    type="button"
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
          <div style={{ marginBottom: '0.875rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.4rem' }}>
              {t.description} *
            </label>
            <textarea
              rows={3}
              placeholder={t.desc_placeholder}
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{
                width: '100%', borderRadius: '10px', border: '1.5px solid #E5E7EB',
                padding: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6, outline: 'none',
                resize: 'vertical', minHeight: '80px',
                fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Photo attachment */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.4rem' }}>
              {t.attach_photo} ({t.optional})
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handlePhotoChange}
            />
            {photo ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img
                  src={photo}
                  alt="Maintenance Photo"
                  style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10, border: '1.5px solid #E5E7EB' }}
                />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%',
                    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'white',
                  }}
                >
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={photoLoading}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: 10,
                  border: '1.5px dashed rgba(14, 165, 233, 0.4)', background: 'rgba(14, 165, 233, 0.05)',
                  color: '#0EA5E9', fontWeight: 600, fontSize: '0.875rem',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                  opacity: photoLoading ? 0.6 : 1,
                }}
              >
                {photoLoading
                  ? <><span style={{ width: 14, height: 14, border: '2px solid rgba(14,165,233,0.3)', borderTopColor: '#0EA5E9', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /> {t.loading}</>
                  : <><Camera size={15} /> {t.take_photo}</>
                }
              </button>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={handleSubmit}
              disabled={submitting || !form.description.trim()}
              style={{
                flex: 1, background: 'linear-gradient(135deg, #0EA5E9, #10B981)',
                color: 'var(--color-white)', border: 'none', borderRadius: '12px',
                padding: '0.875rem', fontWeight: 700, fontSize: '0.9375rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                opacity: submitting || !form.description.trim() ? 0.5 : 1,
              }}
            >
              {submitting
                ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'var(--color-white)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /> {t.sending}</>
                : <><Send size={16} /> {t.send_request}</>
              }
            </button>
            <button
              onClick={() => setShowForm(false)}
              style={{
                padding: '0.875rem 1.25rem', borderRadius: '12px', cursor: 'pointer',
                background: 'var(--color-gray-100)', border: '1px solid var(--color-gray-200)',
                color: 'var(--color-gray-500)', fontWeight: 600, fontSize: '0.875rem',
              }}
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cleaning section (shown in tenant portal) ────────────────────────────────
function CleaningSection({ uid, buildingId, roomId, roomNumber, tenantName, lang }: {
  uid: string; buildingId: string; roomId: string; roomNumber: string; tenantName?: string; lang: BillLanguage;
}) {
  const t = PORTAL_TRANSLATIONS[lang] ?? PORTAL_TRANSLATIONS.th;
  const { requests, loading } = useRoomCleaning(uid, buildingId, roomId);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<{
    service_type: CleaningServiceType;
    preferred_date: string;
    preferred_time_slot: string;
    description: string;
  }>({
    service_type: 'general',
    preferred_date: '',
    preferred_time_slot: 'เช้า (09:00 - 12:00)',
    description: '',
  });

  const cleaningTypeOpts: { value: CleaningServiceType; label: string; desc: string }[] = [
    { value: 'general', label: 'ทำความสะอาดทั่วไป', desc: 'กวาด ถู ปัดฝุ่น' },
    { value: 'bathroom', label: 'ขัดล้างห้องน้ำ', desc: 'ล้างสุขภัณฑ์/พื้น' },
    { value: 'balcony', label: 'ล้างระเบียง', desc: 'ขัดพื้น/ซักล้าง' },
    { value: 'deep', label: 'บิ๊กคลีนนิ่ง', desc: 'ทำความสะอาดละเอียด' },
    { value: 'checkout', label: 'ก่อนย้ายออก', desc: 'เคลียร์ห้อง' },
  ];

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoLoading(true);
    try {
      const b64 = await compressImageToBase64(file);
      setPhoto(b64);
    } catch {
      toast.error(t.profile_error_toast);
    } finally {
      setPhotoLoading(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, `users/${uid}/buildings/${buildingId}/cleaning`), {
        room_id: roomId,
        room_number: roomNumber,
        tenant_name: tenantName || '',
        service_type: form.service_type,
        preferred_date: form.preferred_date || null,
        preferred_time_slot: form.preferred_time_slot,
        description: form.description.trim(),
        status: 'pending',
        image_url: photo ?? null,
        has_photo: !!photo,
        created_at: now,
        updated_at: now,
      });

      // Notification to admin
      try {
        await fetch('/api/notify-push?route=notify-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid,
            buildingId,
            title: `แจ้งทำความสะอาดใหม่ ห้อง ${roomNumber}`,
            body: `${form.service_type} - ${form.description.trim().slice(0, 80) || 'ไม่มีบันทึกเพิ่มเติม'}`,
            data: { type: 'cleaning', roomId, roomNumber },
          }),
        });
      } catch {
        /* push error ignored */
      }

      setForm({ service_type: 'general', preferred_date: '', preferred_time_slot: 'เช้า (09:00 - 12:00)', description: '' });
      setPhoto(null);
      setShowForm(false);
      toast.success(t.cleaning_success_toast);
    } catch (err: any) {
      toast.error(err.message || t.profile_error_toast);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'in_progress':
        return { label: t.status_in_progress, color: '#D97706', bg: '#FFFBEB' };
      case 'completed':
        return { label: t.status_resolved, color: '#16A34A', bg: '#F0FDF4' };
      case 'cancelled':
        return { label: t.status_cancelled, color: '#64748B', bg: '#F1F5F9' };
      default:
        return { label: t.status_open, color: '#DC2626', bg: '#FEF2F2' };
    }
  };

  return (
    <div>
      {/* Existing cleaning requests */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--color-gray-400)', fontSize: '0.85rem' }}>
          {t.loading}
        </div>
      ) : requests.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '0.875rem' }}>
          {requests.map(req => {
            const badge = getStatusBadge(req.status);
            const typeLabel = cleaningTypeOpts.find(o => o.value === req.service_type)?.label ?? req.service_type;

            return (
              <div
                key={req.id}
                style={{
                  background: 'var(--color-white)', borderRadius: '14px',
                  border: '1px solid var(--color-gray-200)', padding: '0.875rem 1rem',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', marginBottom: '0.375rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0284C7', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <Sparkles size={13} /> {typeLabel}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      fontSize: '0.75rem', fontWeight: 700,
                      color: badge.color, background: badge.bg,
                      padding: '0.2rem 0.55rem', borderRadius: 8,
                    }}>
                      {badge.label}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-gray-400)' }}>
                      {formatPortalDate(req.created_at, lang)}
                    </span>
                  </div>
                </div>

                {req.description && (
                  <p style={{ margin: '0 0 0.35rem 0', fontSize: '0.825rem', color: 'var(--color-gray-600)', lineHeight: 1.5 }}>
                    {req.description}
                  </p>
                )}

                {(req.preferred_date || req.preferred_time_slot) && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.25rem' }}>
                    <CalendarDays size={12} />
                    <span>
                      {req.preferred_date ? formatPortalDate(req.preferred_date, lang) : 'วันนัดหมาย'}{' '}
                      {req.preferred_time_slot ? `(${req.preferred_time_slot})` : ''}
                    </span>
                  </div>
                )}

                {req.assigned_maid_name && (
                  <div style={{ fontSize: '0.775rem', color: '#0369A1', background: '#F0F9FF', padding: '0.3rem 0.55rem', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginTop: '0.25rem' }}>
                    <CheckCircle2 size={12} /> ผู้รับผิดชอบ: <strong>{req.assigned_maid_name}</strong>
                  </div>
                )}

                {req.completed_note && (
                  <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#15803D', borderLeft: '3px solid #16A34A', paddingLeft: '0.5rem', lineHeight: 1.4 }}>
                    <strong>ผลการทำความสะอาด:</strong> {req.completed_note}
                  </div>
                )}

                {req.image_url && (
                  <img
                    src={req.image_url}
                    alt="รูปทำความสะอาด"
                    style={{ marginTop: '0.5rem', width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--color-gray-200)', cursor: 'pointer' }}
                    onClick={() => { if (req.image_url) window.open(req.image_url, '_blank'); }}
                  />
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Button to open form */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          style={{
            width: '100%', background: 'linear-gradient(135deg, #0284C7, #0369A1)',
            color: 'var(--color-white)', border: 'none', borderRadius: '14px',
            padding: '0.875rem', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            boxShadow: '0 2px 12px rgba(2,132,199,0.25)',
          }}
        >
          <Sparkles size={18} /> {t.request_cleaning}
        </button>
      ) : (
        <div style={{
          background: 'var(--color-white)', borderRadius: '16px',
          border: '1.5px solid rgba(2, 132, 199, 0.4)', padding: '1.25rem',
          boxShadow: '0 4px 20px rgba(2, 132, 199, 0.1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 800, fontSize: '0.9375rem', color: 'var(--color-gray-800)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Sparkles size={16} color="#0284C7" /> {t.request_cleaning}
            </div>
            <button
              onClick={() => setShowForm(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray-400)', padding: 4 }}
            >
              <XIcon size={16} />
            </button>
          </div>

          {/* Service type options */}
          <div style={{ marginBottom: '0.875rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.4rem' }}>
              ประเภทบริการทำความสะอาด
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.4rem' }}>
              {cleaningTypeOpts.map(opt => {
                const active = form.service_type === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, service_type: opt.value }))}
                    style={{
                      border: `${active ? '2px' : '1px'} solid ${active ? '#0284C7' : 'var(--color-gray-200)'}`,
                      background: active ? '#F0F9FF' : 'var(--color-gray-50)',
                      borderRadius: '10px', padding: '0.5rem 0.35rem', cursor: 'pointer',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem',
                    }}
                  >
                    <span style={{ fontSize: '0.8rem', fontWeight: active ? 700 : 500, color: active ? '#0369A1' : 'var(--color-gray-700)' }}>
                      {opt.label}
                    </span>
                    <span style={{ fontSize: '0.675rem', color: 'var(--color-gray-400)' }}>
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Preferred date & time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem', marginBottom: '0.875rem' }}>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.35rem' }}>
                วันที่ต้องการ (ถ้ามี)
              </label>
              <input
                type="date"
                value={form.preferred_date}
                onChange={e => setForm(f => ({ ...f, preferred_date: e.target.value }))}
                style={{ width: '100%', borderRadius: '10px', border: '1.5px solid #E5E7EB', padding: '0.5rem', fontSize: '0.85rem' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.35rem' }}>
                ช่วงเวลา
              </label>
              <select
                value={form.preferred_time_slot}
                onChange={e => setForm(f => ({ ...f, preferred_time_slot: e.target.value }))}
                style={{ width: '100%', borderRadius: '10px', border: '1.5px solid #E5E7EB', padding: '0.5rem', fontSize: '0.85rem' }}
              >
                <option value="เช้า (09:00 - 12:00)">เช้า (09:00 - 12:00)</option>
                <option value="บ่าย (13:00 - 16:00)">บ่าย (13:00 - 16:00)</option>
                <option value="เย็น (16:00 - 18:00)">เย็น (16:00 - 18:00)</option>
                <option value="สะดวกทั้งวัน">สะดวกทั้งวัน</option>
              </select>
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom: '0.875rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.4rem' }}>
              รายละเอียดเพิ่มเติม / จุดที่เน้นเป็นพิเศษ
            </label>
            <textarea
              rows={2}
              placeholder="เช่น เน้นขัดร่องกระเบื้องห้องน้ำ, ทำความสะอาดตู้เย็น..."
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              style={{
                width: '100%', borderRadius: '10px', border: '1.5px solid #E5E7EB',
                padding: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6, outline: 'none',
                resize: 'vertical', minHeight: '65px',
                fontFamily: 'var(--font-sans)', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Photo attachment */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-gray-500)', display: 'block', marginBottom: '0.4rem' }}>
              {t.attach_photo} ({t.optional})
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handlePhotoChange}
            />
            {photo ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img
                  src={photo}
                  alt="Cleaning Photo"
                  style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 10, border: '1.5px solid #E5E7EB' }}
                />
                <button
                  type="button"
                  onClick={() => setPhoto(null)}
                  style={{
                    position: 'absolute', top: 6, right: 6,
                    background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%',
                    width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'white',
                  }}
                >
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={photoLoading}
                style={{
                  width: '100%', padding: '0.75rem', borderRadius: 10,
                  border: '1.5px dashed rgba(2, 132, 199, 0.4)', background: 'rgba(2, 132, 199, 0.05)',
                  color: '#0284C7', fontWeight: 600, fontSize: '0.875rem',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                  opacity: photoLoading ? 0.6 : 1,
                }}
              >
                {photoLoading
                  ? <><span style={{ width: 14, height: 14, border: '2px solid rgba(2,132,199,0.3)', borderTopColor: '#0284C7', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /> {t.loading}</>
                  : <><Camera size={15} /> {t.take_photo}</>
                }
              </button>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                flex: 1, background: 'linear-gradient(135deg, #0284C7, #0369A1)',
                color: 'var(--color-white)', border: 'none', borderRadius: '12px',
                padding: '0.875rem', fontWeight: 700, fontSize: '0.9375rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                opacity: submitting ? 0.5 : 1,
              }}
            >
              {submitting
                ? <><span style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'var(--color-white)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', display: 'inline-block' }} /> {t.sending}</>
                : <><Send size={16} /> {t.send_request}</>
              }
            </button>
            <button
              onClick={() => setShowForm(false)}
              style={{
                padding: '0.875rem 1.25rem', borderRadius: '12px', cursor: 'pointer',
                background: 'var(--color-gray-100)', border: '1px solid var(--color-gray-200)',
                color: 'var(--color-gray-500)', fontWeight: 600, fontSize: '0.875rem',
              }}
            >
              {t.cancel}
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
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', fontWeight: 800, color: '#0369A1', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '1.5rem 0 0.65rem' }}>
      <span style={{ color: '#0EA5E9', display: 'flex', alignItems: 'center' }}>{icon}</span> {label}
    </div>
  );
}
