/**
 * The LINE message a tenant receives when the owner sends a contract to sign: a Flex card with the terms that matter
 * (unit, rent, deposit, period) and one button that opens the signing page in the tenant's portal.
 *
 * Pure — the caller resolves the link and pushes it.
 */

export interface ContractLineData {
    title?: string;
    contract_number?: string;
    contract_type?: string;
    lessee_name?: string;
    unit_number?: string;
    rent_amount?: number;
    rent_cycle?: string;
    deposit_amount?: number;
    start_date?: string;
    end_date?: string;
}

const CYCLE_TH: Record<string, string> = { daily: 'วัน', weekly: 'สัปดาห์', monthly: 'เดือน', yearly: 'ปี' };

function thaiDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const baht = (n?: number) => `฿${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;

export function unitWordFor(contractType?: string): string {
    return contractType === 'market_stall' ? 'แผงค้า' : contractType === 'commercial' ? 'พื้นที่' : 'ห้อง';
}

export function contractPeriod(c: ContractLineData): string {
    const from = thaiDate(c.start_date);
    const to = c.end_date ? thaiDate(c.end_date) : 'ไม่มีกำหนด';
    return from ? `${from} – ${to}` : to;
}

/** Plain text — LINE shows it as the notification preview and where Flex can't render. */
export function contractAltText(c: ContractLineData, dormName: string): string {
    return `${dormName}: ${c.title || 'สัญญาเช่า'} ${unitWordFor(c.contract_type)} ${c.unit_number ?? ''} รอคุณลงนาม`.slice(0, 400);
}

export function buildContractFlex(c: ContractLineData, dormName: string, signUrl: string): object {
    const row = (label: string, value: string) => ({
        type: 'box', layout: 'baseline', spacing: 'sm',
        contents: [
            { type: 'text', text: label, color: '#64748B', size: 'sm', flex: 3 },
            { type: 'text', text: value || '-', color: '#0F172A', size: 'sm', flex: 5, wrap: true, weight: 'bold' },
        ],
    });
    const cycle = CYCLE_TH[c.rent_cycle ?? 'monthly'] ?? 'เดือน';
    return {
        type: 'flex',
        altText: contractAltText(c, dormName),
        contents: {
            type: 'bubble',
            header: {
                type: 'box', layout: 'vertical', backgroundColor: '#0F4C81', paddingAll: 'lg',
                contents: [
                    { type: 'text', text: '📄 สัญญาเช่ารอลงนาม', color: '#FFFFFF', weight: 'bold', size: 'md' },
                    { type: 'text', text: dormName, color: '#FFFFFFCC', size: 'xs', wrap: true },
                ],
            },
            body: {
                type: 'box', layout: 'vertical', spacing: 'md',
                contents: [
                    { type: 'text', text: c.title || 'สัญญาเช่า', weight: 'bold', size: 'md', wrap: true, color: '#0F172A' },
                    { type: 'text', text: `เลขที่ ${c.contract_number ?? '-'}`, size: 'xs', color: '#64748B' },
                    { type: 'separator', margin: 'md' },
                    row('ผู้เช่า', c.lessee_name ?? ''),
                    row(unitWordFor(c.contract_type), c.unit_number ?? ''),
                    row('ค่าเช่า', `${baht(c.rent_amount)} / ${cycle}`),
                    row('เงินประกัน', baht(c.deposit_amount)),
                    row('ระยะเวลา', contractPeriod(c)),
                    { type: 'separator', margin: 'md' },
                    { type: 'text', text: 'กรุณาอ่านรายละเอียดสัญญาทั้งหมด แล้วลงลายมือชื่อผ่านมือถือได้ทันที', size: 'xs', color: '#475569', wrap: true },
                ],
            },
            footer: {
                type: 'box', layout: 'vertical',
                contents: [{ type: 'button', style: 'primary', color: '#0F4C81', action: { type: 'uri', label: 'อ่านและลงนามสัญญา', uri: signUrl } }],
            },
        },
    };
}
