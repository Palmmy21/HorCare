import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../utils/api';
import { buildRound, resolveRate, type Booking, type Charge, type ChargePayment, type Rate, type RoundRow, type StallPlan } from '../shared/collections';
import { closuresOn, type ShopClosure } from '../shared/market';

export interface CollectionsSnapshot {
  today: string;
  rooms: { id: string; room_number: string; zone: string | null; is_active: boolean }[];
  closures: ShopClosure[];
  rates: Rate[];
  plans: StallPlan[];
  bookings: Booking[];
  charges: Charge[];
  payments: (ChargePayment & { verification?: string })[];
  attendance: { room_id: string; visit_date: string; present: boolean }[];
  day_closes: { close_date: string; expected_cash_satang: number; counted_cash_satang: number; difference_satang: number; closed_by_name: string }[];
}

/** Today's collection round (one row per stall) from a snapshot: the round screen and the market plan read the same rows. */
export function todayRoundOf(data: CollectionsSnapshot): RoundRow[] {
  const closedToday = new Set(data.rooms.filter(r => closuresOn(data.closures.filter(c => c.room_id === r.id), data.today).length > 0).map(r => r.id));
  const absentToday = new Set(data.attendance.filter(a => a.visit_date === data.today && !a.present).map(a => a.room_id));
  const zone = new Map(data.rooms.map(r => [r.id, r.zone]));
  return buildRound({
    date: data.today, plans: data.plans, charges: data.charges, closedToday, absentToday, rooms: data.rooms.map(r => ({ id: r.id, room_number: r.room_number })),
    dayRateOf: id => resolveRate(data.rates, { purpose: 'stall', unit: 'day', roomId: id, zone: zone.get(id), date: data.today })?.amount_satang ?? null,
    weekRateOf: id => resolveRate(data.rates, { purpose: 'stall', unit: 'week', roomId: id, zone: zone.get(id), date: data.today })?.amount_satang ?? null,
  });
}

const ERRORS: Record<string, string> = {
  supabase_not_configured: 'ยังไม่ได้ตั้งค่า Supabase บนเซิร์ฟเวอร์ (ดู supabase/README.md)',
  invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบช่องที่กรอก',
  room_not_found: 'ไม่พบห้อง/แผงนี้ หรือถูกปิดใช้งาน',
  room_not_available: 'ห้องนี้ไม่ว่างในช่วงวันที่เลือก',
  no_rate: 'ยังไม่ได้ตั้งราคาห้องสำหรับบางคืน — ตั้งราคาที่แท็บ "ราคา" ก่อน',
  deposit_exceeds_total: 'มัดจำมากกว่ายอดรวม',
  bank_account_invalid: 'บัญชีรับเงินนี้ใช้ไม่ได้ (ปิดอยู่หรือไม่พบ)',
  exceeds_outstanding: 'จำนวนเงินเกินยอดค้างชำระ',
  charge_void: 'รายการนี้ถูกยกเลิกแล้ว',
  nothing_to_collect: 'ไม่มียอดที่ต้องเก็บ',
  no_stall_plan: 'แผงนี้ยังไม่มีแผนการเก็บเงิน',
  duplicate_slip: 'สลิปนี้ถูกใช้แล้ว',
  invalid_image: 'ไฟล์สลิปไม่ถูกต้อง (รองรับ JPG / PNG)',
  too_early: 'ยังไม่ถึงวันเช็กอิน',
  stay_already_over: 'พ้นวันเช็กเอาต์แล้ว',
  not_reserved: 'รายการนี้ไม่ได้อยู่ในสถานะจอง',
  not_checked_in: 'ยังไม่ได้เช็กอิน',
  unpaid_balance: 'ยังมียอดค้างชำระ — รับเงินให้ครบก่อนเช็กเอาต์',
  has_payments: 'มีการรับเงินแล้ว — เลือก "ริบมัดจำ" หรือ "คืนเงิน"',
  cannot_cancel: 'ยกเลิกรายการนี้ไม่ได้แล้ว',
  already_closed: 'ปิดยอดวันนี้ไปแล้ว',
  cancel_the_booking_instead: 'ค่าห้องของการจอง — ให้ยกเลิกการจองแทน',
  changed_meanwhile: 'มีคนแก้รายการนี้ไปก่อน — โหลดใหม่แล้วลองอีกครั้ง',
  forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};

export const collectionsError = (e: unknown): string => {
  const err = e as ApiError;
  return ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ';
};

/**
 * One window of collection data for a property (rooms, rates, plans, bookings, charges and their payments), plus `act`
 * to call the server. The server owns every rule — the screens only show what it returns and ask it to change things.
 */
export function useCollections(ownerUid: string, buildingId: string, from: string, to: string) {
  const [data, setData] = useState<CollectionsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiPost<CollectionsSnapshot>('collections', { owner_uid: ownerUid, building_id: buildingId, action: 'snapshot', from, to }));
      setError(null);
    } catch (e) { setError(collectionsError(e)); }
  }, [ownerUid, buildingId, from, to]);
  useEffect(() => { void load(); }, [load]);

  const call = useCallback(<T,>(body: Record<string, unknown>) => apiPost<T>('collections', { owner_uid: ownerUid, building_id: buildingId, ...body }), [ownerUid, buildingId]);

  /** Run an action, toast the outcome, refresh. Returns the response, or null when it failed. */
  const act = useCallback(async <T = Record<string, unknown>,>(key: string, body: Record<string, unknown>, ok?: string): Promise<T | null> => {
    setBusy(key);
    try {
      const r = await call<T>(body);
      if (ok) toast.success(ok);
      await load();
      return r;
    } catch (e) { toast.error(collectionsError(e)); return null; }
    finally { setBusy(null); }
  }, [call, load]);

  const paymentsOf = useMemo(() => {
    const m = new Map<string, ChargePayment[]>();
    for (const p of data?.payments ?? []) m.set(p.charge_id, [...(m.get(p.charge_id) ?? []), p]);
    return m;
  }, [data]);

  return { data, error, busy, load, call, act, paymentsOf };
}
