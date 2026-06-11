import * as crypto from 'crypto';

export function verifyLineSignature(rawBody: Buffer | string, secret: string, signature: string): boolean {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(rawBody);
    return hmac.digest('base64') === signature;
}

export async function lineReply(replyToken: string, messages: object[]): Promise<void> {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
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

export async function linePush(to: string, messages: object[]): Promise<void> {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
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

export function buildBillFlex(
    bill: any,
    dormName: string,
    dueDay: number,
    month: string
): object {
    const [year, mon] = month.split('-');
    const thaiMonths = THAI_MONTHS;
    const m = parseInt(mon);
    const y = parseInt(year);
    const monthThai = `${thaiMonths[m]} ${y + 543}`;
    const dueDate   = `${dueDay} ${thaiMonths[m]} ${y + 543}`;

    return {
        type: 'flex',
        altText: `📋 บิลค่าน้ำ-ไฟ ห้อง ${bill.room_number} เดือน ${monthThai}`,
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box', layout: 'vertical', paddingAll: '16px',
                backgroundColor: '#2563EB',
                contents: [
                    { type: 'text', text: '📋 ใบแจ้งค่าบริการ', color: '#ffffff', size: 'sm', weight: 'bold' },
                    { type: 'text', text: dormName || '-', color: '#ffffffcc', size: 'xs' },
                ],
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
                contents: [
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: 'ห้อง',    color: '#888888', size: 'sm', flex: 2 },
                        { type: 'text', text: bill.room_number, size: 'sm', weight: 'bold', flex: 3, align: 'end' },
                    ] },
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: 'รอบเดือน', color: '#888888', size: 'sm', flex: 2 },
                        { type: 'text', text: monthThai, size: 'sm', flex: 3, align: 'end' },
                    ] },
                    { type: 'separator', margin: 'md' },
                    { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                        { type: 'text', text: `⚡ ค่าไฟ (${bill.elec_units} หน่วย)`, color: '#555555', size: 'sm', flex: 3 },
                        { type: 'text', text: `฿${(bill.elec_bill as number).toLocaleString()}`, size: 'sm', align: 'end', flex: 2 },
                    ] },
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: `💧 ค่าน้ำ (${bill.water_units} หน่วย)`, color: '#555555', size: 'sm', flex: 3 },
                        { type: 'text', text: `฿${(bill.water_bill as number).toLocaleString()}`, size: 'sm', align: 'end', flex: 2 },
                    ] },
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: '🏠 ค่าเช่าห้อง', color: '#555555', size: 'sm', flex: 3 },
                        { type: 'text', text: `฿${(bill.room_rent as number).toLocaleString()}`, size: 'sm', align: 'end', flex: 2 },
                    ] },
                    { type: 'separator', margin: 'md' },
                    { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                        { type: 'text', text: 'ยอดรวม', size: 'md', weight: 'bold', flex: 2 },
                        { type: 'text', text: `฿${(bill.total_bill as number).toLocaleString()}`, size: 'md', weight: 'bold', color: '#2563EB', align: 'end', flex: 3 },
                    ] },
                    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                        { type: 'text', text: 'กำหนดชำระ', color: '#888888', size: 'xs', flex: 2 },
                        { type: 'text', text: dueDate, color: '#DC2626', size: 'xs', align: 'end', flex: 3 },
                    ] },
                ],
            },
        },
    };
}

/**
 * ใบเสร็จรับเงิน — ส่งให้ลูกหออัตโนมัติเมื่อเจ้าของกดยืนยันการชำระ
 * โทนเขียว แยกจากบิล (น้ำเงิน) ให้รู้ทันทีว่าจ่ายสำเร็จแล้ว
 */
export function buildReceiptFlex(
    bill: any,
    dormName: string,
    paidAt: Date,
): object {
    const monthThai = thaiMonthLabel(bill.month as string);
    // วันที่ชำระตามเวลาไทย
    const ict = new Date(paidAt.getTime() + 7 * 3600_000);
    const paidDate = `${ict.getUTCDate()} ${THAI_MONTHS[ict.getUTCMonth() + 1]} ${ict.getUTCFullYear() + 543}`;
    const row = (label: string, value: string, opts: object = {}) => ({
        type: 'box', layout: 'horizontal', contents: [
            { type: 'text', text: label, color: '#555555', size: 'sm', flex: 3 },
            { type: 'text', text: value, size: 'sm', align: 'end', flex: 2 },
        ], ...opts,
    });

    return {
        type: 'flex',
        altText: `✅ ใบเสร็จรับเงิน ห้อง ${bill.room_number} เดือน ${monthThai} ขอบคุณค่ะ`,
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box', layout: 'vertical', paddingAll: '16px',
                backgroundColor: '#059669',
                contents: [
                    { type: 'text', text: '✅ ใบเสร็จรับเงิน', color: '#ffffff', size: 'sm', weight: 'bold' },
                    { type: 'text', text: dormName || '-', color: '#ffffffcc', size: 'xs' },
                ],
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
                contents: [
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: 'ห้อง', color: '#888888', size: 'sm', flex: 2 },
                        { type: 'text', text: String(bill.room_number ?? '-'), size: 'sm', weight: 'bold', flex: 3, align: 'end' },
                    ] },
                    { type: 'box', layout: 'horizontal', contents: [
                        { type: 'text', text: 'รอบเดือน', color: '#888888', size: 'sm', flex: 2 },
                        { type: 'text', text: monthThai, size: 'sm', flex: 3, align: 'end' },
                    ] },
                    { type: 'separator', margin: 'md' },
                    row(`⚡ ค่าไฟ (${bill.elec_units ?? 0} หน่วย)`, `฿${Number(bill.elec_bill ?? 0).toLocaleString()}`, { margin: 'md' }),
                    row(`💧 ค่าน้ำ (${bill.water_units ?? 0} หน่วย)`, `฿${Number(bill.water_bill ?? 0).toLocaleString()}`),
                    row('🏠 ค่าเช่าห้อง', `฿${Number(bill.room_rent ?? 0).toLocaleString()}`),
                    { type: 'separator', margin: 'md' },
                    { type: 'box', layout: 'horizontal', margin: 'md', contents: [
                        { type: 'text', text: 'ยอดที่ชำระ', size: 'md', weight: 'bold', flex: 2 },
                        { type: 'text', text: `฿${Number(bill.total_bill ?? 0).toLocaleString()}`, size: 'md', weight: 'bold', color: '#059669', align: 'end', flex: 3 },
                    ] },
                    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                        { type: 'text', text: 'ชำระเมื่อ', color: '#888888', size: 'xs', flex: 2 },
                        { type: 'text', text: paidDate, color: '#059669', size: 'xs', align: 'end', flex: 3 },
                    ] },
                    { type: 'text', text: 'ขอบคุณที่ชำระค่ะ 🙏', size: 'xs', color: '#888888', align: 'center', margin: 'md' },
                ],
            },
        },
    };
}
