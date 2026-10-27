import type { Fine, MonthlyBill } from '../src/types/index.js';
import * as crypto from 'crypto';

export function verifyLineSignature(rawBody: Buffer | string, secret: string, signature: string): boolean {
    if (!signature) return false;
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    const computed = Buffer.from(hmac.digest('base64'));
    try {
        return crypto.timingSafeEqual(computed, Buffer.from(signature));
    } catch {
        return false;
    }
}

/**
 * Staff (technician / housekeeping) use a separate LINE Official Account from tenants,
 * with its own channel credentials. Pass this as the 	oken of lineReply/linePush.
 */
export const staffLineToken = (): string | undefined => process.env.LINE_STAFF_CHANNEL_ACCESS_TOKEN;

/** 	oken defaults to the tenant OA's access token. */
export async function lineReply(replyToken: string, messages: object[], token: string | undefined = process.env.LINE_CHANNEL_ACCESS_TOKEN): Promise<void> {
    if (!token) return;
    await fetch('https://api.line.me/v2/bot/message/reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ replyToken, messages }),
    });
}

/** Download the binary content of an image/file message the user sent. */
export async function getLineImageContent(messageId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) return null;
    const res = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, contentType };
}

export async function linePush(to: string, messages: object[], token: string | undefined = process.env.LINE_CHANNEL_ACCESS_TOKEN): Promise<void> {
    if (!token) return;

    // ยิงพร้อม retry สั้นๆ เมื่อโดน rate-limit (429) — ตอน 1000 หอบิลจะไม่หายเงียบ.
    // throw เมื่อส่งไม่สำเร็จ เพื่อให้ผู้เรียก (send-line-bills) ไม่ mark is_notified
    // และเจ้าของกดส่งซ้ำได้
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch('https://api.line.me/v2/bot/message/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ to, messages }),
        });
        if (res.ok) return;

        // 429 = rate-limit, 5xx = LINE ขัดข้องชั่วคราว → รอแล้วลองใหม่
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt === 2) {
            const detail = await res.text().catch(() => '');
            throw new Error(`LINE push ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
        }
        const wait = Number(res.headers.get('retry-after')) * 1000 || 400 * (attempt + 1);
        await new Promise(r => setTimeout(r, wait));
    }
}

/** รันงาน async เป็นชุดละ `limit` ตัว — กัน fan-out ระเบิดตอนหอใหญ่ */
export async function runPooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
    for (let i = 0; i < items.length; i += limit) {
        await Promise.all(items.slice(i, i + limit).map(worker));
    }
}

const THAI_MONTHS = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** '2026-06' → 'มิ.ย. 2569' */
export function thaiMonthLabel(month: string): string {
    const [year, mon] = (month || '').split('-');
    if (!year || !mon) return month || '';
    return `${THAI_MONTHS[parseInt(mon)]} ${parseInt(year) + 543}`;
}

import { BillLanguage, t, tBilingual, formatMonthLabel, type TranslationKey } from './_translations.js';
import type { InvoicePay } from './_payment-qr.js';

interface BillFlexOptions {
    portalUrl?: string;
    lang?: BillLanguage;
    bilingual?: boolean;
    secLang?: BillLanguage;
    /** Where to pay; the QR and the account go inside the invoice instead of in separate messages. */
    pay?: InvoicePay;
}

/** LINE postback data for "แบ่งจ่าย" on a bill / fine; parsed by parseSplitModePostback. */
export const splitModePostbackData = (kind: 'bill' | 'fine', itemId: string) => `splitmode|${kind}|${itemId}`;

export function parseSplitModePostback(data: string | undefined): { kind: 'bill' | 'fine'; itemId: string } | null {
    const [tag, kind, itemId] = (data ?? '').split('|');
    if (tag !== 'splitmode' || (kind !== 'bill' && kind !== 'fine') || !itemId) return null;
    return { kind, itemId };
}

/** "แบ่งจ่าย" on an invoice: the tenant says the next slip pays only part of it. */
const splitPayButton = (kind: 'bill' | 'fine', itemId: string, label: string) => ({
    type: 'button', style: 'secondary', height: 'sm', margin: 'sm',
    action: { type: 'postback', label: label.slice(0, 40), data: splitModePostbackData(kind, itemId), displayText: label.replace(/^\S+\s/, '') },
});

// Invoice palette — the app's navy / blue on white, one accent per state.
const INK = '#102A43';
const MUTED = '#7B8FA6';
const LINE_C = '#E4EAF1';
const BRAND = '#0A6CC2';
const STATUS: Record<'unpaid' | 'pending' | 'paid', { fg: string; bg: string; key: TranslationKey }> = {
    unpaid: { fg: '#C2410C', bg: '#FFF1E6', key: 'flex_status_unpaid' },
    pending: { fg: '#0A6CC2', bg: '#E8F1FA', key: 'flex_status_pending' },
    paid: { fg: '#15803D', bg: '#E7F5EC', key: 'flex_status_paid' },
};

/** Labels without the emoji the older cards used ("📋 ใบแจ้งค่าบริการ" → "ใบแจ้งค่าบริการ"). */
const plain = (s: string) => s.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[\s\p{Extended_Pictographic}\u{FE0F}]+$/u, '').trim();
const baht = (n: number, decimals = false) =>
    `฿${(Number(n) || 0).toLocaleString('th-TH', decimals ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 })}`;

/** One line of the invoice: name (+ a small detail line such as the meter readings) and its amount. */
const itemRow = (name: string, amount: number, detail?: string) => ({
    type: 'box', layout: 'horizontal', spacing: 'md',
    contents: [
        {
            type: 'box', layout: 'vertical', flex: 5,
            contents: [
                { type: 'text', text: name, size: 'sm', color: INK, wrap: true },
                ...(detail ? [{ type: 'text', text: detail, size: 'xxs', color: MUTED, wrap: true, margin: 'xs' }] : []),
            ],
        },
        { type: 'text', text: baht(amount), size: 'sm', color: INK, align: 'end', flex: 3, gravity: 'top' },
    ],
});

const reading = (prev: unknown, curr: unknown, units: number, unit: string) =>
    typeof prev === 'number' && typeof curr === 'number'
        ? `${prev.toLocaleString('th-TH')} → ${curr.toLocaleString('th-TH')} · ${units.toLocaleString('th-TH')} ${unit}`
        : `${(units ?? 0).toLocaleString('th-TH')} ${unit}`;

type PayState = 'unpaid' | 'pending' | 'paid';
const payState = (s?: string): PayState => (s === 'paid' ? 'paid' : s === 'pending' ? 'pending' : 'unpaid');

/**
 * The one invoice layout every LINE bill uses (monthly bill, fine): dorm + status, room, the amount and when it is
 * due, every line item, the total, then where to pay with the QR — all in a single bubble.
 */
function invoiceCard(o: {
    lang: BillLanguage;
    L: (key: TranslationKey) => string;
    altText: string;
    dormName: string;
    state: PayState;
    room: string;
    subtitle: string;
    total: number;
    /** e.g. "กำหนดชำระ 5 ต.ค. 2569"; orange while unpaid. */
    when: string;
    items: object[];
    pay?: InvoicePay;
    portalUrl?: string;
    portalLabel: string;
    split?: { kind: 'bill' | 'fine'; id: string };
}): object {
    const st = STATUS[o.state];
    const open = o.state !== 'paid';
    const pay = open ? o.pay : undefined;
    const payBlock = pay ? [{
        type: 'box', layout: 'vertical', margin: 'xl', paddingAll: '16px', cornerRadius: '14px', backgroundColor: '#F4F7FB', spacing: 'xs',
        contents: [
            { type: 'text', text: o.L('flex_pay_to'), size: 'xxs', color: MUTED, align: 'center' },
            ...(pay.qrUrl ? [
                { type: 'image', url: pay.qrUrl, size: '190px', aspectRatio: '1:1', aspectMode: 'fit', margin: 'md', backgroundColor: '#FFFFFF' },
                { type: 'text', text: plain(t('scan_promptpay', o.lang)), size: 'xxs', color: MUTED, align: 'center', margin: 'sm', wrap: true },
            ] : []),
            { type: 'text', text: pay.bank, size: 'sm', weight: 'bold', color: INK, align: 'center', margin: 'md', wrap: true },
            { type: 'text', text: pay.accountName, size: 'xs', color: INK, align: 'center', wrap: true },
            { type: 'text', text: pay.accountNumber, size: 'sm', color: BRAND, weight: 'bold', align: 'center' },
        ],
    }] : [];

    const footerContents: object[] = [
        ...(o.portalUrl ? [{
            type: 'button', style: 'primary', color: BRAND, height: 'sm',
            action: { type: 'uri', label: o.portalLabel.slice(0, 40), uri: o.portalUrl },
        }] : []),
        ...(o.split && open ? [splitPayButton(o.split.kind, o.split.id, t('flex_split_pay', o.lang))] : []),
    ];

    return {
        type: 'flex',
        altText: o.altText,
        contents: {
            type: 'bubble',
            size: 'mega',
            body: {
                type: 'box', layout: 'vertical', paddingAll: '20px',
                contents: [
                    // dorm + status
                    {
                        type: 'box', layout: 'horizontal', alignItems: 'center',
                        contents: [
                            { type: 'text', text: o.dormName || '-', size: 'xs', color: MUTED, flex: 1, wrap: true },
                            {
                                type: 'box', layout: 'vertical', flex: 0, cornerRadius: '20px', backgroundColor: st.bg,
                                paddingStart: '10px', paddingEnd: '10px', paddingTop: '3px', paddingBottom: '3px',
                                contents: [{ type: 'text', text: plain(t(st.key, o.lang)), size: 'xxs', color: st.fg, weight: 'bold' }],
                            },
                        ],
                    },
                    { type: 'text', text: `${o.L('room')} ${o.room}`, size: 'xl', weight: 'bold', color: INK, margin: 'md', wrap: true },
                    { type: 'text', text: o.subtitle, size: 'xs', color: MUTED, wrap: true },

                    // the amount to pay
                    { type: 'text', text: o.L('flex_amount_due'), size: 'xs', color: MUTED, margin: 'xl' },
                    { type: 'text', text: baht(o.total, true), size: '3xl', weight: 'bold', color: open ? INK : STATUS.paid.fg },
                    { type: 'text', text: o.when, size: 'xs', margin: 'xs', color: o.state === 'unpaid' ? STATUS.unpaid.fg : MUTED, wrap: true },

                    { type: 'separator', margin: 'xl', color: LINE_C },
                    { type: 'box', layout: 'vertical', spacing: 'md', margin: 'lg', contents: o.items },
                    { type: 'separator', margin: 'lg', color: LINE_C },
                    {
                        type: 'box', layout: 'horizontal', margin: 'lg',
                        contents: [
                            { type: 'text', text: o.L('total_amount'), size: 'sm', weight: 'bold', color: INK, flex: 5, wrap: true },
                            { type: 'text', text: baht(o.total, true), size: 'sm', weight: 'bold', color: INK, align: 'end', flex: 3 },
                        ],
                    },

                    ...payBlock,
                    ...(open ? [{ type: 'text', text: plain(t('flex_send_slip', o.lang)), size: 'xxs', color: MUTED, align: 'center', wrap: true, margin: 'lg' }] : []),
                ],
            },
            ...(footerContents.length > 0 ? {
                footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', paddingTop: '0px', contents: footerContents },
            } : {}),
        },
    };
}

const labeler = (opts: BillFlexOptions) => {
    const lang: BillLanguage = opts.lang || 'th';
    const bilingual = !!opts.bilingual;
    const sec: BillLanguage = opts.secLang || 'en';
    return { lang, L: (key: TranslationKey) => plain(tBilingual(key, lang, bilingual, sec)) };
};

export function buildBillFlex(
    bill: MonthlyBill,
    dormName: string,
    dueDay: number,
    month: string,
    opts: BillFlexOptions = {}
): object {
    const { lang, L } = labeler(opts);
    const monthFormatted = formatMonthLabel(month, lang);
    const total = Number(bill.total_bill) || 0;
    const unit = t('unit_label', lang);
    const serviceTitle = L('flex_service_bill');

    // every charge on the bill, in the order of the printed invoice
    const items: object[] = [];
    if (Number(bill.room_rent) > 0) items.push(itemRow(L('room_rent'), bill.room_rent));
    items.push(itemRow(L('electricity'), bill.elec_bill, reading(bill.prev_elec, bill.curr_elec, bill.elec_units, unit)));
    if (Number(bill.water_flat_amount) > 0) {
        items.push(itemRow(L('water_flat'), bill.water_flat_amount, reading(bill.prev_water, bill.curr_water, bill.water_units, unit)));
        if (Number(bill.water_excess_amount) > 0) {
            items.push(itemRow(L('water_excess'), bill.water_excess_amount, `${(bill.water_excess_units ?? 0).toLocaleString('th-TH')} ${unit}`));
        }
    } else {
        items.push(itemRow(L('water'), bill.water_bill, reading(bill.prev_water, bill.curr_water, bill.water_units, unit)));
    }
    const fees = (bill.applied_common_fees ?? []).filter(f => Number(f.amount) > 0);
    if (fees.length) fees.forEach(f => items.push(itemRow(f.name, f.amount)));
    else if (Number(bill.common_fee) > 0) items.push(itemRow(L('common_fee'), bill.common_fee));

    return invoiceCard({
        lang, L,
        altText: `${serviceTitle} ${bill.room_number} (${monthFormatted}) ${baht(total)}`,
        dormName,
        state: payState(bill.payment_status),
        room: bill.room_number,
        subtitle: `${serviceTitle} · ${monthFormatted}`,
        total,
        when: `${L('due_date')} ${dueDay} ${monthFormatted}`,
        items,
        pay: opts.pay,
        portalUrl: opts.portalUrl,
        portalLabel: L('flex_open_portal'),
        split: bill.id ? { kind: 'bill', id: bill.id } : undefined,
    });
}

/**
 * ใบเสร็จรับเงิน — ส่งให้ลูกหออัตโนมัติเมื่อเจ้าของกดยืนยันการชำระ
 * โทนเขียว แยกจากบิล (น้ำเงิน) ให้รู้ทันทีว่าจ่ายสำเร็จแล้ว
 */
export function buildReceiptFlex(
    bill: MonthlyBill,
    dormName: string,
    paidAt: Date,
    opts: { lang?: BillLanguage; bilingual?: boolean; secLang?: BillLanguage } = {},
): object {
    const lang: BillLanguage = opts.lang || 'th';
    const isBilingual = !!opts.bilingual;
    const secLang: BillLanguage = opts.secLang || 'en';

    const monthFormatted = formatMonthLabel(bill.month as string, lang);
    // วันที่ชำระตามเวลาไทย
    const ict = new Date(paidAt.getTime() + 7 * 3600_000);
    const paidDate = lang === 'th'
        ? `${ict.getUTCDate()} ${THAI_MONTHS[ict.getUTCMonth() + 1]} ${ict.getUTCFullYear() + 543}`
        : `${ict.getUTCDate()} ${formatMonthLabel(`${ict.getUTCFullYear()}-${String(ict.getUTCMonth() + 1).padStart(2, '0')}`, lang)}`;

    const row = (label: string, value: string, optsObj: object = {}) => ({
        type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: label, color: '#555555', size: 'sm', flex: 3 },
            { type: 'text', text: value, size: 'sm', align: 'end', flex: 2 },
        ], ...optsObj,
    });

    const receiptTitle = `✅ ${tBilingual('receipt_title', lang, isBilingual, secLang)}`;
    const roomLabel = tBilingual('room', lang, isBilingual, secLang);
    const monthLabel = tBilingual('month', lang, isBilingual, secLang);
    const elecLabel = `⚡ ${tBilingual('electricity', lang, isBilingual, secLang)} (${bill.elec_units ?? 0} ${t('unit_label', lang)})`;
    const waterLabel = `💧 ${tBilingual('water', lang, isBilingual, secLang)} (${bill.water_units ?? 0} ${t('unit_label', lang)})`;
    const rentLabel = `🏠 ${tBilingual('room_rent', lang, isBilingual, secLang)}`;
    const commonLabel = `🏢 ${tBilingual('common_fee', lang, isBilingual, secLang)}`;
    const paidAmountLabel = isBilingual ? 'ยอดที่ชำระ / Paid' : (lang === 'en' ? 'Paid Amount' : (lang === 'zh' ? '已付金额' : 'ยอดที่ชำระ'));
    const paidAtLabel = isBilingual ? 'ชำระเมื่อ / Paid Date' : (lang === 'en' ? 'Paid Date' : (lang === 'zh' ? '支付时间' : 'ชำระเมื่อ'));
    const thankLabel = isBilingual ? 'ขอบคุณที่ชำระค่ะ / Thank you!' : (lang === 'en' ? 'Thank you for your payment! 🙏' : (lang === 'zh' ? '感谢您的付款！🙏' : (lang === 'my' ? 'ငွေပေးချေမှုအတွက် ကျေးဇူးတင်ပါသည် 🙏' : 'ขอบคุณที่ชำระค่ะ 🙏')));

    return {
        type: 'flex',
        altText: `${receiptTitle} ห้อง ${bill.room_number} เดือน ${monthFormatted} ขอบคุณค่ะ`,
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box', layout: 'vertical', paddingAll: '16px',
                backgroundColor: '#059669',
                contents: [
                    { type: 'text', text: receiptTitle, color: '#ffffff', size: 'sm', weight: 'bold' },
                    { type: 'text', text: dormName || '-', color: '#ffffffcc', size: 'xs' },
                ],
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
                contents: [
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: roomLabel, color: '#888888', size: 'sm', flex: 2 },
                        { type: 'text', text: String(bill.room_number ?? '-'), size: 'sm', weight: 'bold', flex: 3, align: 'end' },
                    ] },
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: monthLabel, color: '#888888', size: 'sm', flex: 2 },
                        { type: 'text', text: monthFormatted, size: 'sm', flex: 3, align: 'end' },
                    ] },
                    { type: 'separator', margin: 'md' },
                    row(elecLabel, `฿${Number(bill.elec_bill ?? 0).toLocaleString()}`, { margin: 'md' }),
                    row(waterLabel, `฿${Number(bill.water_bill ?? 0).toLocaleString()}`),
                    row(rentLabel, `฿${Number(bill.room_rent ?? 0).toLocaleString()}`),
                    ...(bill.common_fee ? [row(commonLabel, `฿${Number(bill.common_fee).toLocaleString()}`)] : []),
                    { type: 'separator', margin: 'md' },
                    { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                        { type: 'text', text: paidAmountLabel, size: 'md', weight: 'bold', flex: 2 },
                        { type: 'text', text: `฿${Number(bill.total_bill ?? 0).toLocaleString()}`, size: 'md', weight: 'bold', color: '#059669', align: 'end', flex: 3 },
                    ] },
                    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                        { type: 'text', text: paidAtLabel, color: '#888888', size: 'xs', flex: 2 },
                        { type: 'text', text: paidDate, color: '#059669', size: 'xs', align: 'end', flex: 3 },
                    ] },
                    { type: 'text', text: thankLabel, size: 'xs', color: '#888888', align: 'center', margin: 'md' },
                ],
            },
        },
    };
}

/**
 * แจ้งยอดค่าปรับ
 */
/** '2026-10-03' → '3 ต.ค. 2569' in the room's language (the date stays as written when it cannot be read). */
function dayLabel(date: string | undefined, lang: BillLanguage): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
    return m ? `${parseInt(m[3], 10)} ${formatMonthLabel(`${m[1]}-${m[2]}`, lang)}` : date || '-';
}

/** A fine as the same invoice card as a monthly bill: the reason (and note) is its line item. */
export function buildFineFlex(
    fine: Fine,
    dormName: string,
    opts: BillFlexOptions = {}
): object {
    const { lang, L } = labeler(opts);
    const total = Number(fine.amount) || 0;
    const title = L('flex_fine_notice');
    const date = dayLabel(fine.date, lang);
    const reason = fine.reason || title;

    return invoiceCard({
        lang, L,
        altText: `${title} ${fine.room_number} ${baht(total)}`,
        dormName,
        state: payState(fine.status),
        room: String(fine.room_number ?? '-'),
        subtitle: `${title} · ${date}`,
        total,
        when: `${L('flex_fine_date')} ${date}`,
        items: [itemRow(reason, total, fine.note ? `${L('flex_note')}: ${fine.note}` : undefined)],
        pay: opts.pay,
        portalUrl: opts.portalUrl,
        portalLabel: L('flex_open_portal'),
        split: fine.id ? { kind: 'fine', id: fine.id } : undefined,
    });
}
