// What each unit on the plan says in each layer. Pure: the plan screen passes in what it already loaded.
// Every state carries a text label (and the screen an icon), so colour is never the only key.
import { contractState, daysUntil } from './floorPlan';
import type { RoomStatus } from './roomOccupancy';
import type { RoundStatus } from './collections';

export type PlanLayer = 'occupancy' | 'payment' | 'contract' | 'jobs' | 'today';
/** base = the normal state (plain tile); muted = nothing there (vacant); good / warn / bad = done / needs you / overdue. */
export type Tone = 'base' | 'muted' | 'good' | 'warn' | 'bad';

export interface UnitFacts {
  status: RoomStatus;
  /** This month's bill, if any. */
  bill?: { payment_status?: 'paid' | 'pending' | 'unpaid'; total: number } | null;
  contractEnd?: string;
  openJobs: number;
  /** Market stalls: today's round status; undefined when the property has no round data. */
  today?: RoundStatus;
}

export interface UnitMark { tone: Tone; label: string; icon: 'check' | 'clock' | 'alert' | 'minus' | 'wrench' | 'calendar' | 'none' }

export const LAYER_LABELS: Record<PlanLayer, string> = {
  occupancy: 'การเข้าพัก', payment: 'การจ่ายเงิน', contract: 'สัญญา', jobs: 'งานค้าง', today: 'วันนี้',
};

export function unitMark(layer: PlanLayer, f: UnitFacts, today: string, labels: { occupied: string; vacant: string; reserved: string }): UnitMark {
  const vacant = f.status === 'vacant';
  switch (layer) {
    case 'occupancy':
      if (f.status === 'occupied') return { tone: 'base', label: labels.occupied, icon: 'none' };
      if (f.status === 'reserved') return { tone: 'warn', label: labels.reserved, icon: 'calendar' };
      return { tone: 'muted', label: labels.vacant, icon: 'minus' };
    case 'payment': {
      const s = f.bill ? f.bill.payment_status ?? 'unpaid' : null;
      if (s === 'paid') return { tone: 'good', label: 'จ่ายแล้ว', icon: 'check' };
      if (s === 'pending') return { tone: 'warn', label: 'รอตรวจสลิป', icon: 'clock' };
      if (s === 'unpaid') return { tone: 'bad', label: 'ค้างชำระ', icon: 'alert' };
      return vacant ? { tone: 'muted', label: labels.vacant, icon: 'minus' } : { tone: 'base', label: 'ยังไม่มีบิล', icon: 'none' };
    }
    case 'contract': {
      if (vacant) return { tone: 'muted', label: labels.vacant, icon: 'minus' };
      const s = contractState(f.contractEnd, today);
      if (s === 'ended') return { tone: 'bad', label: 'สัญญาหมดแล้ว', icon: 'alert' };
      if (s === 'ending') return { tone: 'warn', label: `เหลือ ${daysUntil(f.contractEnd!, today)} วัน`, icon: 'calendar' };
      if (s === 'ok') return { tone: 'good', label: 'สัญญาปกติ', icon: 'check' };
      return { tone: 'base', label: 'ไม่มีวันสิ้นสุด', icon: 'none' };
    }
    case 'jobs':
      return f.openJobs > 0
        ? { tone: 'warn', label: `งานค้าง ${f.openJobs}`, icon: 'wrench' }
        : { tone: vacant ? 'muted' : 'base', label: vacant ? labels.vacant : 'ไม่มีงานค้าง', icon: 'none' };
    case 'today':
      switch (f.today) {
        case 'paid': return { tone: 'good', label: 'เก็บแล้ว', icon: 'check' };
        case 'partial': return { tone: 'warn', label: 'เก็บบางส่วน', icon: 'clock' };
        case 'due': return { tone: 'warn', label: 'ยังไม่เก็บ', icon: 'clock' };
        case 'absent': return { tone: 'muted', label: 'ไม่มาขาย', icon: 'minus' };
        case 'closed': return { tone: 'muted', label: 'ปิดวันนี้', icon: 'minus' };
        default: return vacant ? { tone: 'muted', label: labels.vacant, icon: 'minus' } : { tone: 'base', label: 'รายเดือน', icon: 'none' };
      }
  }
}

/** Counts per label for the layer legend, in the order the labels first appear by tone. */
export function legendOf(marks: UnitMark[]): { tone: Tone; label: string; icon: UnitMark['icon']; count: number }[] {
  const order: Tone[] = ['bad', 'warn', 'good', 'base', 'muted'];
  const map = new Map<string, { tone: Tone; label: string; icon: UnitMark['icon']; count: number }>();
  for (const m of marks) {
    const k = `${m.tone}|${m.label}`;
    const e = map.get(k);
    if (e) e.count++; else map.set(k, { ...m, count: 1 });
  }
  return [...map.values()].sort((a, b) => order.indexOf(a.tone) - order.indexOf(b.tone) || b.count - a.count);
}
