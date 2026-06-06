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

export async function linePush(to: string, messages: object[]): Promise<void> {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token) return;
    await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to, messages }),
    });
}

export function buildBillFlex(
    bill: any,
    dormName: string,
    dueDay: number,
    month: string
): object {
    const [year, mon] = month.split('-');
    const thaiMonths = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
        'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
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
