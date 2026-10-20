/**
 * Slip cards sent to the tenant on LINE, laid out like LINE's "Receipt" template:
 * a small coloured status label, the dorm name, then label / value rows.
 * altText is the plain-text reply (tenantSlipReply) so notifications still read correctly.
 */
import { tenantSlipReply, type SlipEvaluation, type SlipOutcome } from './_slip-flow.js';

const STATUS: Record<SlipOutcome, { label: string; color: string; note: string }> = {
    approved: { label: 'ชำระสำเร็จ', color: '#1DB446', note: 'ได้รับยอดแล้ว สถานะบิลเป็น "จ่ายแล้ว" ขอบคุณค่ะ' },
    mismatch: { label: 'สลิปไม่ตรงกับบิล', color: '#DC2626', note: 'ระบบยังไม่ได้รับยอดนี้ กรุณาส่งสลิปที่ถูกต้อง หรือติดต่อเจ้าของหอค่ะ' },
    review: { label: 'รอตรวจสอบ', color: '#D97706', note: 'เจ้าของหอจะตรวจสอบและยืนยันยอดให้ค่ะ' },
};
const GREEN = '#1DB446';
const RED = '#DC2626';
const GREY = '#AAAAAA';

type CheckKey = 'amount' | 'receiver_name' | 'receiver_account' | 'datetime';
const CHECKS: { key: CheckKey; label: string; pass: string; fail: string }[] = [
    { key: 'amount', label: 'ยอดเงิน', pass: 'ตรง', fail: 'ไม่ตรง' },
    { key: 'receiver_name', label: 'ชื่อผู้รับ', pass: 'ตรง', fail: 'ไม่ตรง' },
    { key: 'receiver_account', label: 'บัญชีผู้รับ', pass: 'ตรง', fail: 'ไม่ตรง' },
    { key: 'datetime', label: 'วันที่โอน', pass: 'หลังออกบิล', fail: 'ก่อนออกบิล (สลิปเก่า)' },
];

const baht = (n: number) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtTime = (iso: string | null | undefined): string | null => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? new Date(t).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }) : null;
};

const row = (label: string, value: string, valueColor = '#111111', bold = false) => ({
    type: 'box', layout: 'horizontal', contents: [
        { type: 'text', text: label, size: 'sm', color: '#555555', flex: 0 },
        { type: 'text', text: value, size: 'sm', color: valueColor, align: 'end', wrap: true, ...(bold ? { weight: 'bold' } : {}) },
    ],
});
const separator = { type: 'separator', margin: 'xxl' };
const section = (rows: object[]) => ({ type: 'box', layout: 'vertical', margin: 'xxl', spacing: 'sm', contents: rows });

/** The receipt frame shared by every slip card. */
function receipt(opts: { label: string; color: string; title: string; subtitle: string; sections: object[][]; extra?: object[]; note: string; footer?: object }) {
    return {
        type: 'bubble',
        body: {
            type: 'box', layout: 'vertical',
            contents: [
                { type: 'text', text: opts.label, weight: 'bold', color: opts.color, size: 'sm' },
                { type: 'text', text: opts.title, weight: 'bold', size: 'xxl', margin: 'md', wrap: true },
                { type: 'text', text: opts.subtitle, size: 'xs', color: GREY, wrap: true },
                ...opts.sections.filter(rows => rows.length).flatMap(rows => [separator, section(rows)]),
                ...(opts.extra ?? []),
                separator,
                { type: 'text', text: opts.note, size: 'xs', color: GREY, wrap: true, margin: 'md' },
            ],
        },
        ...(opts.footer ? { footer: opts.footer } : {}),
    };
}

/** LINE postback data for the "split payment" button; parsed by parseSplitPostback. */
export const splitPostbackData = (kind: 'bill' | 'fine', itemId: string, slipRef: string) => `split|${kind}|${itemId}|${slipRef}`;

export function parseSplitPostback(data: string | undefined): { kind: 'bill' | 'fine'; itemId: string; slipRef: string } | null {
    const [tag, kind, itemId, slipRef] = (data ?? '').split('|');
    if (tag !== 'split' || (kind !== 'bill' && kind !== 'fine') || !itemId || !slipRef) return null;
    return { kind, itemId, slipRef };
}

export function buildSlipResultFlex(input: {
    roomNumber: string;
    dormName?: string | null;
    /** e.g. "บิล ต.ค. 2569" or "ค่าปรับ". */
    itemLabel: string;
    expectedAmount: number;
    evaluation: SlipEvaluation;
    /** Postback data for the split-payment button; shown only when the slip can be a part payment. */
    splitPostback?: string | null;
}): object {
    const e = input.evaluation;
    const s = STATUS[e.outcome];
    const d = e.details;
    const checks = e.verdict?.checks;
    const when = fmtTime(d?.datetime_iso);
    const canSplit = e.splitAmount != null && !!input.splitPostback;

    const slipRows = [
        ...(d?.sender_name ? [row('ผู้โอน', d.sender_name)] : []),
        ...(d?.sender_bank ? [row('ธนาคาร', d.sender_bank)] : []),
        ...(when ? [row('เวลาโอน', when)] : []),
    ];
    const checkRows = checks
        ? CHECKS.map(c => {
            const v = checks[c.key];
            return row(c.label, v === 'pass' ? c.pass : v === 'fail' ? c.fail : 'อ่านไม่ได้', v === 'pass' ? GREEN : v === 'fail' ? RED : GREY);
        })
        : [];
    const totals = [
        row('ยอดที่ต้องชำระ', baht(input.expectedAmount)),
        row('ยอดในสลิป', d?.amount != null ? baht(d.amount) : '-', checks?.amount === 'fail' ? RED : '#111111', true),
    ];
    const problems = e.outcome === 'mismatch' && e.problems.length
        ? [{ type: 'text', text: e.problems.join('\n'), size: 'xs', color: RED, wrap: true, margin: 'lg' }]
        : [];

    return {
        type: 'flex',
        altText: tenantSlipReply(input.roomNumber, e).split('\n')[0].slice(0, 400),
        contents: receipt({
            label: s.label, color: s.color,
            title: input.dormName || `ห้อง ${input.roomNumber}`,
            subtitle: `ห้อง ${input.roomNumber} · ${input.itemLabel}`,
            sections: [slipRows, checkRows, totals],
            extra: problems,
            note: canSplit
                ? `ถ้าตั้งใจแบ่งจ่าย กดปุ่มด้านล่างเพื่อบันทึก ${baht(e.splitAmount!)} เป็นยอดชำระบางส่วนได้เลยค่ะ`
                : e.outcome === 'review' && !e.qrPresent ? 'อ่าน QR ในสลิปไม่ชัด เจ้าของหอจะตรวจสอบให้ค่ะ' : s.note,
            footer: canSplit ? {
                type: 'box', layout: 'vertical',
                contents: [{
                    type: 'button', style: 'primary', color: GREEN, height: 'sm',
                    action: { type: 'postback', label: `แบ่งจ่าย ${baht(e.splitAmount!)}`.slice(0, 40), data: input.splitPostback, displayText: 'แบ่งจ่าย' },
                }],
            } : undefined,
        }),
    };
}

/** After a part payment is recorded: what was paid and what is still owed. */
export function buildSplitPaidFlex(input: {
    roomNumber: string;
    dormName?: string | null;
    itemLabel: string;
    paid: number;
    total: number;
    outstanding: number;
}): object {
    const done = input.outstanding <= 0;
    return {
        type: 'flex',
        altText: done
            ? `ชำระครบแล้ว ห้อง ${input.roomNumber} ขอบคุณค่ะ`
            : `รับยอดแบ่งจ่าย ${baht(input.paid)} แล้ว คงเหลือ ${baht(input.outstanding)}`,
        contents: receipt({
            label: done ? 'ชำระครบแล้ว' : 'รับยอดแบ่งจ่ายแล้ว', color: GREEN,
            title: input.dormName || `ห้อง ${input.roomNumber}`,
            subtitle: `ห้อง ${input.roomNumber} · ${input.itemLabel}`,
            sections: [[
                row('ยอดบิล', baht(input.total)),
                row('ชำระครั้งนี้', baht(input.paid), GREEN, true),
                row('ชำระแล้วทั้งหมด', baht(input.total - input.outstanding)),
            ], [
                row('คงเหลือ', baht(Math.max(0, input.outstanding)), done ? GREEN : RED, true),
            ]],
            note: done ? 'ชำระครบแล้ว สถานะบิลเป็น "จ่ายแล้ว" ขอบคุณค่ะ' : 'ส่งสลิปยอดที่เหลือมาได้ทุกเมื่อ ระบบจะตัดยอดให้อัตโนมัติค่ะ',
        }),
    };
}
