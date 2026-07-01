import { useEffect, useRef, useState } from 'react';
import { CreditCard, X } from 'lucide-react';
import type { MonthlyBill } from '../types';

interface Toast {
  id: string;
  roomNumber: string;
  billId: string;
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = ctx.currentTime;
    // สองโน้ต: ding-dong
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
  } catch { /* browser blocked autoplay — silent */ }
}

interface Props {
  bills: MonthlyBill[];
  onGoToPayments: () => void;
}

export default function SlipNotificationToast({ bills, onGoToPayments }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenIds = useRef<Set<string>>(new Set());
  const initialised = useRef(false);

  useEffect(() => {
    const pendingBills = bills.filter(b => b.payment_status === 'pending');

    if (!initialised.current) {
      // mark existing pending bills as "seen" on first load — don't toast for old ones
      pendingBills.forEach(b => seenIds.current.add(b.id));
      initialised.current = true;
      return;
    }

    const newBills = pendingBills.filter(b => !seenIds.current.has(b.id));
    if (newBills.length === 0) return;

    newBills.forEach(b => seenIds.current.add(b.id));
    playNotificationSound();

    setToasts(prev => [
      ...prev,
      ...newBills.map(b => ({
        id: b.id,
        roomNumber: b.room_number,
        billId: b.id,
      })),
    ]);
  }, [bills]);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 10,
      maxWidth: 320,
    }}>
      {toasts.map(toast => (
        <div
          key={toast.id}
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderLeft: '4px solid #059669',
            borderRadius: 12,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            animation: 'slideInRight 0.25s ease',
          }}
        >
          <style>{`
            @keyframes slideInRight {
              from { transform: translateX(110%); opacity: 0; }
              to   { transform: translateX(0);    opacity: 1; }
            }
          `}</style>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: '#d1fae5', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <CreditCard size={18} color="#059669" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#111' }}>
              💳 ได้รับสลิปใหม่
            </div>
            <div style={{ fontSize: '0.8125rem', color: '#555', marginTop: 2 }}>
              ห้อง <strong>{toast.roomNumber}</strong> ส่งสลิปมาแล้ว
            </div>
            <button
              onClick={() => { dismiss(toast.id); onGoToPayments(); }}
              style={{
                marginTop: 8, fontSize: '0.75rem', fontWeight: 600,
                color: '#059669', background: 'none', border: 'none',
                cursor: 'pointer', padding: 0,
              }}
            >
              ดูที่การชำระเงิน →
            </button>
          </div>
          <button
            onClick={() => dismiss(toast.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#999', flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
