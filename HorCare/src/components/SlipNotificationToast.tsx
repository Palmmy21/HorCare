import { useEffect, useRef, useState } from 'react';
import { CreditCard, Wrench, X } from 'lucide-react';
import type { MonthlyBill, MaintenanceRequest } from '../types';

type ToastKind = 'slip' | 'maintenance';

interface Toast {
  id: string;
  kind: ToastKind;
  roomNumber: string;
  description?: string;
  urgency?: string;
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    const notes = [880, 1100];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.28, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.35);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.35);
    });
  } catch { /* autoplay blocked */ }
}

interface Props {
  bills: MonthlyBill[];
  maintenanceRequests: MaintenanceRequest[];
  onGoToPayments: () => void;
  onGoToMaintenance: () => void;
}

export default function SlipNotificationToast({
  bills, maintenanceRequests, onGoToPayments, onGoToMaintenance,
}: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenSlips = useRef<Set<string>>(new Set());
  const seenMaint = useRef<Set<string>>(new Set());
  const slipInit = useRef(false);
  const maintInit = useRef(false);

  // ── Slip notifications ──
  useEffect(() => {
    const pending = bills.filter(b => b.payment_status === 'pending');
    if (!slipInit.current) {
      pending.forEach(b => seenSlips.current.add(b.id));
      slipInit.current = true;
      return;
    }
    const fresh = pending.filter(b => !seenSlips.current.has(b.id));
    if (!fresh.length) return;
    fresh.forEach(b => seenSlips.current.add(b.id));
    playNotificationSound();
    setToasts(prev => [
      ...prev,
      ...fresh.map(b => ({ id: `slip-${b.id}`, kind: 'slip' as ToastKind, roomNumber: b.room_number })),
    ]);
  }, [bills]);

  // ── Maintenance notifications ──
  useEffect(() => {
    const open = maintenanceRequests.filter(r => r.status === 'open');
    if (!maintInit.current) {
      open.forEach(r => seenMaint.current.add(r.id));
      maintInit.current = true;
      return;
    }
    const fresh = open.filter(r => !seenMaint.current.has(r.id));
    if (!fresh.length) return;
    fresh.forEach(r => seenMaint.current.add(r.id));
    playNotificationSound();
    setToasts(prev => [
      ...prev,
      ...fresh.map(r => ({
        id: `maint-${r.id}`,
        kind: 'maintenance' as ToastKind,
        roomNumber: r.room_number,
        description: r.description?.slice(0, 60),
        urgency: r.urgency,
      })),
    ]);
  }, [maintenanceRequests]);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 10,
      maxWidth: 320, width: '90vw',
    }}>
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
      {toasts.map(toast => {
        const isSlip = toast.kind === 'slip';
        const accent = isSlip ? '#059669' : '#D97706';
        const bg = isSlip ? '#d1fae5' : '#FEF3C7';
        return (
          <div key={toast.id} style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderLeft: `4px solid ${accent}`,
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: '12px 14px',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            animation: 'slideInRight 0.25s ease',
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              {isSlip
                ? <CreditCard size={18} color={accent} />
                : <Wrench size={18} color={accent} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#111' }}>
                {isSlip ? '💳 ได้รับสลิปใหม่' : `🔧 แจ้งซ่อมใหม่${toast.urgency === 'urgent' ? ' ⚡ด่วน' : ''}`}
              </div>
              <div style={{ fontSize: '0.8125rem', color: '#555', marginTop: 2 }}>
                ห้อง <strong>{toast.roomNumber}</strong>
                {!isSlip && toast.description && (
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#777', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {toast.description}
                  </span>
                )}
              </div>
              <button
                onClick={() => { dismiss(toast.id); isSlip ? onGoToPayments() : onGoToMaintenance(); }}
                style={{
                  marginTop: 8, fontSize: '0.75rem', fontWeight: 600,
                  color: accent, background: 'none', border: 'none',
                  cursor: 'pointer', padding: 0,
                }}
              >
                {isSlip ? 'ดูที่การชำระเงิน →' : 'ดูที่แจ้งซ่อม →'}
              </button>
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#aaa', flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
