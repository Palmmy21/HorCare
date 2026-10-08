import { useState } from 'react';
import { AlertTriangle, Eye, Loader2, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import {
    EXCLUDE_REASON_LABELS_TH, PROBLEM_LABELS_TH, fromSatang, type Excluded, type Problem, type Voucher, type VoucherKind,
} from '../../shared/accounting';
import type { Ledger, LedgerGap } from '../../shared/ledger';

interface Preview {
    vouchers: Voucher[]; problems: Problem[]; excluded: Excluded[]; gaps: LedgerGap[];
    summary: { documents: number; dr_satang: number; cr_satang: number };
}

const baht = (s: number) => fromSatang(s).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)' };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit' };

const ERRORS: Record<string, string> = {
    blocked: 'มีรายการติดปัญหา — แก้ก่อน (ระบบไม่ลงบัญชีบางส่วน)',
    ledger_incomplete: 'การตั้งค่าสมุดบัญชียังไม่ครบ',
    nothing_to_post: 'ไม่มีรายการที่ต้องลงบัญชีในช่วงนี้',
    forbidden: 'คุณไม่มีสิทธิ์ลงบัญชี',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบช่วงวันที่',
};

export default function PostingTab({ ownerUid, ledger }: { ownerUid: string; ledger: Ledger }) {
    const [kind, setKind] = useState<VoucherKind>('invoice');
    const [from, setFrom] = useState(`${today().slice(0, 8)}01`);
    const [to, setTo] = useState(today());
    const [busy, setBusy] = useState<string | null>(null);
    const [preview, setPreview] = useState<Preview | null>(null);

    const call = async <T,>(key: string, action: string): Promise<T | null> => {
        setBusy(key);
        try {
            return await apiPost<T>('ledger', { owner_uid: ownerUid, ledger_id: ledger.id, action, kind, from, to });
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
            return null;
        } finally { setBusy(null); }
    };
    const runPreview = async () => { const r = await call<Preview>('preview', 'post_preview'); if (r) setPreview(r); };
    const post = async () => {
        if (!window.confirm(`ลงบัญชี ${preview?.summary.documents ?? 0} รายการ? รายการที่ลงแล้วแก้ไม่ได้ ต้องใช้การกลับรายการ`)) return;
        const r = await call<{ posted: number; skipped: number }>('post', 'post');
        if (r) { toast.success(`ลงบัญชีแล้ว ${r.posted} รายการ`); setPreview(null); }
    };

    const blocked = !!preview && preview.problems.length > 0;
    const excluded = preview ? Object.entries(preview.excluded.reduce<Record<string, number>>((m, e) => ({ ...m, [e.reason]: (m[e.reason] ?? 0) + 1 }), {})) : [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                เลือกช่วงวันที่แล้วตรวจสอบก่อนลงบัญชี ระบบลงรายการตั้งลูกหนี้จากบิลที่ออกแล้ว และรายการรับเงินจริง (เงินโอนต้องยืนยันกับบัญชีธนาคารแล้ว) ลงซ้ำไม่ได้ และถ้ามีรายการติดปัญหาแม้ข้อเดียวจะไม่ลงให้เลย
            </p>
            <div style={{ ...card, display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={kind} onChange={e => { setKind(e.target.value as VoucherKind); setPreview(null); }} style={input} aria-label="ประเภท">
                    <option value="invoice">ตั้งลูกหนี้ (จากบิล)</option>
                    <option value="receipt">รับชำระ (จากเงินที่รับจริง)</option>
                </select>
                <label style={{ fontSize: '0.85rem' }}>ตั้งแต่ <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreview(null); }} style={input} /></label>
                <label style={{ fontSize: '0.85rem' }}>ถึง <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreview(null); }} style={input} /></label>
                <button className="btn btn-outline btn-sm" disabled={!!busy || !from || !to} onClick={() => void runPreview()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {busy === 'preview' ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} ตรวจสอบ
                </button>
                {ledger.locked_through && <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>ปิดงวดถึง {ledger.locked_through}</span>}
            </div>

            {preview && (
                <>
                    {preview.gaps.length > 0 && (
                        <div style={{ ...card, background: '#FEF3C7' }}>
                            <strong>การตั้งค่ายังขาด:</strong>
                            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>{preview.gaps.map((g, i) => <li key={i}>{g.message}</li>)}</ul>
                        </div>
                    )}
                    <div style={{ ...card, display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                        <div><div style={{ fontSize: '0.75rem' }}>รายการ</div><strong>{preview.summary.documents}</strong></div>
                        <div><div style={{ fontSize: '0.75rem' }}>เดบิตรวม</div><strong>{baht(preview.summary.dr_satang)}</strong></div>
                        <div><div style={{ fontSize: '0.75rem' }}>เครดิตรวม</div><strong>{baht(preview.summary.cr_satang)}</strong></div>
                        {excluded.length > 0 && <div style={{ fontSize: '0.8rem' }}>ไม่รวม: {excluded.map(([r, n]) => `${EXCLUDE_REASON_LABELS_TH[r] ?? r} ${n}`).join(' · ')}</div>}
                    </div>
                    {blocked && (
                        <div style={{ ...card, borderColor: '#DC2626' }}>
                            <strong style={{ color: '#B91C1C', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={16} /> {preview.problems.length} รายการติดปัญหา</strong>
                            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.88rem' }}>
                                {preview.problems.slice(0, 50).map((p, i) => <li key={i}><strong>{p.source.label}</strong> — {p.message || PROBLEM_LABELS_TH[p.code] || p.code}</li>)}
                            </ul>
                        </div>
                    )}
                    {preview.vouchers.length > 0 && (
                        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead><tr style={{ textAlign: 'left', background: 'var(--color-gray-50, #F9FAFB)' }}>
                                    <th style={{ padding: '0.5rem' }}>เลขเอกสาร</th><th>วันที่</th><th>แผง/ห้อง</th><th style={{ textAlign: 'right', paddingRight: '0.5rem' }}>ยอด</th>
                                </tr></thead>
                                <tbody>
                                    {preview.vouchers.slice(0, 200).map(v => (
                                        <tr key={v.key} style={{ borderTop: '1px solid var(--color-gray-100, #F3F4F6)' }}>
                                            <td style={{ padding: '0.5rem' }}>{v.doc_ref}</td><td>{v.voucher_date}</td><td>{v.room_number}</td>
                                            <td style={{ textAlign: 'right', paddingRight: '0.5rem' }}>{baht(v.total_dr_satang)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                    <div>
                        <button className="btn btn-primary btn-sm" disabled={!!busy || blocked || preview.gaps.length > 0 || preview.vouchers.length === 0} onClick={() => void post()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            {busy === 'post' ? <Loader2 size={14} className="spin" /> : <Send size={14} />} ลงบัญชี
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
