import { useEffect, useRef, useState } from 'react';
import { CreditCard, Wrench, Sparkles, X } from 'lucide-react';
import type { MonthlyBill, MaintenanceRequest, CleaningRequest } from '../types';
import { usePushNotification } from '../hooks/usePushNotification';

type ToastKind = 'slip' | 'maintenance' | 'cleaning';

interface Toast {
  id: string;
  kind: ToastKind;
  roomNumber: string;
  description?: string;
  urgency?: string;
}

function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextClass();
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
  cleaningRequests?: CleaningRequest[];
  onGoToPayments: () => void;
  onGoToMaintenance: () => void;
  onGoToCleaning?: () => void;
}

export default function SlipNotificationToast({
  bills, maintenanceRequests, cleaningRequests = [], onGoToPayments, onGoToMaintenance, onGoToCleaning,
}: Props) {
  const { notify } = usePushNotification();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenSlips = useRef<Set<string>>(new Set());
  const seenMaint = useRef<Set<string>>(new Set());
  const seenCleaning = useRef<Set<string>>(new Set());
  const slipInit = useRef(false);
  const maintInit = useRef(false);
  const cleanInit = useRef(false);

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
    fresh.forEach(b => {
      notify(`มีสลิปชำระเงินใหม่ ห้อง ${b.room_number}`, {
        body: 'ผู้เช่าได้แนบสลิปชำระเงินแล้ว คลิกเพื่อตรวจสอบ',
        tag: `slip-${b.id}`,
      });
    });
    setToasts(prev => [
      ...prev,
      ...fresh.map(b => ({ id: `slip-${b.id}`, kind: 'slip' as ToastKind, roomNumber: b.room_number })),
    ]);
  }, [bills, notify]);

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
    fresh.forEach(r => {
      notify(`มีรายการแจ้งซ่อมใหม่ ห้อง ${r.room_number}`, {
        body: r.description ? r.description.slice(0, 60) : 'มีรายการแจ้งซ่อมใหม่',
        tag: `maint-${r.id}`,
      });
    });
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
  }, [maintenanceRequests, notify]);

  // ── Cleaning notifications ──
  useEffect(() => {
    const open = cleaningRequests.filter(r => r.status === 'pending' || r.status === 'open');
    if (!cleanInit.current) {
      open.forEach(r => seenCleaning.current.add(r.id));
      cleanInit.current = true;
      return;
    }
    const fresh = open.filter(r => !seenCleaning.current.has(r.id));
    if (!fresh.length) return;
    fresh.forEach(r => seenCleaning.current.add(r.id));
    playNotificationSound();
    fresh.forEach(r => {
      notify(`มีงานทำความสะอาดใหม่ ห้อง ${r.room_number}`, {
        body: r.description ? r.description.slice(0, 60) : 'มีคำขอทำความสะอาดใหม่',
        tag: `clean-${r.id}`,
      });
    });
    setToasts(prev => [
      ...prev,
      ...fresh.map(r => ({
        id: `clean-${r.id}`,
        kind: 'cleaning' as ToastKind,
        roomNumber: r.room_number,
        description: r.description?.slice(0, 60),
      })),
    ]);
  }, [cleaningRequests, notify]);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // auto-dismiss after 6s
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => {
      setToasts(prev => prev.slice(1));
    }, 6000);
    return () => clearTimeout(timer);
  }, [toasts]);

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
        let accent = '#059669';
        let bg = '#d1fae5';
        let title = 'ได้รับสลิปใหม่';
        let linkText = 'ดูที่การชำระเงิน →';
        let onAction = onGoToPayments;

        if (toast.kind === 'maintenance') {
          accent = '#D97706';
          bg = '#FEF3C7';
          title = `แจ้งซ่อมใหม่${toast.urgency === 'urgent' ? ' (ด่วน!)' : ''}`;
          linkText = 'ดูที่แจ้งซ่อม →';
          onAction = onGoToMaintenance;
        } else if (toast.kind === 'cleaning') {
          accent = '#0284C7';
          bg = '#E0F2FE';
          title = 'แจ้งทำความสะอาดใหม่';
          linkText = 'ดูที่งานแม่บ้าน →';
          onAction = onGoToCleaning ?? onGoToMaintenance;
        }

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
              {toast.kind === 'slip' && <CreditCard size={18} color={accent} />}
              {toast.kind === 'maintenance' && <Wrench size={18} color={accent} />}
              {toast.kind === 'cleaning' && <Sparkles size={18} color={accent} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#111' }}>
                {title}
              </div>
              <div style={{ fontSize: '0.8125rem', color: '#555', marginTop: 2 }}>
                ห้อง <strong>{toast.roomNumber}</strong>
                {toast.description && (
                  <span style={{ display: 'block', fontSize: '0.75rem', color: '#777', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {toast.description}
                  </span>
                )}
              </div>
              <button
                onClick={() => { dismiss(toast.id); onAction(); }}
                style={{
                  marginTop: 8, fontSize: '0.75rem', fontWeight: 600,
                  color: accent, background: 'none', border: 'none',
                  cursor: 'pointer', padding: 0,
                }}
              >
                {linkText}
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
