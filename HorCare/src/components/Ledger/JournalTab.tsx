import { useMemo, useState } from 'react';
import { Download, Loader2, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { downloadCsv } from '../../utils/csv';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { fromSatang } from '../../shared/accounting';
import { todayThDate, type JournalEntry, type Ledger } from '../../shared/ledger';

interface Props { ownerUid: string; ledger: Ledger; entries: JournalEntry[] }

const baht = (s: number) => fromSatang(s).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)' };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box' };
const KIND_LABELS: Record<JournalEntry['kind'], string> = { invoice: 'ตั้งลูกหนี้', receipt: 'รับชำระ', manual: 'ปรับปรุงเอง', reversal: 'กลับรายการ' };

const ERRORS: Record<string, string> = {
    period_locked: 'งวดนี้ปิดแล้ว',
    already_reversed: 'รายการนี้ถูกกลับรายการไปแล้ว',
    reason_required: 'กรุณาระบุเหตุผล',
    memo_required: 'กรุณาระบุคำอธิบายรายการ',
    invalid_entry: 'รายการไม่ถูกต้อง — เดบิตต้องเท่าเครดิต และต้องเลือกบัญชีทุกบรรทัด',
    invalid_input: 'ข้อมูลไม่ถูกต้อง',
    forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};

interface FormLine { account: string; debit: string; credit: string; description: string }
const blankLine = (): FormLine => ({ account: '', debit: '', credit: '', description: '' });

export default function JournalTab({ ownerUid, ledger, entries }: Props) {
    const [open, setOpen] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [date, setDate] = useState(todayThDate());
    const [memo, setMemo] = useState('');
    const [lines, setLines] = useState<FormLine[]>([blankLine(), blankLine()]);
    const [busy, setBusy] = useState<string | null>(null);

    const names = useMemo(() => new Map(ledger.accounts.map(a => [a.code, a.name])), [ledger.accounts]);
    const shown = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (q ? entries.filter(e => `${e.doc_ref} ${e.memo} ${e.date}`.toLowerCase().includes(q)) : entries).slice(0, 300);
    }, [entries, search]);

    const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    const balanced = Math.round(dr * 100) === Math.round(cr * 100) && dr > 0;

    const call = async (key: string, body: Record<string, unknown>) => {
        setBusy(key);
        try { await apiPost('ledger', { owner_uid: ownerUid, ledger_id: ledger.id, ...body }); return true; }
        catch (e) { const err = e as ApiError; toast.error(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ'); return false; }
        finally { setBusy(null); }
    };
    const reverse = async (e: JournalEntry) => {
        const reason = window.prompt(`กลับรายการ ${e.doc_ref} — เหตุผล (จำเป็น)`);
        if (!reason?.trim()) return;
        if (await call('r:' + e.id, { action: 'reverse', entry_id: e.id, reason })) toast.success('กลับรายการแล้ว');
    };
    const saveManual = async () => {
        const payload = lines.filter(l => l.account || l.debit || l.credit).map(l => ({
            account: l.account, debit: l.debit ? Number(l.debit) : undefined, credit: l.credit ? Number(l.credit) : undefined, description: l.description || undefined,
        }));
        if (await call('manual', { action: 'manual_entry', date, memo, lines: payload })) {
            toast.success('บันทึกรายการแล้ว'); setShowForm(false); setMemo(''); setLines([blankLine(), blankLine()]);
        }
    };
    /** One row per journal line, oldest first — a neutral file any accounting package can be fed from. */
    const exportCsv = () => {
        const rows: (string | number)[][] = [['วันที่', 'เลขเอกสาร', 'ประเภท', 'คำอธิบาย', 'รหัสบัญชี', 'ชื่อบัญชี', 'รายการ', 'เดบิต', 'เครดิต', 'แผง/ห้อง (รหัสภายใน)']];
        for (const e of [...entries].reverse()) {
            for (const l of e.lines) rows.push([e.date, e.doc_ref, KIND_LABELS[e.kind], e.memo, l.account, names.get(l.account) ?? '', l.description, l.dr_satang ? fromSatang(l.dr_satang) : '', l.cr_satang ? fromSatang(l.cr_satang) : '', l.party_id ?? '']);
        }
        downloadCsv(`journal-${ledger.name || ledger.id}.csv`, rows);
    };
    const setLine = (i: number, patch: Partial<FormLine>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input style={{ ...input, flex: 1, minWidth: 180 }} placeholder="ค้นหาเลขเอกสาร / คำอธิบาย / วันที่" value={search} onChange={e => setSearch(e.target.value)} />
                <button className="btn btn-outline btn-sm" onClick={() => exportCsv()} disabled={entries.length === 0} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={14} /> ส่งออก CSV</button>
                <button className="btn btn-outline btn-sm" onClick={() => setShowForm(s => !s)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Plus size={14} /> บันทึกรายการปรับปรุง</button>
            </div>

            {showForm && (
                <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input type="date" style={input} value={date} max={todayThDate()} onChange={e => setDate(e.target.value)} aria-label="วันที่" />
                        <input style={{ ...input, flex: 1, minWidth: 200 }} placeholder="คำอธิบายรายการ (จำเป็น)" maxLength={300} value={memo} onChange={e => setMemo(e.target.value)} />
                    </div>
                    {lines.map((l, i) => (
                        <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,2fr) 1fr 1fr minmax(120px,2fr) auto', gap: 6 }}>
                            <select style={input} value={l.account} onChange={e => setLine(i, { account: e.target.value })} aria-label="บัญชี">
                                <option value="">เลือกบัญชี…</option>
                                {ledger.accounts.filter(a => a.active).map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                            </select>
                            <input type="number" min="0" step="0.01" style={input} placeholder="เดบิต" value={l.debit} onChange={e => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
                            <input type="number" min="0" step="0.01" style={input} placeholder="เครดิต" value={l.credit} onChange={e => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
                            <input style={input} placeholder="หมายเหตุบรรทัด" value={l.description} onChange={e => setLine(i, { description: e.target.value })} maxLength={200} />
                            <button className="btn btn-outline btn-sm" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label="ลบบรรทัด"><Trash2 size={13} /></button>
                        </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <button className="btn btn-outline btn-sm" onClick={() => setLines([...lines, blankLine()])}>+ เพิ่มบรรทัด</button>
                        <span style={{ fontSize: '0.85rem', color: balanced ? '#065F46' : '#B91C1C' }}>เดบิต {baht(Math.round(dr * 100))} / เครดิต {baht(Math.round(cr * 100))} {balanced ? '✓' : '— ยังไม่เท่ากัน'}</span>
                        <span style={{ flex: 1 }} />
                        <button className="btn btn-primary btn-sm" disabled={!balanced || !memo.trim() || busy === 'manual'} onClick={() => void saveManual()}>{busy === 'manual' ? <Loader2 size={14} className="spin" /> : 'บันทึกรายการ'}</button>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>บันทึกแล้วแก้ไขหรือลบไม่ได้ — ถ้าผิดให้ใช้การกลับรายการ</span>
                </div>
            )}

            {shown.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ยังไม่มีรายการในสมุดรายวัน</div> : shown.map(e => (
                <div key={e.id} style={{ ...card, opacity: e.reversed_by ? 0.65 : 1 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => setOpen(open === e.id ? null : e.id)}>
                        <strong style={{ minWidth: 100 }}>{e.date}</strong>
                        <span style={{ fontSize: '0.8rem', background: 'var(--color-gray-100, #F3F4F6)', borderRadius: 999, padding: '0.1rem 0.5rem' }}>{KIND_LABELS[e.kind]}</span>
                        <span style={{ flex: 1, minWidth: 140, overflowWrap: 'anywhere' }}>{e.doc_ref} · {e.memo}</span>
                        {e.reversed_by && <span style={{ fontSize: '0.75rem', color: '#92400E' }}>ถูกกลับรายการแล้ว</span>}
                        <strong>{baht(e.total_satang)}</strong>
                    </div>
                    {open === e.id && (
                        <div style={{ marginTop: 8, fontSize: '0.85rem' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <tbody>
                                    {e.lines.map((l, i) => (
                                        <tr key={i} style={{ borderTop: '1px solid var(--color-gray-100, #F3F4F6)' }}>
                                            <td style={{ padding: '0.25rem' }}>{l.account} {names.get(l.account) ?? ''}</td>
                                            <td style={{ color: 'var(--color-gray-500)' }}>{l.description}</td>
                                            <td style={{ textAlign: 'right' }}>{l.dr_satang ? baht(l.dr_satang) : ''}</td>
                                            <td style={{ textAlign: 'right' }}>{l.cr_satang ? baht(l.cr_satang) : ''}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: 'var(--color-gray-500)', fontSize: '0.75rem' }}>
                                ลงโดย {e.posted_by_name} · {new Date(e.posted_at).toLocaleString('th-TH')}{e.reason ? ` · เหตุผล: ${e.reason}` : ''}
                                {e.kind !== 'reversal' && !e.reversed_by && (
                                    <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => void reverse(e)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><RotateCcw size={13} /> กลับรายการ</button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
