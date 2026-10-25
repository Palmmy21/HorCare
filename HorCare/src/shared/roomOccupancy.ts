// Room occupancy derived from contracts. Pure, so it can be tested and shared.
//
// Precedence: the leasing module (leases / reservations) → the tenant profile (E-Sign contract, move-in / contract /
// move-out dates) → the old hand-set `room_status` (only when a room has no contract information at all) → vacant.
// An admin override wins only while the contract facts it was made against are unchanged (`contract_key`): when the
// contract changes, the room goes back to following the contract by itself.
// Dates are Thai calendar days ("YYYY-MM-DD").

export type RoomStatus = 'occupied' | 'vacant' | 'reserved';
export const ROOM_STATUSES: RoomStatus[] = ['occupied', 'vacant', 'reserved'];

export type OccupancySource = 'lease' | 'lease_scheduled' | 'reservation' | 'e_sign' | 'profile' | 'move_out' | 'legacy' | 'none';

export const SOURCE_LABELS_TH: Record<OccupancySource, string> = {
  lease: 'สัญญาเช่า (หน้าปล่อยเช่า)',
  lease_scheduled: 'สัญญาที่รอเริ่ม (หน้าปล่อยเช่า)',
  reservation: 'การจอง (หน้าปล่อยเช่า)',
  e_sign: 'สัญญา E-Sign',
  profile: 'ข้อมูลผู้เช่า',
  move_out: 'วันย้ายออกในข้อมูลผู้เช่า',
  legacy: 'ตั้งไว้ด้วยมือ (ระบบเดิม)',
  none: 'ไม่มีสัญญา',
};

export interface LeaseFacts { id: string; room_id: string; status: string; start_date: string; end_date: string; tenant_name?: string }
export interface ReservationFacts { id: string; room_id: string; status: string; reserved_until: string; lead_name?: string }
export interface ProfileFacts {
  full_name?: string;
  move_in_date?: string;
  contract_end_date?: string;
  expected_move_out?: string;
  signed_contract?: { id: string; contract_number?: string; status: string; start_date?: string; end_date?: string };
}

export interface StatusOverride {
  status: RoomStatus;
  reason: string;
  set_at: string;              // ISO timestamp
  set_by?: string;             // display name
  contract_key: string;        // the contract facts this override was made against
}

export interface AutoOccupancy {
  status: RoomStatus;
  source: OccupancySource;
  /** One line explaining why, in Thai. */
  detail: string;
  /** Something about the contract the owner should look at (e.g. it ran out but nobody closed it). */
  warning?: string;
  /** Identity of the deciding facts; an override is tied to it. */
  key: string;
}

export interface Occupancy extends AutoOccupancy {
  auto: AutoOccupancy;
  override?: StatusOverride;
}

const thDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
};
const nonEmpty = (s?: string | null): s is string => typeof s === 'string' && s.trim() !== '';

/** What the contracts say about one room today. */
export function contractOccupancy(
  input: { leases?: LeaseFacts[]; reservations?: ReservationFacts[]; profile?: ProfileFacts | null; legacyStatus?: RoomStatus },
  today: string,
): AutoOccupancy {
  const leases = input.leases ?? [];
  const active = leases.find(l => l.status === 'active');
  if (active) {
    const who = nonEmpty(active.tenant_name) ? `${active.tenant_name} · ` : '';
    return {
      status: 'occupied', source: 'lease', key: `lease:${active.id}:active:${active.end_date}`,
      detail: `${who}สัญญาถึง ${thDate(active.end_date)}`,
      warning: active.end_date < today ? 'สัญญาเลยวันสิ้นสุดแล้ว แต่ยังไม่ได้ปิดหรือต่อสัญญาในหน้าปล่อยเช่า' : undefined,
    };
  }
  const scheduled = leases.filter(l => l.status === 'scheduled').sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  if (scheduled) {
    const who = nonEmpty(scheduled.tenant_name) ? `${scheduled.tenant_name} · ` : '';
    return {
      status: 'reserved', source: 'lease_scheduled', key: `lease:${scheduled.id}:scheduled:${scheduled.start_date}`,
      detail: `${who}สัญญาเริ่ม ${thDate(scheduled.start_date)}`,
      warning: scheduled.start_date <= today ? 'ถึงวันเริ่มสัญญาแล้ว แต่ยังไม่ได้กดเริ่มสัญญาในหน้าปล่อยเช่า' : undefined,
    };
  }
  const reservation = (input.reservations ?? []).find(r => r.status === 'active' && r.reserved_until >= today);
  if (reservation) {
    const who = nonEmpty(reservation.lead_name) ? `${reservation.lead_name} · ` : '';
    return {
      status: 'reserved', source: 'reservation', key: `reservation:${reservation.id}:active:${reservation.reserved_until}`,
      detail: `${who}จองถึง ${thDate(reservation.reserved_until)}`,
    };
  }

  const p = input.profile;
  if (p) {
    const pKey = `profile:${p.move_in_date ?? ''}|${p.contract_end_date ?? ''}|${p.expected_move_out ?? ''}|${p.signed_contract ? `${p.signed_contract.id}:${p.signed_contract.status}` : ''}|${nonEmpty(p.full_name) ? 1 : 0}`;
    if (nonEmpty(p.expected_move_out) && p.expected_move_out <= today) {
      return { status: 'vacant', source: 'move_out', key: pKey, detail: `ย้ายออกเมื่อ ${thDate(p.expected_move_out)}` };
    }
    const sc = p.signed_contract;
    if (sc?.status === 'pending_lessee') {
      const num = nonEmpty(sc.contract_number) ? ` ${sc.contract_number}` : '';
      return { status: 'reserved', source: 'e_sign', key: pKey, detail: `ส่งสัญญา${num} แล้ว รอผู้เช่าเซ็น` };
    }
    if (sc?.status === 'signed' && !(nonEmpty(sc.end_date) && sc.end_date < today)) {
      if (nonEmpty(sc.start_date) && sc.start_date > today) {
        return { status: 'reserved', source: 'e_sign', key: pKey, detail: `สัญญา E-Sign เริ่ม ${thDate(sc.start_date)}` };
      }
      return {
        status: 'occupied', source: 'e_sign', key: pKey,
        detail: nonEmpty(sc.end_date) ? `สัญญา E-Sign ถึง ${thDate(sc.end_date)}` : 'สัญญา E-Sign (ไม่มีวันสิ้นสุด)',
      };
    }
    if (nonEmpty(p.move_in_date)) {
      if (p.move_in_date > today) {
        return { status: 'reserved', source: 'profile', key: pKey, detail: `จะเข้าอยู่ ${thDate(p.move_in_date)}` };
      }
      const ended = nonEmpty(p.contract_end_date) && p.contract_end_date < today;
      return {
        status: 'occupied', source: 'profile', key: pKey,
        detail: nonEmpty(p.contract_end_date) ? `เข้าอยู่ ${thDate(p.move_in_date)} · สัญญาถึง ${thDate(p.contract_end_date)}` : `เข้าอยู่ตั้งแต่ ${thDate(p.move_in_date)}`,
        warning: ended ? 'สัญญาหมดแล้ว ยังไม่มีวันย้ายออกหรือสัญญาใหม่' : undefined,
      };
    }
    if (nonEmpty(p.full_name)) {
      return {
        status: 'occupied', source: 'profile', key: pKey, detail: 'มีข้อมูลผู้เช่า แต่ยังไม่ได้ใส่วันเข้าอยู่',
        warning: 'ใส่วันเข้าอยู่ / วันสิ้นสุดสัญญา เพื่อให้สถานะถูกต้องตามสัญญา',
      };
    }
  }

  if (input.legacyStatus && input.legacyStatus !== 'vacant') {
    return {
      status: input.legacyStatus, source: 'legacy', key: 'none',
      detail: 'ยังไม่มีสัญญา — ใช้สถานะที่เคยตั้งไว้',
      warning: 'บันทึกสัญญาหรือข้อมูลผู้เช่า เพื่อให้สถานะคิดจากสัญญาจริง',
    };
  }
  return { status: 'vacant', source: 'none', key: 'none', detail: 'ไม่มีสัญญาหรือการจอง' };
}

/** The status shown: the admin's override while it still matches the contract, otherwise the contract's. */
export function effectiveOccupancy(auto: AutoOccupancy, override?: StatusOverride | null): Occupancy {
  if (override && override.contract_key === auto.key && override.status !== auto.status) {
    return { ...auto, status: override.status, auto, override };
  }
  return { ...auto, auto };
}

/** Admin override input: a real status, different from the contract's, with a reason. Null when not acceptable. */
export function cleanOverride(
  raw: { status: unknown; reason: unknown },
  auto: AutoOccupancy,
  meta: { now: Date; by?: string },
): StatusOverride | null {
  if (typeof raw.status !== 'string' || !(ROOM_STATUSES as string[]).includes(raw.status)) return null;
  if (raw.status === auto.status) return null; // same as the contract: nothing to override
  if (typeof raw.reason !== 'string') return null;
  const reason = raw.reason.trim();
  if (reason.length < 3 || reason.length > 300) return null;
  return {
    status: raw.status as RoomStatus, reason, set_at: meta.now.toISOString(), contract_key: auto.key,
    ...(meta.by ? { set_by: meta.by.slice(0, 100) } : {}),
  };
}
