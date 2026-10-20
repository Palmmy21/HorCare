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

import { BillLanguage, t, tBilingual, formatMonthLabel } from './_translations.js';

interface BillFlexOptions {
    portalUrl?: string;
    lang?: BillLanguage;
    bilingual?: boolean;
    secLang?: BillLanguage;
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

export function buildBillFlex(
    bill: MonthlyBill,
    dormName: string,
    dueDay: number,
    month: string,
    opts: BillFlexOptions = {}
): object {
    const lang: BillLanguage = opts.lang || 'th';
    const isBilingual = !!opts.bilingual;
    const secLang: BillLanguage = opts.secLang || 'en';

    const monthFormatted = formatMonthLabel(month, lang);
    const dueDate   = `${dueDay} ${monthFormatted}`;
    const total     = bill.total_bill as number;

    const footerContents: object[] = [
        ...(opts.portalUrl ? [{
            type: 'button',
            action: { type: 'uri', label: tBilingual('flex_open_portal', lang, isBilingual, secLang), uri: opts.portalUrl },
            style: 'primary', color: '#2563EB', height: 'sm',
        }] : []),
        ...(bill.id && bill.payment_status !== 'paid' ? [splitPayButton('bill', bill.id, t('flex_split_pay', lang))] : []),
    ];

    const serviceTitle = tBilingual('flex_service_bill', lang, isBilingual, secLang);
    const roomLabel = tBilingual('room', lang, isBilingual, secLang);
    const monthLabel = tBilingual('month', lang, isBilingual, secLang);
    const elecLabel = `⚡ ${tBilingual('electricity', lang, isBilingual, secLang)} (${bill.elec_units} ${t('unit_label', lang)})`;
    const waterLabel = `💧 ${tBilingual('water', lang, isBilingual, secLang)} (${bill.water_units} ${t('unit_label', lang)})`;
    const rentLabel = `🏠 ${tBilingual('room_rent', lang, isBilingual, secLang)}`;
    const commonLabel = `🏢 ${tBilingual('common_fee', lang, isBilingual, secLang)}`;
    const totalLabel = tBilingual('total_amount', lang, isBilingual, secLang);
    const dueDateLabel = tBilingual('due_date', lang, isBilingual, secLang);

    return {
        type: 'flex',
        altText: `${serviceTitle} ห้อง ${bill.room_number} (${monthFormatted}) ฿${total.toLocaleString()}`,
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box', layout: 'vertical', paddingAll: '16px',
                backgroundColor: '#2563EB',
                contents: [
                    { type: 'text', text: serviceTitle, color: '#ffffff', size: 'sm', weight: 'bold' },
                    { type: 'text', text: dormName || '-', color: '#ffffffcc', size: 'xs' },
                ],
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
                contents: [
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: roomLabel, color: '#888888', size: 'sm', flex: 2 },
                        { type: 'text', text: bill.room_number, size: 'sm', weight: 'bold', flex: 3, align: 'end' },
                    ] },
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: monthLabel, color: '#888888', size: 'sm', flex: 2 },
                        { type: 'text', text: monthFormatted, size: 'sm', flex: 3, align: 'end' },
                    ] },
                    { type: 'separator', margin: 'md' },
                    { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                        { type: 'text', text: elecLabel, color: '#555555', size: 'sm', flex: 3 },
                        { type: 'text', text: `฿${(bill.elec_bill as number).toLocaleString()}`, size: 'sm', align: 'end', flex: 2 },
                    ] },
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: waterLabel, color: '#555555', size: 'sm', flex: 3 },
                        { type: 'text', text: `฿${(bill.water_bill as number).toLocaleString()}`, size: 'sm', align: 'end', flex: 2 },
                    ] },
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: rentLabel, color: '#555555', size: 'sm', flex: 3 },
                        { type: 'text', text: `฿${(bill.room_rent as number).toLocaleString()}`, size: 'sm', align: 'end', flex: 2 },
                    ] },
                    ...(bill.common_fee ? [{
                        type: 'box', layout: 'horizontal', contents: [
                            { type: 'text', text: commonLabel, color: '#555555', size: 'sm', flex: 3 },
                            { type: 'text', text: `฿${(bill.common_fee as number).toLocaleString()}`, size: 'sm', align: 'end', flex: 2 },
                        ]
                    }] : []),
                    { type: 'separator', margin: 'md' },
                    { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                        { type: 'text', text: totalLabel, size: 'md', weight: 'bold', flex: 2 },
                        { type: 'text', text: `฿${total.toLocaleString()}`, size: 'md', weight: 'bold', color: '#2563EB', align: 'end', flex: 3 },
                    ] },
                    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                        { type: 'text', text: dueDateLabel, color: '#888888', size: 'xs', flex: 2 },
                        { type: 'text', text: dueDate, color: '#DC2626', size: 'xs', align: 'end', flex: 3 },
                    ] },
                ],
            },
            ...(footerContents.length > 0 ? {
                footer: {
                    type: 'box', layout: 'vertical', paddingAll: '12px',
                    contents: footerContents,
                },
            } : {}),
        },
    };
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
export function buildFineFlex(
    fine: Fine,
    dormName: string,
    opts: BillFlexOptions = {}
): object {
    const total = Number(fine.amount);
    
    // Convert date string to Thai format if possible
    let dateStr = fine.date;
    try {
        if (fine.date) {
            const [y, m, d] = fine.date.split('-');
            dateStr = `${parseInt(d)} ${THAI_MONTHS[parseInt(m)]} ${parseInt(y) + 543}`;
        }
    } catch { /* malformed date: keep the fallback text */ }

    const footerContents: object[] = [
        ...(opts.portalUrl ? [{
            type: 'button',
            action: { type: 'uri', label: '🔗 เปิดพอร์ทัล', uri: opts.portalUrl },
            style: 'primary', color: '#DC2626', height: 'sm',
        }] : []),
        ...(fine.id && fine.status !== 'paid' ? [splitPayButton('fine', fine.id, t('flex_split_pay', opts.lang || 'th'))] : []),
    ];

    return {
        type: 'flex',
        altText: `🚨 แจ้งยอดค่าปรับ ห้อง ${fine.room_number} ยอด ฿${total.toLocaleString()}`,
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box', layout: 'vertical', paddingAll: '16px',
                backgroundColor: '#DC2626',
                contents: [
                    { type: 'text', text: '🚨 แจ้งยอดค่าปรับ', color: '#ffffff', size: 'sm', weight: 'bold' },
                    { type: 'text', text: dormName || '-', color: '#ffffffcc', size: 'xs' },
                ],
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
                contents: [
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: 'ห้อง', color: '#888888', size: 'sm', flex: 2 },
                        { type: 'text', text: String(fine.room_number ?? '-'), size: 'sm', weight: 'bold', flex: 3, align: 'end' },
                    ] },
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: 'วันที่', color: '#888888', size: 'sm', flex: 2 },
                        { type: 'text', text: dateStr || '-', size: 'sm', flex: 3, align: 'end' },
                    ] },
                    { type: 'separator', margin: 'md' },
                    { type: 'box', layout: 'vertical', margin: 'md', spacing: 'xs', contents: [
                        { type: 'text', text: 'รายการ:', color: '#888888', size: 'xs' },
                        { type: 'text', text: fine.reason || '-', size: 'sm', wrap: true },
                        ...(fine.note ? [{ type: 'text', text: `หมายเหตุ: ${fine.note}`, size: 'xs', color: '#888888', wrap: true }] : []),
                    ] },
                    { type: 'separator', margin: 'md' },
                    { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                        { type: 'text', text: 'ยอดรวม', size: 'md', weight: 'bold', flex: 2 },
                        { type: 'text', text: `฿${total.toLocaleString()}`, size: 'md', weight: 'bold', color: '#DC2626', align: 'end', flex: 3 },
                    ] },
                ],
            },
            ...(footerContents.length > 0 ? {
                footer: {
                    type: 'box', layout: 'vertical', paddingAll: '12px',
                    contents: footerContents,
                },
            } : {}),
        },
    };
}
