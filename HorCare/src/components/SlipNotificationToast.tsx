import { useEffect, useRef, useState, useCallback } from 'react';
import { CreditCard, Wrench, Sparkles, X, CheckCircle2, AlertCircle } from 'lucide-react';
import type { MonthlyBill, Fine, MaintenanceRequest, CleaningRequest, MaintenanceStatus, CleaningStatus } from '../types';
import { usePushNotification } from '../hooks/usePushNotification';

type ToastKind =
  | 'slip'
  | 'maintenance_new'
  | 'maintenance_status'
  | 'cleaning_new'
  | 'cleaning_status';

interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  roomNumber: string;
  description?: string;
  urgency?: string;
  onAction?: () => void;
  actionText?: string;
}

// Global unlocked audio context singleton
let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      sharedAudioCtx = new AudioContextClass();
    }
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

// Unlock audio on first user touch / click
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('click', unlockAudio);
  };
  window.addEventListener('touchstart', unlockAudio, { passive: true });
  window.addEventListener('click', unlockAudio, { passive: true });
}

function playNotificationSound() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
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
      gain.gain.linearRampToValueAtTime(0.3, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.35);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.35);
    });
  } catch {
    // silent fallback if browser blocks
  }
}

function getMaintCategoryLabel(category?: string): string {
  switch (category) {
    case 'electric': return 'ระบบไฟ';
    case 'plumbing': return 'ระบบประปา';
    case 'appliance': return 'เครื่องใช้ไฟฟ้า';
    case 'door_window': return 'ประตู/หน้าต่าง';
    case 'bathroom': return 'ห้องน้ำ';
    case 'ac': return 'เครื่องปรับอากาศ';
    case 'furniture': return 'เฟอร์นิเจอร์';
    default: return 'แจ้งซ่อมทั่วไป';
  }
}

function getMaintStatusLabel(status: MaintenanceStatus | string): string {
  switch (status) {
    case 'open': return 'รอดำเนินการ';
    case 'in_progress': return 'กำลังดำเนินการซ่อม';
    case 'done': return 'ซ่อมเสร็จสิ้นแล้ว';
    case 'rejected': return 'ปฏิเสธ / ยกเลิก';
    default: return status;
  }
}

function getCleaningServiceLabel(service?: string): string {
  switch (service) {
    case 'general':
    case 'general_cleaning': return 'ทำความสะอาดทั่วไป';
    case 'bathroom':
    case 'bathroom_cleaning': return 'ล้างห้องน้ำ';
    case 'balcony': return 'ล้างระเบียง / ซักล้าง';
    case 'bed_linen': return 'เปลี่ยนผ้าปู / ซักรีด';
    case 'deep':
    case 'deep_cleaning': return 'บิ๊กคลีนนิ่ง';
    case 'checkout':
    case 'move_out_cleaning': return 'ทำความสะอาดก่อนย้ายออก';
    default: return 'งานแม่บ้าน';
  }
}

function getCleaningStatusLabel(status: CleaningStatus | string): string {
  switch (status) {
    case 'open':
    case 'pending': return 'รอดำเนินการ';
    case 'assigned': return 'มอบหมายงานแล้ว';
    case 'in_progress': return 'กำลังเข้าทำความสะอาด';
    case 'done':
    case 'completed': return 'ทำความสะอาดเสร็จแล้ว';
    case 'cancelled': return 'ยกเลิกคำขอ';
    default: return status;
  }
}

interface Props {
  bills: MonthlyBill[];
  fines?: Fine[];
  maintenanceRequests: MaintenanceRequest[];
  cleaningRequests?: CleaningRequest[];
  buildingId?: string | null;
  onGoToPayments: () => void;
  onGoToMaintenance: () => void;
  onGoToCleaning?: () => void;
}

export default function SlipNotificationToast({
  bills,
  fines = [],
  maintenanceRequests,
  cleaningRequests = [],
  buildingId,
  onGoToPayments,
  onGoToMaintenance,
  onGoToCleaning,
}: Props) {
  const { notify } = usePushNotification();
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Baseline tracking maps
  const knownMaint = useRef<Map<string, { status: string; updated_at?: string }>>(new Map());
  const knownCleaning = useRef<Map<string, { status: string; updated_at?: string }>>(new Map());
  const knownSlips = useRef<Map<string, { status?: string; submitted_at?: string }>>(new Map());

  const maintInit = useRef(false);
  const cleanInit = useRef(false);
  const slipInit = useRef(false);
  const lastBuildingId = useRef<string | null | undefined>(buildingId);

  // Reset baseline caches when switching buildings
  useEffect(() => {
    if (lastBuildingId.current !== buildingId) {
      lastBuildingId.current = buildingId;
      knownMaint.current.clear();
      knownCleaning.current.clear();
      knownSlips.current.clear();
      maintInit.current = false;
      cleanInit.current = false;
      slipInit.current = false;
    }
  }, [buildingId]);

  const addToast = useCallback((toast: Toast) => {
    setToasts(prev => {
      // Keep up to 4 toasts at once to prevent clutter
      const filtered = prev.filter(t => t.id !== toast.id);
      return [toast, ...filtered].slice(0, 4);
    });
  }, []);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  // Auto-dismiss after 6.5s
  useEffect(() => {
    if (!toasts.length) return;
    const timer = setTimeout(() => {
      setToasts(prev => prev.slice(0, prev.length - 1));
    }, 6500);
    return () => clearTimeout(timer);
  }, [toasts]);

  // ── 1. Maintenance Notifications (New & Status Changes) ───────────────────
  useEffect(() => {
    if (!maintInit.current) {
      maintenanceRequests.forEach(r => {
        knownMaint.current.set(r.id, { status: r.status, updated_at: r.updated_at });
      });
      maintInit.current = true;
      return;
    }

    const newItems: MaintenanceRequest[] = [];
    const statusChangedItems: { req: MaintenanceRequest; oldStatus: string; newStatus: string }[] = [];

    maintenanceRequests.forEach(r => {
      const prev = knownMaint.current.get(r.id);
      if (!prev) {
        // Newly added request
        knownMaint.current.set(r.id, { status: r.status, updated_at: r.updated_at });
        newItems.push(r);
      } else if (prev.status !== r.status) {
        // Status changed
        const oldStatus = prev.status;
        knownMaint.current.set(r.id, { status: r.status, updated_at: r.updated_at });
        statusChangedItems.push({ req: r, oldStatus, newStatus: r.status });
      } else {
        knownMaint.current.set(r.id, { status: r.status, updated_at: r.updated_at });
      }
    });

    if (newItems.length > 0 || statusChangedItems.length > 0) {
      playNotificationSound();
    }

    // Fire notifications for newly created requests
    newItems.forEach(r => {
      const isUrgent = r.urgency === 'urgent';
      const cat = getMaintCategoryLabel(r.category);
      const title = `🛠️ แจ้งซ่อมใหม่ ห้อง ${r.room_number}${isUrgent ? ' (ด่วน!)' : ''}`;
      const body = `[${cat}] ${r.description ? r.description.slice(0, 70) : 'มีรายการแจ้งซ่อมใหม่'}`;

      notify(title, { body, tag: `maint-new-${r.id}-${Date.now()}` });
      addToast({
        id: `maint-new-${r.id}-${Date.now()}`,
        kind: 'maintenance_new',
        title: `แจ้งซ่อมใหม่${isUrgent ? ' (ด่วน!)' : ''}`,
        roomNumber: r.room_number,
        description: body,
        urgency: r.urgency,
        actionText: 'ดูที่แจ้งซ่อม →',
        onAction: onGoToMaintenance,
      });
    });

    // Fire notifications for status changes
    statusChangedItems.forEach(({ req, newStatus }) => {
      const statusText = getMaintStatusLabel(newStatus);
      const title = `🛠️ อัปเดตสถานะแจ้งซ่อม ห้อง ${req.room_number}`;
      const body = `สถานะเปลี่ยนเป็น: "${statusText}"${req.admin_note ? ` (${req.admin_note})` : ''}`;

      notify(title, { body, tag: `maint-stat-${req.id}-${Date.now()}` });
      addToast({
        id: `maint-stat-${req.id}-${Date.now()}`,
        kind: 'maintenance_status',
        title: 'อัปเดตสถานะแจ้งซ่อม',
        roomNumber: req.room_number,
        description: body,
        actionText: 'ดูรายการแจ้งซ่อม →',
        onAction: onGoToMaintenance,
      });
    });
  }, [maintenanceRequests, notify, addToast, onGoToMaintenance]);

  // ── 2. Cleaning Notifications (New & Status Changes) ──────────────────────
  useEffect(() => {
    if (!cleanInit.current) {
      cleaningRequests.forEach(r => {
        knownCleaning.current.set(r.id, { status: r.status, updated_at: r.updated_at });
      });
      cleanInit.current = true;
      return;
    }

    const newItems: CleaningRequest[] = [];
    const statusChangedItems: { req: CleaningRequest; oldStatus: string; newStatus: string }[] = [];

    cleaningRequests.forEach(r => {
      const prev = knownCleaning.current.get(r.id);
      if (!prev) {
        // Newly added cleaning request
        knownCleaning.current.set(r.id, { status: r.status, updated_at: r.updated_at });
        newItems.push(r);
      } else if (prev.status !== r.status) {
        // Status changed
        const oldStatus = prev.status;
        knownCleaning.current.set(r.id, { status: r.status, updated_at: r.updated_at });
        statusChangedItems.push({ req: r, oldStatus, newStatus: r.status });
      } else {
        knownCleaning.current.set(r.id, { status: r.status, updated_at: r.updated_at });
      }
    });

    if (newItems.length > 0 || statusChangedItems.length > 0) {
      playNotificationSound();
    }

    // Fire notifications for newly created cleaning requests
    newItems.forEach(r => {
      const isUrgent = r.urgency === 'urgent';
      const svc = getCleaningServiceLabel(r.service_type);
      const title = `🧹 งานแม่บ้านใหม่ ห้อง ${r.room_number}${isUrgent ? ' (ด่วน!)' : ''}`;
      const body = `[${svc}] ${r.description ? r.description.slice(0, 70) : (r.preferred_date ? `ต้องการวันที่: ${r.preferred_date}` : 'มีคำขอใหม่')}`;

      notify(title, { body, tag: `clean-new-${r.id}-${Date.now()}` });
      addToast({
        id: `clean-new-${r.id}-${Date.now()}`,
        kind: 'cleaning_new',
        title: `งานแม่บ้านใหม่${isUrgent ? ' (ด่วน!)' : ''}`,
        roomNumber: r.room_number,
        description: body,
        urgency: r.urgency,
        actionText: 'ดูที่งานแม่บ้าน →',
        onAction: onGoToCleaning ?? onGoToMaintenance,
      });
    });

    // Fire notifications for status changes
    statusChangedItems.forEach(({ req, newStatus }) => {
      const statusText = getCleaningStatusLabel(newStatus);
      const title = `🧹 อัปเดตสถานะงานแม่บ้าน ห้อง ${req.room_number}`;
      const body = `สถานะเปลี่ยนเป็น: "${statusText}"${req.assigned_maid_name ? ` (ผู้รับผิดชอบ: ${req.assigned_maid_name})` : ''}`;

      notify(title, { body, tag: `clean-stat-${req.id}-${Date.now()}` });
      addToast({
        id: `clean-stat-${req.id}-${Date.now()}`,
        kind: 'cleaning_status',
        title: 'อัปเดตสถานะงานแม่บ้าน',
        roomNumber: req.room_number,
        description: body,
        actionText: 'ดูที่งานแม่บ้าน →',
        onAction: onGoToCleaning ?? onGoToMaintenance,
      });
    });
  }, [cleaningRequests, notify, addToast, onGoToCleaning, onGoToMaintenance]);

  // ── 3. Payment Slip Notifications (Bills & Fines) ─────────────────────────
  useEffect(() => {
    if (!slipInit.current) {
      bills.forEach(b => {
        knownSlips.current.set(b.id, {
          status: b.payment_status,
          submitted_at: b.slip_submitted_at,
        });
      });
      fines.forEach(f => {
        knownSlips.current.set(`fine-${f.id}`, {
          status: f.status,
          submitted_at: f.slip_submitted_at,
        });
      });
      slipInit.current = true;
      return;
    }

    const freshSlips: {
      id: string;
      roomNumber: string;
      amount: number;
      isAutoVerified: boolean;
      isFine: boolean;
    }[] = [];

    // Check monthly bills
    bills.forEach(b => {
      const prev = knownSlips.current.get(b.id);
      const hasSlipNow = b.payment_status === 'pending' || !!b.slip_submitted_at || !!b.slip_image;
      const prevHadSlip = prev && (prev.status === 'pending' || !!prev.submitted_at);

      if (hasSlipNow && (!prev || !prevHadSlip || (b.slip_submitted_at && b.slip_submitted_at !== prev.submitted_at))) {
        const isAutoVerified = b.payment_status === 'paid' && !!b.verify_note?.includes('AI');
        freshSlips.push({
          id: `bill-${b.id}`,
          roomNumber: b.room_number,
          amount: b.total_bill,
          isAutoVerified,
          isFine: false,
        });
      }
      knownSlips.current.set(b.id, {
        status: b.payment_status,
        submitted_at: b.slip_submitted_at,
      });
    });

    // Check fines
    fines.forEach(f => {
      const key = `fine-${f.id}`;
      const prev = knownSlips.current.get(key);
      const hasSlipNow = f.status === 'pending' || !!f.slip_submitted_at || !!f.slip_image;
      const prevHadSlip = prev && (prev.status === 'pending' || !!prev.submitted_at);

      if (hasSlipNow && (!prev || !prevHadSlip || (f.slip_submitted_at && f.slip_submitted_at !== prev.submitted_at))) {
        const isAutoVerified = f.status === 'paid' && !!f.note?.includes('AI');
        freshSlips.push({
          id: key,
          roomNumber: f.room_number,
          amount: f.amount,
          isAutoVerified,
          isFine: true,
        });
      }
      knownSlips.current.set(key, {
        status: f.status,
        submitted_at: f.slip_submitted_at,
      });
    });

    if (freshSlips.length > 0) {
      playNotificationSound();
    }

    freshSlips.forEach(s => {
      const title = s.isAutoVerified
        ? `✅ ตรวจสอบสลิปผ่าน AI แล้ว ห้อง ${s.roomNumber}`
        : `💳 ได้รับสลิปชำระเงินใหม่ ห้อง ${s.roomNumber}`;
      const body = s.isAutoVerified
        ? `ยอดชำระ ฿${s.amount.toLocaleString()} (ตรวจสอบผ่านโดย AI แล้ว)`
        : `ยอดชำระ ฿${s.amount.toLocaleString()} (ผู้เช่าแนบสลิปแล้ว คลิกเพื่อตรวจสอบ)`;

      notify(title, { body, tag: `slip-${s.id}-${Date.now()}` });
      addToast({
        id: `slip-${s.id}-${Date.now()}`,
        kind: 'slip',
        title: s.isAutoVerified ? 'ตรวจสลิปสำเร็จ (AI)' : 'ได้รับสลิปใหม่',
        roomNumber: s.roomNumber,
        description: body,
        actionText: 'ดูที่การชำระเงิน →',
        onAction: onGoToPayments,
      });
    });
  }, [bills, fines, notify, addToast, onGoToPayments]);

  if (!toasts.length) return null;

  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 10,
      maxWidth: 340, width: '92vw',
      pointerEvents: 'none',
    }}>
      <style>{`
        @keyframes slideInRightToast {
          from { transform: translateX(110%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
      {toasts.map(toast => {
        let accent = '#059669';
        let bg = '#d1fae5';
        let IconComponent = CreditCard;

        if (toast.kind === 'maintenance_new') {
          accent = '#D97706';
          bg = '#FEF3C7';
          IconComponent = Wrench;
        } else if (toast.kind === 'maintenance_status') {
          accent = '#2563EB';
          bg = '#DBEAFE';
          IconComponent = AlertCircle;
        } else if (toast.kind === 'cleaning_new') {
          accent = '#0284C7';
          bg = '#E0F2FE';
          IconComponent = Sparkles;
        } else if (toast.kind === 'cleaning_status') {
          accent = '#7C3AED';
          bg = '#EDE9FE';
          IconComponent = CheckCircle2;
        }

        return (
          <div key={toast.id} style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderLeft: `4.5px solid ${accent}`,
            borderRadius: 14,
            boxShadow: '0 10px 28px -4px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.04)',
            padding: '12px 14px',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            animation: 'slideInRightToast 0.28s cubic-bezier(0.16, 1, 0.3, 1)',
            pointerEvents: 'auto',
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 11,
              background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <IconComponent size={20} color={accent} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '0.875rem', color: '#0f172a', lineHeight: 1.3 }}>
                {toast.title}
              </div>
              <div style={{ fontSize: '0.8125rem', color: '#475569', marginTop: 3 }}>
                ห้อง <strong>{toast.roomNumber}</strong>
                {toast.description && (
                  <span style={{
                    display: 'block',
                    fontSize: '0.75rem',
                    color: '#64748b',
                    marginTop: 3,
                    lineHeight: 1.35,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {toast.description}
                  </span>
                )}
              </div>
              {toast.onAction && toast.actionText && (
                <button
                  onClick={() => { dismiss(toast.id); toast.onAction?.(); }}
                  style={{
                    marginTop: 8, fontSize: '0.75rem', fontWeight: 700,
                    color: accent, background: 'none', border: 'none',
                    cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: 2,
                  }}
                >
                  {toast.actionText}
                </button>
              )}
            </div>

            <button
              onClick={() => dismiss(toast.id)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: 4, color: '#94a3b8', flexShrink: 0,
                borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              aria-label="ปิด"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
