/**
 * What the tenant is told in LINE the moment they send a slip, as a Flex message.
 *
 * One card per outcome, in plain words the tenant can act on:
 *   paid            – the slip matched the bill, the receiving account and is not a repeat
 *   duplicate       – this slip was already used
 *   wrong_receiver  – the money went to an account that is not the property's
 *   wrong_amount    – the amount does not match the bill (shows how much is short / over)
 *   old_slip        – the slip's date does not fit this bill
 *   review          – the slip could not be read well enough to decide; the owner will look
 *
 * Pure functions: the webhook decides nothing here, it only passes in what the checks found.
 */
import type { SlipEvaluation } from './_slip-flow.js';
import type { SlipChecks } from '../src/types/index.js';

export type SlipOutcomeKind = 'paid' | 'duplicate' | 'wrong_receiver' | 'wrong_amount' | 'old_slip' | 'review';

export interface SlipReplyInput {
    roomNumber: string;
    dormName: string;
    /** What is being paid: "บิลเดือน กันยายน 2569" / "ค่าปรับ". */
    targetLabel: string;
    expectedAmount: number;
    evaluation: SlipEvaluation | null;
    /** Set when this slip's QR was already used. `sameRoom` = it paid something for this very room. */
    duplicate: { sameRoom: boolean; usedAt?: string | null } | null;
    qrPresent: boolean;
    /** Names the tenant should have paid into, for the "wrong account" card. */
    receiverHint?: string | null;
}

const MONTHS_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** "2026-09" -> "บิลเดือน กันยายน 2569". Anything else is returned as a plain label. */
export function billLabel(month: unknown, isFine: boolean): string {
    if (isFine) return 'ค่าปรับ';
    const m = typeof month === 'string' ? month.match(/^(\d{4})-(\d{2})$/) : null;
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return 'บิลล่าสุด';
    return `บิลเดือน ${MONTHS_TH[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
}

const fail = (c: SlipChecks | undefined, k: keyof SlipChecks) => c?.[k] === 'fail';

/** Which card to show. Order matters: a repeat is decided first, then a genuine match, then the most useful complaint. */
export function classifySlip(i: SlipReplyInput): SlipOutcomeKind {
    if (i.duplicate) return 'duplicate';
    const ev = i.evaluation;
    if (ev?.autoApprove) return 'paid';
    const checks = ev?.verdict?.checks;
    if (fail(checks, 'receiver_name') || fail(checks, 'receiver_account')) return 'wrong_receiver';
    if (fail(checks, 'amount')) return 'wrong_amount';
    if (fail(checks, 'datetime')) return 'old_slip';
    return 'review';
}

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const when = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return null;
    return new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const THEME: Record<SlipOutcomeKind, { color: string; icon: string; title: string }> = {
    paid: { color: '#16A34A', icon: '✅', title: 'ชำระเงินเรียบร้อย' },
    duplicate: { color: '#DC2626', icon: '⚠️', title: 'สลิปนี้ถูกใช้แล้ว' },
    wrong_receiver: { color: '#DC2626', icon: '❌', title: 'บัญชีผู้รับไม่ตรงกับของหอ' },
    wrong_amount: { color: '#EA580C', icon: '💸', title: 'ยอดเงินไม่ตรงกับบิล' },
    old_slip: { color: '#EA580C', icon: '🕒', title: 'วันที่ของสลิปไม่ตรง' },
    review: { color: '#CA8A04', icon: '📨', title: 'ได้รับสลิปแล้ว รอตรวจสอบ' },
};

type Row = [label: string, value: string, emphasis?: boolean];

const row = ([label, value, strong]: Row) => ({
    type: 'box', layout: 'baseline', spacing: 'sm',
    contents: [
        { type: 'text', text: label, color: '#94A3B8', size: 'sm', flex: 3 },
        { type: 'text', text: value, color: strong ? '#0F172A' : '#334155', size: 'sm', flex: 5, wrap: true, weight: strong ? 'bold' : 'regular' },
    ],
});

/** The Flex message (with a plain-text altText for notifications and old clients). */
export function buildSlipFlex(i: SlipReplyInput): { type: 'flex'; altText: string; contents: object } {
    const kind = classifySlip(i);
    const theme = THEME[kind];
    const d = i.evaluation?.details ?? null;
    const paidAmount = d?.amount ?? i.evaluation?.aiAmount ?? null;
    const rows: Row[] = [['ห้อง', i.roomNumber], ['รายการ', i.targetLabel]];
    let headline = '';
    let note = '';

    switch (kind) {
        case 'paid':
            headline = `฿${baht(paidAmount ?? i.expectedAmount)}`;
            rows.push(['สถานะ', 'จ่ายแล้ว', true]);
            if (d?.datetime_iso && when(d.datetime_iso)) rows.push(['โอนเมื่อ', when(d.datetime_iso)!]);
            if (d?.reference) rows.push(['เลขอ้างอิง', d.reference]);
            if (d?.receiver_name) rows.push(['ผู้รับ', d.receiver_name]);
            note = 'ระบบตรวจสลิปอัตโนมัติแล้ว ขอบคุณค่ะ 🙏';
            break;
        case 'duplicate':
            headline = 'ใช้สลิปซ้ำไม่ได้';
            rows.push(['สถานะ', 'ไม่รับสลิปนี้', true]);
            if (i.duplicate?.usedAt && when(i.duplicate.usedAt)) rows.push(['ใช้ไปแล้วเมื่อ', when(i.duplicate.usedAt)!]);
            note = i.duplicate?.sameRoom
                ? 'สลิปนี้เคยใช้ชำระรายการของห้องคุณไปแล้ว หากยังมียอดค้าง กรุณาส่งสลิปการโอนครั้งใหม่ค่ะ'
                : 'กรุณาส่ง "สลิปจริงของการโอนครั้งนี้" หากมั่นใจว่าโอนแล้ว ติดต่อเจ้าของหอได้เลยค่ะ';
            break;
        case 'wrong_receiver':
            headline = 'โอนผิดบัญชี?';
            rows.push(['ผู้รับในสลิป', d?.receiver_name ?? d?.receiver_account ?? 'อ่านไม่ได้', true]);
            if (i.receiverHint) rows.push(['บัญชีของหอ', i.receiverHint]);
            if (paidAmount !== null) rows.push(['ยอดในสลิป', `฿${baht(paidAmount)}`]);
            note = 'ชื่อ/เลขบัญชีผู้รับในสลิปไม่ตรงกับบัญชีที่หอรับเงิน ส่งเรื่องให้เจ้าของหอตรวจสอบแล้ว หากโอนผิดบัญชีกรุณาติดต่อเจ้าของหอค่ะ';
            break;
        case 'wrong_amount': {
            const diff = paidAmount === null ? null : paidAmount - i.expectedAmount;
            headline = paidAmount === null ? 'อ่านยอดไม่ได้' : `฿${baht(paidAmount)}`;
            rows.push(['ยอดที่ต้องชำระ', `฿${baht(i.expectedAmount)}`], ['ยอดในสลิป', paidAmount === null ? '—' : `฿${baht(paidAmount)}`, true]);
            if (diff !== null) rows.push([diff < 0 ? 'ยังขาดอีก' : 'โอนเกิน', `฿${baht(Math.abs(diff))}`, true]);
            note = diff !== null && diff < 0
                ? `กรุณาโอนส่วนที่ขาด ฿${baht(-diff)} แล้วส่งสลิปเพิ่มค่ะ ส่งเรื่องให้เจ้าของหอตรวจสอบแล้ว`
                : 'ส่งเรื่องให้เจ้าของหอตรวจสอบแล้วค่ะ เจ้าของหอจะติดต่อกลับหากต้องดำเนินการเพิ่ม';
            break;
        }
        case 'old_slip':
            headline = 'ตรวจวันที่โอน';
            if (d?.datetime_iso && when(d.datetime_iso)) rows.push(['วันที่ในสลิป', when(d.datetime_iso)!, true]);
            note = 'วันที่โอนในสลิปเก่าเกินไปหรือก่อนออกบิล ส่งเรื่องให้เจ้าของหอตรวจสอบแล้ว หากเป็นสลิปของรอบนี้ไม่ต้องทำอะไรเพิ่มค่ะ';
            break;
        case 'review':
            headline = paidAmount !== null ? `฿${baht(paidAmount)}` : 'รอตรวจสอบ';
            rows.push(['สถานะ', 'เจ้าของหอกำลังตรวจสอบ', true]);
            note = i.qrPresent
                ? 'ตรวจ QR ผ่าน (ไม่ซ้ำ) เจ้าของหอจะยืนยันยอดให้อีกครั้งค่ะ'
                : 'ระบบอ่านสลิปไม่ชัด เจ้าของหอจะตรวจสอบให้ ส่งภาพที่ชัดขึ้นจะตรวจไวกว่าค่ะ';
            break;
    }

    const altText = `${theme.icon} ${theme.title} — ห้อง ${i.roomNumber}${headline.startsWith('฿') ? ` ${headline}` : ''}`.slice(0, 400);
    return {
        type: 'flex',
        altText,
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box', layout: 'vertical', backgroundColor: theme.color, paddingAll: 'lg', spacing: 'xs',
                contents: [
                    { type: 'text', text: `${theme.icon} ${theme.title}`, color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true },
                    { type: 'text', text: i.dormName, color: '#FFFFFFCC', size: 'xs' },
                ],
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'md',
                contents: [
                    { type: 'text', text: headline, size: 'xxl', weight: 'bold', color: theme.color, align: 'center', wrap: true },
                    { type: 'separator', margin: 'sm' },
                    ...rows.map(row),
                ],
            },
            footer: {
                type: 'box', layout: 'vertical',
                contents: [{ type: 'text', text: note, size: 'xs', color: '#64748B', wrap: true }],
            },
        },
    };
}
