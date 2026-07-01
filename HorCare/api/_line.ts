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

interface BillFlexOptions {
    portalUrl?: string;
}

export function buildBillFlex(
    bill: any,
    dormName: string,
    dueDay: number,
    month: string,
    opts: BillFlexOptions = {}
): object {
    const [year, mon] = month.split('-');
    const m = parseInt(mon);
    const y = parseInt(year);
    const monthThai = `${THAI_MONTHS[m]} ${y + 543}`;
    const dueDate   = `${dueDay} ${THAI_MONTHS[m]} ${y + 543}`;
    const total     = bill.total_bill as number;

    const footerContents: object[] = opts.portalUrl ? [
        {
            type: 'button',
            action: { type: 'uri', label: '🔗 เปิดพอร์ทัล / ดูบิล', uri: opts.portalUrl },
            style: 'primary', color: '#2563EB', height: 'sm',
        },
    ] : [];

    return {
        type: 'flex',
        altText: `📋 บิลค่าน้ำ-ไฟ ห้อง ${bill.room_number} เดือน ${monthThai} ยอด ฿${total.toLocaleString()}`,
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
                        { type: 'text', text: `฿${total.toLocaleString()}`, size: 'md', weight: 'bold', color: '#2563EB', align: 'end', flex: 3 },
                    ] },
                    { type: 'box', layout: 'horizontal', margin: 'sm', contents: [
                        { type: 'text', text: 'กำหนดชำระ', color: '#888888', size: 'xs', flex: 2 },
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

/** สร้าง PromptPay QR image URL (EMVCo) จาก phone + amount */
export function buildPromptpayQrImageUrl(phone: string, amount: number): string {
    const normalized = phone.replace(/[-\s]/g, '');
    const accountId = normalized.startsWith('0') ? '0066' + normalized.slice(1) : normalized;
    const merchantInfo = `0016A000000677010111` + `01${String(accountId.length).padStart(2, '0')}${accountId}`;
    const amtStr = amount.toFixed(2);
    const raw = `000201010212` +
        `${String(merchantInfo.length + 4).padStart(2, '0')}` + // tag 29 placeholder — computed below
        merchantInfo +
        `5802TH5303764` +
        `54${String(amtStr.length).padStart(2, '0')}${amtStr}` +
        `6304`;
    // Rebuild correctly: tag 29 wraps merchantInfo
    const tag29 = `29${String(merchantInfo.length).padStart(2, '0')}${merchantInfo}`;
    const withoutCrc = `000201010212${tag29}5802TH5303764` +
        `54${String(amtStr.length).padStart(2, '0')}${amtStr}6304`;
    void raw;
    let crc = 0xFFFF;
    for (let i = 0; i < withoutCrc.length; i++) {
        crc ^= withoutCrc.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : (crc << 1);
    }
    const payload = withoutCrc + (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    return `https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=10&data=${encodeURIComponent(payload)}`;
}

/** ข้อความ PromptPay สำหรับส่งแยกหลังบิล */
export function buildPromptpayMessages(
    promptpayNumber: string,
    promptpayName: string,
    total: number,
): object[] {
    const qrUrl = buildPromptpayQrImageUrl(promptpayNumber, total);
    return [
        {
            type: 'image',
            originalContentUrl: qrUrl,
            previewImageUrl: qrUrl,
        },
        {
            type: 'text',
            text: `💳 PromptPay${promptpayName ? `: ${promptpayName}` : ''}\n📞 ${promptpayNumber}\n💰 ฿${total.toLocaleString('th-TH', { minimumFractionDigits: 2 })}\n\n📎 กรุณาส่งสลิปยืนยันการโอนเงินมาในแชทนี้ด้วยนะคะ 🙏`,
        },
    ];
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
