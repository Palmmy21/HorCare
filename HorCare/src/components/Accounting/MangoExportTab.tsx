import { Fragment, useMemo, useState } from 'react';
import { Download, Eye, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { useExportBatches } from '../../hooks/useAccountingData';
import {
    EXCLUDE_REASON_LABELS_TH, IMPORT_OUTCOME_LABELS_TH, PROBLEM_LABELS_TH, fromSatang,
    type ExportBatch, type Excluded, type Gap, type MangoProfile, type Problem, type Voucher, type VoucherKind,
} from '../../shared/accounting';

interface Props { ownerUid: string; profiles: MangoProfile[] }

interface PreviewResult {
    vouchers: Voucher[]; problems: Problem[]; excluded: Excluded[]; gaps: Gap[]; approved: boolean;
    summary: { documents: number; lines: number; dr_satang: number; cr_satang: number };
}

const baht = (s: number) => fromSatang(s).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 8)}01`;
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)' };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit' };

const ERRORS: Record<string, string> = {
    profile_not_approved: 'โปรไฟล์ยังไม่ได้อนุมัติ — ให้ฝ่ายบัญชียืนยันการตั้งค่าที่แท็บ "ตั้งค่า Mango" ก่อน',
    profile_incomplete: 'การตั้งค่ายังไม่ครบ',
    blocked: 'มีรายการติดปัญหา — แก้ไขก่อน (ระบบไม่ส่งออกบางส่วน)',
    nothing_to_export: 'ไม่มีรายการให้ส่งออกในช่วงนี้',
    forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบช่วงวันที่',
    note_required: 'กรุณาใส่หมายเหตุ',
};

export default function MangoExportTab({ ownerUid, profiles }: Props) {
    const { batches } = useExportBatches(ownerUid);
    const [profileId, setProfileId] = useState(profiles[0]?.id ?? '');
    const [kind, setKind] = useState<VoucherKind>('invoice');
    const [from, setFrom] = useState(monthStart());
    const [to, setTo] = useState(today());
    const [busy, setBusy] = useState<string | null>(null);
    const [preview, setPreview] = useState<PreviewResult | null>(null);
    const [open, setOpen] = useState<string | null>(null);

    const profile = profiles.find(p => p.id === profileId) ?? profiles[0];
    const myBatches = useMemo(() => batches.filter(b => b.profile_id === profile?.id), [batches, profile]);

    const call = async <T,>(key: string, body: Record<string, unknown>): Promise<T | null> => {
        setBusy(key);
        try {
            return await apiPost<T>('accounting', { owner_uid: ownerUid, profile_id: profile?.id, ...body });
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
            return null;
        } finally { setBusy(null); }
    };

    const runPreview = async () => {
        const r = await call<PreviewResult>('preview', { action: 'preview', kind, from, to });
        if (r) setPreview(r);
    };
    const download = async (batch: ExportBatch) => {
        const r = await call<{ file_name: string; base64: string }>('dl:' + batch.id, { action: 'download', batch_id: batch.id });
        if (!r) return;
        const bytes = Uint8Array.from(atob(r.base64), c => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const a = document.createElement('a');
        a.href = url; a.download = r.file_name; a.click();
        URL.revokeObjectURL(url);
    };
    const create = async () => {
        const r = await call<{ batch: ExportBatch; reused: boolean }>('create', { action: 'create_batch', kind, from, to });
        if (!r) return;
        toast.success(r.reused ? 'มีไฟล์ของช่วงนี้อยู่แล้ว' : `สร้างไฟล์แล้ว (${r.batch.vouchers_count} เอกสาร)`);
        setPreview(null);
        await download(r.batch);
    };
    const outcome = async (b: ExportBatch, value: 'confirmed' | 'failed' | 'partial') => {
        let note: string | null = null;
        if (value !== 'confirmed') {
            note = window.prompt(value === 'failed' ? 'นำเข้าล้มเหลวเพราะอะไร? (จำเป็น)' : 'นำเข้าได้บางส่วน — รายการใดไม่ผ่าน? (จำเป็น)');
            if (!note?.trim()) return;
        } else if (!window.confirm('ยืนยันว่านำเข้าไฟล์นี้ใน Mango สำเร็จแล้ว?')) return;
        if (await call('o:' + b.id, { action: 'confirm_import', batch_id: b.id, outcome: value, note })) toast.success('บันทึกผลแล้ว');
    };

    if (profiles.length === 0) {
        return <div style={card}>ยังไม่มีโปรไฟล์การส่งออก — ไปที่แท็บ “ตั้งค่า Mango” เพื่อสร้างโปรไฟล์ของนิติบุคคลก่อน</div>;
    }
    const blocked = !!preview && preview.problems.length > 0;
    const excludedCounts = preview ? Object.entries(preview.excluded.reduce<Record<string, number>>((m, e) => ({ ...m, [e.reason]: (m[e.reason] ?? 0) + 1 }), {})) : [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ ...card, display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={profile?.id} onChange={e => { setProfileId(e.target.value); setPreview(null); }} style={input} aria-label="โปรไฟล์">
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name} · {p.legal_entity_name}{p.status === 'draft' ? ' (ร่าง)' : ''}</option>)}
                </select>
                <select value={kind} onChange={e => { setKind(e.target.value as VoucherKind); setPreview(null); }} style={input} aria-label="ประเภทเอกสาร">
                    <option value="invoice">ตั้งลูกหนี้ (Invoice) — ตามวันที่ออกบิล</option>
                    <option value="receipt">รับชำระ / ตัดลูกหนี้ (Receipt) — ตามวันที่รับเงิน</option>
                </select>
                <label style={{ fontSize: '0.85rem' }}>ตั้งแต่ <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPreview(null); }} style={input} /></label>
                <label style={{ fontSize: '0.85rem' }}>ถึง <input type="date" value={to} onChange={e => { setTo(e.target.value); setPreview(null); }} style={input} /></label>
                <button className="btn btn-outline btn-sm" disabled={!!busy || !from || !to} onClick={() => void runPreview()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {busy === 'preview' ? <Loader2 size={14} className="spin" /> : <Eye size={14} />} ตรวจสอบก่อนส่งออก
                </button>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>เกณฑ์วันที่ใช้เวลาไทย รวมวันต้นและวันท้าย</span>
            </div>

            {preview && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {!preview.approved && <div style={{ ...card, background: '#FEF3C7' }}>โปรไฟล์นี้ยังเป็นฉบับร่าง — ดูตัวอย่างได้ แต่สร้างไฟล์ไม่ได้จนกว่าจะอนุมัติ</div>}
                    {preview.gaps.length > 0 && (
                        <div style={{ ...card, background: '#FEF3C7' }}>
                            <strong>การตั้งค่ายังขาด:</strong>
                            <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.25rem' }}>{preview.gaps.map(g => <li key={g.code}>{g.message}</li>)}</ul>
                        </div>
                    )}
                    <div style={{ ...card, display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                        <div><div style={{ fontSize: '0.75rem' }}>เอกสาร</div><strong>{preview.summary.documents}</strong></div>
                        <div><div style={{ fontSize: '0.75rem' }}>บรรทัดบัญชี</div><strong>{preview.summary.lines}</strong></div>
                        <div><div style={{ fontSize: '0.75rem' }}>Dr. รวม</div><strong>{baht(preview.summary.dr_satang)}</strong></div>
                        <div><div style={{ fontSize: '0.75rem' }}>Cr. รวม</div><strong>{baht(preview.summary.cr_satang)}</strong></div>
                        {excludedCounts.length > 0 && <div style={{ fontSize: '0.8rem' }}>ไม่รวม: {excludedCounts.map(([r, n]) => `${EXCLUDE_REASON_LABELS_TH[r] ?? r} ${n}`).join(' · ')}</div>}
                    </div>

                    {blocked && (
                        <div style={{ ...card, borderColor: '#DC2626' }}>
                            <strong style={{ color: '#B91C1C', display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={16} /> มี {preview.problems.length} รายการติดปัญหา — ต้องแก้ก่อนจึงจะสร้างไฟล์ได้</strong>
                            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.88rem' }}>
                                {preview.problems.slice(0, 50).map((p, i) => <li key={i}><strong>{p.source.label}</strong> — {p.message || PROBLEM_LABELS_TH[p.code] || p.code}</li>)}
                            </ul>
                        </div>
                    )}

                    {preview.vouchers.length > 0 && (
                        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                <thead><tr style={{ textAlign: 'left', background: 'var(--color-gray-50, #F9FAFB)' }}>
                                    <th style={{ padding: '0.5rem' }}>เลขเอกสาร</th><th>วันที่</th><th>แผง/ห้อง</th><th>ลูกค้า</th><th style={{ textAlign: 'right' }}>Dr.</th><th style={{ textAlign: 'right', paddingRight: '0.5rem' }}>Cr.</th>
                                </tr></thead>
                                <tbody>
                                    {preview.vouchers.slice(0, 200).map(v => (
                                        <Fragment key={v.key}>
                                            <tr onClick={() => setOpen(open === v.key ? null : v.key)} style={{ cursor: 'pointer', borderTop: '1px solid var(--color-gray-100, #F3F4F6)' }}>
                                                <td style={{ padding: '0.5rem' }}>{v.doc_ref}</td><td>{v.voucher_date}</td><td>{v.room_number}</td><td>{v.customer_code}</td>
                                                <td style={{ textAlign: 'right' }}>{baht(v.total_dr_satang)}</td><td style={{ textAlign: 'right', paddingRight: '0.5rem' }}>{baht(v.total_cr_satang)}</td>
                                            </tr>
                                            {open === v.key && v.lines.map((l, i) => (
                                                <tr key={v.key + i} style={{ background: 'var(--color-gray-50, #F9FAFB)', fontSize: '0.8rem' }}>
                                                    <td colSpan={2} style={{ padding: '0.25rem 0.5rem 0.25rem 1.5rem' }}>{l.account}</td><td colSpan={2}>{l.description}</td>
                                                    <td style={{ textAlign: 'right' }}>{l.dr_satang ? baht(l.dr_satang) : ''}</td><td style={{ textAlign: 'right', paddingRight: '0.5rem' }}>{l.cr_satang ? baht(l.cr_satang) : ''}</td>
                                                </tr>
                                            ))}
                                        </Fragment>
                                    ))}
                                </tbody>
                            </table>
                            {preview.vouchers.length > 200 && <div style={{ padding: '0.5rem', fontSize: '0.8rem' }}>แสดง 200 จาก {preview.vouchers.length} เอกสาร (ไฟล์จะมีครบทั้งหมด)</div>}
                        </div>
                    )}

                    <div>
                        <button className="btn btn-primary btn-sm" disabled={!!busy || blocked || !preview.approved || preview.vouchers.length === 0 || preview.gaps.length > 0}
                            onClick={() => void create()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            {busy === 'create' ? <Loader2 size={14} className="spin" /> : <FileSpreadsheet size={14} />} สร้างไฟล์ Excel สำหรับ Mango
                        </button>
                        <span style={{ fontSize: '0.78rem', marginLeft: 8, color: 'var(--color-gray-500)' }}>การดาวน์โหลดไม่เท่ากับนำเข้าสำเร็จ — บันทึกผลนำเข้าด้านล่างหลังนำเข้าใน Mango</span>
                    </div>
                </div>
            )}

            <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>ประวัติการส่งออก</h2>
                {myBatches.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ยังไม่เคยส่งออก</div> : myBatches.map(b => (
                    <div key={b.id} style={{ ...card, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <strong style={{ flex: 1, overflowWrap: 'anywhere' }}>{b.file_name}</strong>
                            <span style={{ fontSize: '0.8rem', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                {b.import_outcome === 'confirmed' && <CheckCircle2 size={14} color="#059669" />}{IMPORT_OUTCOME_LABELS_TH[b.import_outcome]}
                            </span>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>
                            {b.kind === 'invoice' ? 'ตั้งลูกหนี้' : 'รับชำระ'} · {b.from} ถึง {b.to} · {b.vouchers_count} เอกสาร / {b.lines_count} บรรทัด · Dr. {baht(b.dr_satang)} / Cr. {baht(b.cr_satang)} · template {b.template_version} · โดย {b.created_by_name} {new Date(b.created_at).toLocaleString('th-TH')}
                        </div>
                        {b.import_note && <div style={{ fontSize: '0.8rem' }}>หมายเหตุ: {b.import_note}</div>}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void download(b)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={13} /> ดาวน์โหลดอีกครั้ง</button>
                            {b.import_outcome !== 'confirmed' && <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void outcome(b, 'confirmed')}>นำเข้าสำเร็จแล้ว</button>}
                            {b.import_outcome === 'unknown' && <>
                                <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void outcome(b, 'partial')}>นำเข้าบางส่วน</button>
                                <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void outcome(b, 'failed')}>นำเข้าล้มเหลว</button>
                            </>}
                        </div>
                    </div>
                ))}
            </section>
        </div>
    );
}
