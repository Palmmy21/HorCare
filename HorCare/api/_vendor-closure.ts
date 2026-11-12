/**
 * A market vendor says "my stall is closed" from the LINE chat (HorCare Markets OA) — three taps, no form:
 *
 *   "แจ้งหยุด"  →  วันนี้ / พรุ่งนี้ / เลือกวัน   →  เหตุผล   →  saved (the market sees it at once)
 *              →  หยุดหลายวัน: first day (calendar) → last day (calendar, or 1 / 2 weeks, 1 month) → เหตุผล → saved
 *   "วันหยุดที่แจ้ง" → the stall's upcoming closures, each with a cancel button
 *
 * The same rules as the stall's portal form (src/shared/market.ts cleanClosureInput, the limits in api/_market.ts), and
 * the same record, so the round, the revenue audit and POS Care all see it. Only stalls of a market property, and only
 * stalls this LINE account is registered to.
 */
import { randomUUID } from 'node:crypto';
import { db } from './_firebase.js';
import { notify } from './_notify.js';
import { linkedRooms } from './_line-binding.js';
import {
    CLOSURE_REASONS, CLOSURE_REASON_LABELS_TH, MAX_ACTIVE_CLOSURES_PER_ROOM, MAX_CLOSURE_DAYS, addDays, cleanClosureInput, daysBetween, isValidDate, todayTh, upcomingClosures,
    type ClosureReason, type ShopClosure,
} from '../src/shared/market.js';
import type { LinkedRoom } from '../src/shared/lineRooms.js';

const say = (text: string, quick?: { label: string; data?: string; text?: string; date?: boolean; min?: string; max?: string }[]) => ({
    type: 'text', text: text.slice(0, 4900),
    ...(quick && quick.length ? {
        quickReply: {
            items: quick.slice(0, 13).map(q => ({
                type: 'action',
                action: q.date
                    ? { type: 'datetimepicker', label: q.label.slice(0, 20), data: q.data, mode: 'date', initial: q.min ?? todayTh(), min: q.min ?? todayTh(), max: q.max ?? addDays(todayTh(), 59) }
                    : q.data ? { type: 'postback', label: q.label.slice(0, 20), data: q.data, displayText: q.label } : { type: 'message', label: q.label.slice(0, 20), text: q.text ?? q.label },
            })),
        },
    } : {}),
});

const dayLabel = (d: string) => new Date(`${d}T00:00:00+07:00`).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short' });
/** "วันจันทร์ 3 พ.ย." or "วันจันทร์ 3 พ.ย. – วันอาทิตย์ 9 พ.ย. (7 วัน)". */
const spanLabel = (from: string, to: string) => from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)} (${daysBetween(from, to) + 1} วัน)`;
const isMarketProperty = async (r: LinkedRoom) =>
    ((await db.doc(`users/${r.uid}/buildings/${r.building_id}/data/config`).get()).data()?.building_type) === 'market';

/** The market stalls this LINE account may speak for. */
async function vendorStalls(lineUserId: string): Promise<LinkedRoom[]> {
    const rooms = await linkedRooms(lineUserId);
    const out: LinkedRoom[] = [];
    for (const r of rooms) if (await isMarketProperty(r)) out.push(r);
    return out;
}

export const isVendorClosurePostback = (data: string | undefined) => !!data && /^(shopclose|shopclose_range|shopclose_save|shopclose_cancel)\|/.test(data);

/** "แจ้งหยุด": pick the stall (when there are several), then the day. */
export async function startVendorClosure(lineUserId: string): Promise<object[]> {
    const stalls = await vendorStalls(lineUserId);
    if (stalls.length === 0) return [say('การแจ้งหยุดใช้ได้กับแผงในตลาดที่ลงทะเบียน LINE ไว้ค่ะ หากเป็นผู้ค้า กรุณาสแกน QR ของแผงเพื่อลงทะเบียนก่อน')];
    if (stalls.length > 1) {
        return [say('แจ้งหยุดแผงไหนคะ', stalls.slice(0, 12).map(s => ({ label: `แผง ${s.room_number}`, data: `shopclose|${s.room_id}|ask` })))];
    }
    return askDay(stalls[0]);
}

function askDay(stall: LinkedRoom): object[] {
    const today = todayTh();
    return [say(`แผง ${stall.room_number} หยุดวันไหนคะ`, [
        { label: 'วันนี้', data: `shopclose|${stall.room_id}|${today}` },
        { label: 'พรุ่งนี้', data: `shopclose|${stall.room_id}|${addDays(today, 1)}` },
        { label: 'เลือกวันอื่น', data: `shopclose|${stall.room_id}|pick`, date: true },
        { label: 'หยุดหลายวัน', data: `shopclose_range|${stall.room_id}|from`, date: true },
        { label: 'ยกเลิก', text: 'ยกเลิก' },
    ])];
}

/** The last day of a long closure: a calendar from the first day, or a week / two weeks / a month (up to MAX_CLOSURE_DAYS). */
function askLastDay(stall: LinkedRoom, from: string): object[] {
    const last = addDays(from, MAX_CLOSURE_DAYS - 1);
    const preset = (label: string, days: number) => ({ label, data: `shopclose_range|${stall.room_id}|${from}|${addDays(from, days - 1)}` });
    return [say(`แผง ${stall.room_number} เริ่มหยุด${dayLabel(from)}\nหยุดถึงวันไหนคะ (สูงสุด ${MAX_CLOSURE_DAYS} วัน)`, [
        { label: 'เลือกวันสุดท้าย', data: `shopclose_range|${stall.room_id}|${from}|pick`, date: true, min: from, max: last },
        preset('1 สัปดาห์', 7), preset('2 สัปดาห์', 14), preset('1 เดือน', 30),
        { label: 'ยกเลิก', text: 'ยกเลิก' },
    ])];
}

const askReason = (stall: LinkedRoom, from: string, to: string) =>
    [say(`แผง ${stall.room_number} หยุด${spanLabel(from, to)} เพราะอะไรคะ`, CLOSURE_REASONS.map(r => ({ label: CLOSURE_REASON_LABELS_TH[r], data: `shopclose_save|${stall.room_id}|${from}|${r}|${to}` })))];

/** The buttons of the conversation (and the date picker). */
export async function handleVendorClosurePostback(lineUserId: string, data: string, pickedDate?: string): Promise<object[]> {
    const parts = data.split('|');
    const stalls = await vendorStalls(lineUserId);

    if (parts[0] === 'shopclose_cancel') {
        const id = parts[1] ?? '';
        for (const s of stalls) {
            const ref = db.doc(`users/${s.uid}/buildings/${s.building_id}/shop_closures/${id}`);
            const c = (await ref.get()).data() as ShopClosure | undefined;
            if (!c || c.room_id !== s.room_id) continue;
            if (c.status !== 'active') return [say('รายการนี้ยกเลิกไปแล้วค่ะ')];
            await ref.update({ status: 'cancelled' });
            return [say(`ยกเลิกการแจ้งหยุด ${spanLabel(c.from_date, c.to_date)} แล้วค่ะ ✅`)];
        }
        return [say('ไม่พบรายการนี้ค่ะ')];
    }

    const stall = stalls.find(s => s.room_id === parts[1]);
    if (!stall) return [say('ไม่พบแผงนี้ในบัญชี LINE ของคุณค่ะ')];

    if (parts[0] === 'shopclose') {
        const when = parts[2] === 'pick' ? pickedDate : parts[2] === 'ask' ? null : parts[2];
        if (!when) return askDay(stall);
        return askReason(stall, when, when);
    }

    if (parts[0] === 'shopclose_range') {
        // shopclose_range|room|from  (calendar: first day)  →  shopclose_range|room|<first>|pick (calendar) or |<last> (preset)
        const today = todayTh();
        const from = parts[2] === 'from' ? pickedDate : parts[2];
        if (!isValidDate(from) || from < today) return askDay(stall);
        if (parts.length < 4) return askLastDay(stall, from);
        const to = parts[3] === 'pick' ? pickedDate : parts[3];
        if (!isValidDate(to) || to < from) return [say('วันสุดท้ายต้องไม่ก่อนวันเริ่มหยุดค่ะ เลือกใหม่อีกครั้งนะคะ'), ...askLastDay(stall, from)];
        if (daysBetween(from, to) + 1 > MAX_CLOSURE_DAYS) return [say(`แจ้งหยุดได้ครั้งละไม่เกิน ${MAX_CLOSURE_DAYS} วันค่ะ ถ้าหยุดนานกว่านี้ แจ้งเป็นสองช่วง หรือติดต่อเจ้าหน้าที่ตลาด`), ...askLastDay(stall, from)];
        return askReason(stall, from, to);
    }

    // shopclose_save|room|from|reason[|to]  (no `to`: one day, as sent before long closures existed)
    const input = cleanClosureInput({ from_date: parts[2], to_date: parts[4] ?? parts[2], reason: parts[3] as ClosureReason });
    if (!input) return [say('วันที่นี้แจ้งไม่ได้แล้วค่ะ (แจ้งได้ตั้งแต่วันนี้เป็นต้นไป ครั้งละไม่เกิน 60 วัน) กด "แจ้งหยุด" เพื่อเลือกใหม่', [{ label: 'แจ้งหยุด', text: 'แจ้งหยุด' }])];
    const base = `users/${stall.uid}/buildings/${stall.building_id}`;
    const col = `${base}/shop_closures`;
    const mine = (await db.collection(col).where('room_id', '==', stall.room_id).get()).docs.map(d => d.data() as ShopClosure);
    const existing = upcomingClosures(mine, todayTh());
    const clash = existing.find(c => c.from_date <= input.to_date && input.from_date <= c.to_date);
    if (clash) return [say(`แผง ${stall.room_number} แจ้งหยุด${spanLabel(clash.from_date, clash.to_date)} ไว้แล้ว ซึ่งทับกับช่วงที่เลือกค่ะ\nยกเลิกรายการเดิมก่อน แล้วแจ้งใหม่ได้เลย`, [{ label: 'วันหยุดที่แจ้ง', text: 'วันหยุดที่แจ้ง' }])];
    if (existing.length >= MAX_ACTIVE_CLOSURES_PER_ROOM) return [say('แจ้งหยุดล่วงหน้าไว้ครบ 10 รายการแล้วค่ะ ยกเลิกบางรายการก่อน', [{ label: 'วันหยุดที่แจ้ง', text: 'วันหยุดที่แจ้ง' }])];
    const closure: ShopClosure = {
        id: randomUUID(), room_id: stall.room_id, room_number: stall.room_number, ...input, note: 'แจ้งทาง LINE', status: 'active', created_at: new Date().toISOString(),
    };
    await db.doc(`${col}/${closure.id}`).set(closure);
    await notify({
        event: 'shop.closure_submitted', ownerUid: stall.uid, buildingId: stall.building_id,
        data: { room_number: stall.room_number, from_date: input.from_date, to_date: input.to_date, reason: CLOSURE_REASON_LABELS_TH[input.reason] },
    });
    return [say(
        `✅ บันทึกแล้ว: แผง ${stall.room_number} หยุด${spanLabel(input.from_date, input.to_date)} (${CLOSURE_REASON_LABELS_TH[input.reason]})\n\nตลาดได้รับแจ้งแล้ว ${input.from_date === input.to_date ? 'วันนั้น' : 'ช่วงนั้น'}จะไม่มีการเรียกเก็บค่าแผงรายวันค่ะ`,
        [{ label: 'วันหยุดที่แจ้ง', text: 'วันหยุดที่แจ้ง' }, { label: 'แจ้งหยุดอีกวัน', text: 'แจ้งหยุด' }],
    )];
}

/** "วันหยุดที่แจ้ง": what is coming up, with a cancel button each. */
export async function listVendorClosures(lineUserId: string): Promise<object[]> {
    const stalls = await vendorStalls(lineUserId);
    if (stalls.length === 0) return [say('การแจ้งหยุดใช้ได้กับแผงในตลาดที่ลงทะเบียน LINE ไว้ค่ะ')];
    const all: ShopClosure[] = [];
    for (const s of stalls) {
        const list = (await db.collection(`users/${s.uid}/buildings/${s.building_id}/shop_closures`).where('room_id', '==', s.room_id).get()).docs.map(d => d.data() as ShopClosure);
        all.push(...upcomingClosures(list, todayTh()));
    }
    if (all.length === 0) return [say('ยังไม่มีวันหยุดที่แจ้งไว้ค่ะ', [{ label: 'แจ้งหยุด', text: 'แจ้งหยุด' }])];
    const lines = all.slice(0, 12).map(c => `• แผง ${c.room_number} ${spanLabel(c.from_date, c.to_date)} (${CLOSURE_REASON_LABELS_TH[c.reason]})`);
    return [say(`วันหยุดที่แจ้งไว้\n${lines.join('\n')}\n\nกดปุ่มด้านล่างเพื่อยกเลิก`, all.slice(0, 12).map(c => ({ label: `ยกเลิก ${c.from_date.slice(5)} ${c.room_number}`, data: `shopclose_cancel|${c.id}` })))];
}
