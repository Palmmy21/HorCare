/**
 * The slip result card sent to the tenant on LINE, laid out like LINE's "Receipt" template:
 * a small coloured status label, the dorm name, then label / value rows.
 * altText is the plain-text reply (tenantSlipReply) so notifications still read correctly.
 */
import { tenantSlipReply, type SlipEvaluation, type SlipOutcome } from './_slip-flow.js';

const STATUS: Record<SlipOutcome, { label: string; color: string; note: string }> = {
    approved: { label: 'ชำระสำเร็จ', color: '#1DB446', note: 'ได้รับยอดแล้ว สถานะบิลเป็น "จ่ายแล้ว" ขอบคุณค่ะ' },
    mismatch: { label: 'สลิปไม่ตรงกับบิล', color: '#DC2626', note: 'ระบบยังไม่ได้รับยอดนี้ กรุณาส่งสลิปที่ถูกต้อง หรือติดต่อเจ้าของหอค่ะ' },
    review: { label: 'รอตรวจสอบ', color: '#D97706', note: 'เจ้าของหอจะตรวจสอบและยืนยันยอดให้ค่ะ' },
};

const CHECKS: { key: 'amount' | 'receiver_name' | 'receiver_account' | 'datetime'; label: string }[] = [
    { key: 'amount', label: 'ยอดเงิน' },
    { key: 'receiver_name', label: 'ชื่อผู้รับ' },
    { key: 'receiver_account', label: 'บัญชีผู้รับ' },
    { key: 'datetime', label: 'วันเวลาโอน' },
];
const CHECK_TEXT = {
    pass: { text: 'ตรง', color: '#1DB446' },
    fail: { text: 'ไม่ตรง', color: '#DC2626' },
    unknown: { text: 'อ่านไม่ได้', color: '#AAAAAA' },
} as const;

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

export function buildSlipResultFlex(input: {
    roomNumber: string;
    dormName?: string | null;
    /** e.g. "บิล ต.ค. 2569" or "ค่าปรับ". */
    itemLabel: string;
    expectedAmount: number;
    evaluation: SlipEvaluation;
}): object {
    const e = input.evaluation;
    const s = STATUS[e.outcome];
    const d = e.details;
    const checks = e.verdict?.checks;
    const when = fmtTime(d?.datetime_iso);

    const slipRows = [
        ...(d?.sender_name ? [row('ผู้โอน', d.sender_name)] : []),
        ...(d?.sender_bank ? [row('ธนาคาร', d.sender_bank)] : []),
        ...(when ? [row('เวลาโอน', when)] : []),
    ];
    const checkRows = checks
        ? CHECKS.map(({ key, label }) => row(label, CHECK_TEXT[checks[key]].text, CHECK_TEXT[checks[key]].color))
        : [];
    const totals = [
        row('ยอดที่ต้องชำระ', baht(input.expectedAmount)),
        row('ยอดในสลิป', d?.amount != null ? baht(d.amount) : '-', checks?.amount === 'fail' ? '#DC2626' : '#111111', true),
    ];
    const separator = { type: 'separator', margin: 'xxl' };
    const section = (rows: object[]) => ({ type: 'box', layout: 'vertical', margin: 'xxl', spacing: 'sm', contents: rows });

    return {
        type: 'flex',
        altText: tenantSlipReply(input.roomNumber, e).split('\n')[0].slice(0, 400),
        contents: {
            type: 'bubble',
            body: {
                type: 'box', layout: 'vertical',
                contents: [
                    { type: 'text', text: s.label, weight: 'bold', color: s.color, size: 'sm' },
                    { type: 'text', text: input.dormName || `ห้อง ${input.roomNumber}`, weight: 'bold', size: 'xxl', margin: 'md', wrap: true },
                    { type: 'text', text: `ห้อง ${input.roomNumber} · ${input.itemLabel}`, size: 'xs', color: '#aaaaaa', wrap: true },
                    ...(slipRows.length ? [separator, section(slipRows)] : []),
                    ...(checkRows.length ? [separator, section(checkRows)] : []),
                    separator,
                    section(totals),
                    ...(e.outcome === 'mismatch' && e.problems.length
                        ? [{ type: 'text', text: e.problems.join('\n'), size: 'xs', color: '#DC2626', wrap: true, margin: 'lg' }]
                        : []),
                    separator,
                    { type: 'text', text: e.outcome === 'review' && !e.qrPresent ? 'อ่าน QR ในสลิปไม่ชัด เจ้าของหอจะตรวจสอบให้ค่ะ' : s.note, size: 'xs', color: '#aaaaaa', wrap: true, margin: 'md' },
                ],
            },
        },
    };
}
