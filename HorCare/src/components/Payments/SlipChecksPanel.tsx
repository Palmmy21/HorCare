import { CheckCircle2, XCircle, HelpCircle } from 'lucide-react';
import type { SlipCheck, SlipChecks } from '../../types';

interface Props {
    checks: SlipChecks;
    /** What was read from the slip, shown next to the checks in the full view. */
    read?: { sender?: string; receiverName?: string; receiverAccount?: string; datetime?: string; amount?: number };
    expectedAmount?: number;
    compact?: boolean;
}

const LABELS: { key: keyof SlipChecks; label: string }[] = [
    { key: 'amount', label: 'ยอดเงิน' },
    { key: 'receiver_name', label: 'ชื่อผู้รับ' },
    { key: 'receiver_account', label: 'เลขบัญชี' },
    { key: 'datetime', label: 'วัน-เวลา' },
    { key: 'duplicate', label: 'สลิปไม่ซ้ำ' },
];

const STYLE: Record<SlipCheck, { color: string; bg: string; Icon: React.ElementType; hint: string }> = {
    pass: { color: '#047857', bg: 'rgba(16,185,129,0.12)', Icon: CheckCircle2, hint: 'ตรงกัน' },
    fail: { color: '#B91C1C', bg: 'rgba(220,38,38,0.12)', Icon: XCircle, hint: 'ไม่ตรงกัน' },
    unknown: { color: '#6B7280', bg: 'rgba(107,114,128,0.12)', Icon: HelpCircle, hint: 'อ่านไม่ได้ / เทียบไม่ได้' },
};

const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : undefined);

/** Result of comparing a slip with the bill and the property's receiving accounts. */
export default function SlipChecksPanel({ checks, read, expectedAmount, compact = false }: Props) {
    const chips = (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {LABELS.filter(l => !(compact && l.key === 'duplicate')).map(({ key, label }) => {
                const s = STYLE[checks[key]];
                return (
                    <span key={key} title={`${label}: ${s.hint}`} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: compact ? '0.68rem' : '0.75rem', fontWeight: 700,
                        color: s.color, background: s.bg, borderRadius: 999, padding: compact ? '0.1rem 0.4rem' : '0.2rem 0.55rem',
                    }}>
                        <s.Icon size={compact ? 11 : 13} /> {label}
                    </span>
                );
            })}
        </div>
    );
    if (compact || !read) return chips;

    const rows: [string, string | undefined][] = [
        ['ยอดในสลิป', read.amount != null ? `฿${read.amount.toLocaleString()}${expectedAmount != null ? ` (ยอดบิล ฿${expectedAmount.toLocaleString()})` : ''}` : undefined],
        ['ผู้โอน', read.sender],
        ['ผู้รับ', read.receiverName],
        ['บัญชีผู้รับ', read.receiverAccount],
        ['วัน-เวลาโอน', fmtTime(read.datetime)],
    ];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {chips}
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 10px', fontSize: '0.8125rem' }}>
                {rows.map(([k, v]) => (
                    <div key={k} style={{ display: 'contents' }}>
                        <dt style={{ color: 'var(--color-gray-500)' }}>{k}</dt>
                        <dd style={{ margin: 0, color: v ? 'var(--color-gray-800)' : 'var(--color-gray-400)' }}>{v ?? 'อ่านไม่ได้'}</dd>
                    </div>
                ))}
            </dl>
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-gray-500)' }}>
                อ่านจากภาพสลิปด้วย AI — เป็นหลักฐานประกอบ ไม่ใช่การยืนยันกับบัญชีธนาคารจริง
            </p>
        </div>
    );
}
