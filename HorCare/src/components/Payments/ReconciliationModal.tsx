import { useMemo, useRef, useState } from 'react';
import { X, Upload, Plus, Loader2, CheckCheck, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { parseStatementCsv } from '../../utils/bankCsv';
import {
    CONFLICT_REASON_LABELS_TH, MATCH_REASON_LABELS_TH, RECON_STATUSES, RECON_STATUS_LABELS_TH,
    type BankTransaction, type ReconStatus,
} from '../../shared/reconciliation';
import { bankAccountLabel, type BankAccount } from '../../shared/banks';
import BankLogo from './BankLogo';

interface Props {
    ownerUid: string;
    buildingId: string;
    accounts: BankAccount[];
    transactions: BankTransaction[];
    loading: boolean;
    onClose: () => void;
}

const ERRORS: Record<string, string> = {
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบวันที่และจำนวนเงิน',
    forbidden: 'คุณไม่มีสิทธิ์กระทบยอดบัญชี',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
    amount_mismatch: 'ยอดเงินไม่ตรงกัน จึงจับคู่ไม่ได้',
    already_reconciled: 'รายการนี้ยืนยันไปแล้ว',
    item_already_reconciled: 'บิลนี้ถูกยืนยันกับรายการธนาคารอื่นแล้ว',
    account_not_found: 'ไม่พบบัญชีที่เลือก',
};

const STATUS_COLORS: Record<ReconStatus, { bg: string; fg: string }> = {
    unmatched: { bg: '#F3F4F6', fg: '#4B5563' },
    suggested: { bg: '#FEF3C7', fg: '#92400E' },
    matched: { bg: '#DBEAFE', fg: '#1E40AF' },
    conflict: { bg: '#FEE2E2', fg: '#991B1B' },
    reconciled: { bg: '#D1FAE5', fg: '#065F46' },
};

const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
const kindLabel = (k: 'bill' | 'fine') => (k === 'bill' ? 'บิล' : 'ค่าปรับ');

export default function ReconciliationModal({ ownerUid, buildingId, accounts, transactions, loading, onClose }: Props) {
    const [filter, setFilter] = useState<ReconStatus | 'all'>('all');
    const [accountId, setAccountId] = useState(accounts.find(a => a.is_default)?.id ?? accounts[0]?.id ?? '');
    const [busy, setBusy] = useState<string | null>(null);
    const [showManual, setShowManual] = useState(false);
    const [manual, setManual] = useState({ occurred_at: '', amount: '', reference: '', description: '' });
    const fileRef = useRef<HTMLInputElement>(null);

    const accountById = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
    const counts = useMemo(() => {
        const c: Record<string, number> = { all: transactions.length };
        for (const t of transactions) c[t.status] = (c[t.status] ?? 0) + 1;
        return c;
    }, [transactions]);
    const shown = filter === 'all' ? transactions : transactions.filter(t => t.status === filter);

    const call = async <T,>(key: string, body: Record<string, unknown>): Promise<T | null> => {
        setBusy(key);
        try {
            return await apiPost<T>('reconciliation', { owner_uid: ownerUid, building_id: buildingId, ...body });
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
            return null;
        } finally {
            setBusy(null);
        }
    };

    const importRows = async (rows: unknown[], source: 'csv' | 'manual') => {
        const r = await call<{ created: number; skipped: number }>('import', { action: 'import', bank_account_id: accountId, rows, source });
        if (r) toast.success(`นำเข้า ${r.created} รายการ${r.skipped ? ` (ซ้ำ ${r.skipped} ข้าม)` : ''}`);
        return !!r;
    };

    const onFile = async (file: File | undefined) => {
        if (!file) return;
        const parsed = parseStatementCsv(await file.text());
        if (parsed.error === 'no_header') return void toast.error('ไฟล์ว่างหรือไม่มีหัวตาราง');
        if (parsed.error === 'no_columns') return void toast.error('ไม่พบคอลัมน์ "วันที่" และ "เงินเข้า/จำนวนเงิน" ในไฟล์');
        if (parsed.rows.length === 0) return void toast.error('ไม่พบรายการเงินเข้าในไฟล์');
        if (parsed.rows.length > 500) return void toast.error('นำเข้าได้ครั้งละไม่เกิน 500 รายการ');
        await importRows(parsed.rows, 'csv');
        if (fileRef.current) fileRef.current.value = '';
    };

    const addManual = async () => {
        const amount = Number(manual.amount);
        const d = manual.occurred_at ? new Date(manual.occurred_at) : null;
        if (!d || Number.isNaN(d.getTime()) || !(amount > 0)) return void toast.error(ERRORS.invalid_input);
        const ok = await importRows([{ occurred_at: d.toISOString(), amount, reference: manual.reference.trim() || null, description: manual.description.trim() || null }], 'manual');
        if (ok) { setManual({ occurred_at: '', amount: '', reference: '', description: '' }); setShowManual(false); }
    };

    const confirm = async (tx: BankTransaction, kind: 'bill' | 'fine', id: string) => {
        const r = await call('c:' + tx.id, { action: 'confirm', tx_id: tx.id, item_kind: kind, item_id: id });
        if (r) toast.success('ยืนยันแล้ว — การชำระเงินนี้ตรวจสอบกับบัญชีธนาคารแล้ว');
    };
    const reject = async (tx: BankTransaction) => {
        if (await call('r:' + tx.id, { action: 'reject', tx_id: tx.id })) toast.success('ไม่ใช่รายการนี้ — ระบบจะไม่แนะนำซ้ำ');
    };
    const rematch = async () => {
        const r = await call<{ changed: number }>('rematch', { action: 'rematch' });
        if (r) toast.success(r.changed ? `จับคู่ใหม่ ${r.changed} รายการ` : 'ไม่มีรายการเปลี่ยนแปลง');
    };
    const confirmMatched = async () => {
        const n = counts.matched ?? 0;
        if (n === 0 || !window.confirm(`ยืนยัน ${n} รายการที่เลขอ้างอิงและยอดตรงกันทั้งหมด?`)) return;
        const r = await call<{ confirmed: number; failed: number }>('bulk', { action: 'confirm_matched' });
        if (r) toast.success(`ยืนยัน ${r.confirmed} รายการ${r.failed ? ` · ไม่สำเร็จ ${r.failed}` : ''}`);
    };

    const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, minWidth: 0, font: 'inherit' };
    const noAccounts = accounts.length === 0;

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div className="modal" style={{ maxWidth: 760 }} role="dialog" aria-modal="true" aria-label="กระทบยอดบัญชีธนาคาร">
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="modal-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><ShieldCheck size={20} /> กระทบยอดบัญชีธนาคาร</span>
                    <button className="btn-icon" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                        สลิปที่ลูกบ้านส่งเป็นเพียงหลักฐานเบื้องต้น — รายการจะ “ตรวจสอบแล้ว” ก็ต่อเมื่อคุณยืนยันว่าตรงกับเงินที่เข้าบัญชีจริงตาม statement
                    </p>

                    {noAccounts ? (
                        <div style={{ padding: '1rem', background: '#FEF3C7', borderRadius: 8, fontSize: '0.9rem' }}>กรุณาเพิ่มบัญชีรับเงินก่อน แล้วจึงนำเข้ารายการธนาคาร</div>
                    ) : (
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <select value={accountId} onChange={e => setAccountId(e.target.value)} style={input} aria-label="บัญชีที่นำเข้า">
                                {accounts.map(a => <option key={a.id} value={a.id}>{bankAccountLabel(a)}</option>)}
                            </select>
                            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => void onFile(e.target.files?.[0])} />
                            <button className="btn btn-primary btn-sm" disabled={!!busy || !accountId} onClick={() => fileRef.current?.click()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                {busy === 'import' ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} นำเข้า statement (CSV)
                            </button>
                            <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => setShowManual(s => !s)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <Plus size={14} /> เพิ่มรายการเอง
                            </button>
                            <span style={{ flex: 1 }} />
                            <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void rematch()} title="จับคู่ใหม่กับสลิปล่าสุด" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <RefreshCw size={14} /> จับคู่ใหม่
                            </button>
                            <button className="btn btn-outline btn-sm" disabled={!!busy || !(counts.matched > 0)} onClick={() => void confirmMatched()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                <CheckCheck size={14} /> ยืนยันที่จับคู่แล้ว ({counts.matched ?? 0})
                            </button>
                        </div>
                    )}

                    {showManual && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.5rem', padding: '0.75rem', border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 10 }}>
                            <input type="datetime-local" value={manual.occurred_at} onChange={e => setManual({ ...manual, occurred_at: e.target.value })} style={input} aria-label="วันที่เวลา" />
                            <input type="number" min="0" step="0.01" placeholder="จำนวนเงิน" value={manual.amount} onChange={e => setManual({ ...manual, amount: e.target.value })} style={input} />
                            <input placeholder="เลขอ้างอิง (ถ้ามี)" value={manual.reference} onChange={e => setManual({ ...manual, reference: e.target.value })} style={input} maxLength={80} />
                            <input placeholder="รายละเอียด (ถ้ามี)" value={manual.description} onChange={e => setManual({ ...manual, description: e.target.value })} style={input} maxLength={200} />
                            <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void addManual()}>บันทึกรายการ</button>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                        {(['all', ...RECON_STATUSES] as const).map(s => (
                            <button key={s} onClick={() => setFilter(s)} className={filter === s ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>
                                {s === 'all' ? 'ทั้งหมด' : RECON_STATUS_LABELS_TH[s]} ({counts[s] ?? 0})
                            </button>
                        ))}
                    </div>

                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '1.5rem' }}><Loader2 className="spin" /></div>
                    ) : shown.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--color-gray-500)' }}>
                            {transactions.length === 0 ? 'ยังไม่มีรายการธนาคาร — นำเข้า statement เพื่อเริ่มกระทบยอด' : 'ไม่มีรายการในสถานะนี้'}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', maxHeight: '48vh', overflowY: 'auto' }}>
                            {shown.map(tx => {
                                const acc = accountById.get(tx.bank_account_id);
                                const color = STATUS_COLORS[tx.status];
                                const open = tx.status !== 'reconciled';
                                return (
                                    <div key={tx.id} style={{ border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 10, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'center' }}>
                                            <BankLogo short={acc?.bank_short} size={32} />
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontWeight: 700 }}>+{baht(tx.amount)} ฿</div>
                                                <div style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)', overflowWrap: 'anywhere' }}>
                                                    {when(tx.occurred_at)}{tx.reference ? ` · อ้างอิง ${tx.reference}` : ''}{tx.description ? ` · ${tx.description}` : ''}
                                                </div>
                                            </div>
                                            <span style={{ background: color.bg, color: color.fg, borderRadius: 999, padding: '0.15rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                                {RECON_STATUS_LABELS_TH[tx.status]}
                                            </span>
                                        </div>

                                        {tx.matched && (
                                            <div style={{ fontSize: '0.85rem' }}>
                                                {tx.status === 'reconciled' ? 'ยืนยันกับ' : 'คู่ที่พบ:'} <strong>ห้อง {tx.matched.room_number}</strong> · {kindLabel(tx.matched.kind)}
                                                {tx.status !== 'reconciled' && (() => {
                                                    const c = tx.candidates.find(x => x.id === tx.matched?.id);
                                                    return c ? <span style={{ color: 'var(--color-gray-500)' }}> ({c.reasons.map(r => MATCH_REASON_LABELS_TH[r] ?? r).join(', ')})</span> : null;
                                                })()}
                                            </div>
                                        )}

                                        {tx.status === 'conflict' && tx.conflict_reason && (
                                            <div style={{ fontSize: '0.82rem', color: '#991B1B', display: 'flex', gap: 6, alignItems: 'center' }}>
                                                <AlertTriangle size={14} /> {CONFLICT_REASON_LABELS_TH[tx.conflict_reason] ?? tx.conflict_reason}
                                            </div>
                                        )}

                                        {open && (
                                            <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                                                {tx.matched && (
                                                    <>
                                                        <button className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void confirm(tx, tx.matched!.kind, tx.matched!.id)}>
                                                            {busy === 'c:' + tx.id ? <Loader2 size={14} className="spin" /> : 'ยืนยัน'}
                                                        </button>
                                                        <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void reject(tx)}>ไม่ใช่รายการนี้</button>
                                                    </>
                                                )}
                                                {tx.candidates.filter(c => c.id !== tx.matched?.id && !c.taken).map(c => (
                                                    <button key={c.id} className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void confirm(tx, c.kind, c.id)}
                                                        title={c.reasons.map(r => MATCH_REASON_LABELS_TH[r] ?? r).join(', ')}>
                                                        จับคู่กับห้อง {c.room_number} ({kindLabel(c.kind)})
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
