import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Lock, Plus, Save, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { bankAccountLabel } from '../../shared/banks';
import { REVENUE_CATEGORIES, REVENUE_CATEGORY_LABELS_TH } from '../../shared/accounting';
import {
    ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS_TH, emptyLedger, ledgerGaps, todayThDate, type Account, type Ledger,
} from '../../shared/ledger';
import type { Building } from '../../types';

interface Props { ownerUid: string; buildings: Building[]; ledgers: Ledger[]; selectedId: string; onSelect: (id: string) => void }

const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.875rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 8 };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box', width: '100%' };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 };
const lab: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.8rem' };

const ERRORS: Record<string, string> = {
    invalid_chart: 'ผังบัญชีไม่ถูกต้อง (รหัสซ้ำ รูปแบบผิด หรือไม่มีชื่อ)',
    account_in_use: 'ลบหรือเปลี่ยนประเภทบัญชีที่มีรายการแล้วไม่ได้ — ปิดใช้งานแทน',
    property_in_other_ledger: 'สถานที่นี้อยู่ในสมุดบัญชีอื่นแล้ว',
    invalid_input: 'ข้อมูลไม่ถูกต้อง',
    use_unlock_to_reopen: 'ปิดงวดย้อนหลังไม่ได้ ใช้การเปิดงวดพร้อมเหตุผล',
    forbidden: 'คุณไม่มีสิทธิ์ตั้งค่า (เจ้าของ/ผู้จัดการเท่านั้น)',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
    return (
        <section style={card}>
            <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
            {hint && <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>{hint}</p>}
            {children}
        </section>
    );
}

export default function LedgerSettingsTab({ ownerUid, buildings, ledgers, selectedId, onSelect }: Props) {
    const [draft, setDraft] = useState<Ledger | null>(null);
    const [busy, setBusy] = useState(false);
    const { accounts: bankAccounts } = useBankAccounts(ownerUid, draft?.property_ids[0] ?? null);

    useEffect(() => {
        if (selectedId === 'new') return;
        const l = ledgers.find(x => x.id === selectedId);
        if (l) setDraft(structuredClone(l));
    }, [selectedId, ledgers]);
    const startNew = () => { onSelect('new'); setDraft(emptyLedger(crypto.randomUUID())); };

    const gaps = useMemo(() => (draft ? ledgerGaps(draft) : []), [draft]);
    if (!draft) return <div style={card}>ยังไม่มีสมุดบัญชี <button className="btn btn-primary btn-sm" onClick={startNew} style={{ alignSelf: 'flex-start' }}>สร้างสมุดบัญชี</button></div>;
    const d = draft;
    const upd = (patch: Partial<Ledger>) => setDraft({ ...d, ...patch });
    const setAccount = (i: number, patch: Partial<Account>) => upd({ accounts: d.accounts.map((a, k) => (k === i ? { ...a, ...patch } : a)) });
    const active = (type: Account['type'][]) => d.accounts.filter(a => a.active && type.includes(a.type));
    const isNew = !ledgers.some(l => l.id === d.id);
    // written by the server after each automatic posting run (api/_ledger-auto.ts)
    const lastAuto = (ledgers.find(l => l.id === d.id) as { auto_post?: { at: string; posted: number; problems: number; first_problem: string | null } } | undefined)?.auto_post;

    const call = async (body: Record<string, unknown>, ok: string): Promise<boolean> => {
        setBusy(true);
        try { await apiPost('ledger', { owner_uid: ownerUid, ...body }); toast.success(ok); return true; }
        catch (e) { const err = e as ApiError; toast.error(ERRORS[err.code] ?? err.message ?? 'บันทึกไม่สำเร็จ'); return false; }
        finally { setBusy(false); }
    };
    const save = async () => { if (await call({ action: 'ledger_save', ledger_id: d.id, ledger: d }, 'บันทึกสมุดบัญชีแล้ว')) onSelect(d.id); };
    const lock = async () => {
        const through = window.prompt('ปิดงวดถึงวันที่ (YYYY-MM-DD) — หลังปิดแล้วลงรายการวันที่ก่อนหน้านี้ไม่ได้', d.locked_through ?? todayThDate());
        if (through) await call({ action: 'lock_period', ledger_id: d.id, through }, 'ปิดงวดแล้ว');
    };
    const unlock = async () => {
        const reason = window.prompt('เปิดงวดย้อนหลัง — เหตุผล (จำเป็น และถูกบันทึกไว้)');
        if (!reason?.trim()) return;
        const through = window.prompt('เปิดให้ลงรายการได้ตั้งแต่หลังวันที่ (YYYY-MM-DD) เว้นว่าง = เปิดทั้งหมด', '');
        await call({ action: 'unlock_period', ledger_id: d.id, through: through?.trim() || null, reason }, 'เปิดงวดแล้ว');
    };

    const channels = [{ key: 'cash', label: 'เงินสด' }, ...bankAccounts.filter(a => a.status === 'active').map(a => ({ key: `bank:${a.id}`, label: bankAccountLabel(a) })), { key: 'qr_gateway', label: 'QR / Payment Gateway' }, { key: 'other', label: 'อื่นๆ' }];
    const setChannel = (key: string, code: string) => {
        const next = { ...d.posting.channels };
        if (code) next[key] = code; else delete next[key];
        upd({ posting: { ...d.posting, channels: next } });
    };
    const select = (value: string, onChange: (v: string) => void, options: Account[], blank = 'เลือกบัญชี…') => (
        <select style={input} value={value} onChange={e => onChange(e.target.value)}>
            <option value="">{blank}</option>
            {options.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
        </select>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={selectedId} onChange={e => onSelect(e.target.value)} style={{ ...input, width: 'auto' }} aria-label="สมุดบัญชี">
                    {ledgers.map(l => <option key={l.id} value={l.id}>{l.name || l.legal_entity_name}</option>)}
                    {selectedId === 'new' && <option value="new">สมุดบัญชีใหม่</option>}
                </select>
                <button className="btn btn-outline btn-sm" onClick={startNew} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Plus size={14} /> สมุดบัญชีใหม่</button>
            </div>

            {gaps.length > 0 && (
                <div style={{ ...card, background: '#FEF3C7' }}>
                    <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={15} /> ยังขาด {gaps.length} รายการก่อนลงบัญชีได้</strong>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem' }}>{gaps.map((g, i) => <li key={i}>{g.message}</li>)}</ul>
                </div>
            )}

            <Section title="นิติบุคคลและสถานที่" hint="หนึ่งสมุดบัญชี = หนึ่งนิติบุคคล และหนึ่งสถานที่อยู่ได้ในสมุดเดียว">
                <div style={row}>
                    <label style={lab}>ชื่อสมุดบัญชี<input style={input} value={d.name} onChange={e => upd({ name: e.target.value })} maxLength={80} /></label>
                    <label style={lab}>ชื่อนิติบุคคล<input style={input} value={d.legal_entity_name} onChange={e => upd({ legal_entity_name: e.target.value })} maxLength={120} /></label>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {buildings.map(b => (
                        <label key={b.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
                            <input type="checkbox" checked={d.property_ids.includes(b.id)} disabled={!isNew && d.property_ids.includes(b.id) && d.property_ids.length === 1}
                                onChange={e => upd({ property_ids: e.target.checked ? [...d.property_ids, b.id] : d.property_ids.filter(x => x !== b.id) })} /> {b.name}
                            {d.property_ids.includes(b.id) && buildings.length > 1 && (
                                <input style={{ ...input, width: 80 }} placeholder="รหัสย่อ" maxLength={12} value={d.property_codes[b.id] ?? ''} onChange={e => upd({ property_codes: { ...d.property_codes, [b.id]: e.target.value } })} />
                            )}
                        </label>
                    ))}
                </div>
            </Section>

            <Section title="ผังบัญชี" hint="รหัสเป็นของเรา แก้ได้ บัญชีที่มีรายการแล้วลบไม่ได้ (ปิดใช้งานแทน)">
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                        <thead><tr style={{ textAlign: 'left' }}><th>รหัส</th><th>ชื่อบัญชี</th><th>ประเภท</th><th>ใช้งาน</th><th /></tr></thead>
                        <tbody>
                            {d.accounts.map((a, i) => (
                                <tr key={i}>
                                    <td><input style={{ ...input, width: 90 }} value={a.code} maxLength={20} onChange={e => setAccount(i, { code: e.target.value })} aria-label="รหัสบัญชี" /></td>
                                    <td><input style={input} value={a.name} maxLength={100} onChange={e => setAccount(i, { name: e.target.value })} aria-label="ชื่อบัญชี" /></td>
                                    <td><select style={input} value={a.type} onChange={e => setAccount(i, { type: e.target.value as Account['type'] })}>{ACCOUNT_TYPES.map(t => <option key={t} value={t}>{ACCOUNT_TYPE_LABELS_TH[t]}</option>)}</select></td>
                                    <td><input type="checkbox" checked={a.active} onChange={e => setAccount(i, { active: e.target.checked })} aria-label="ใช้งาน" /></td>
                                    <td><button className="btn btn-outline btn-sm" onClick={() => upd({ accounts: d.accounts.filter((_, k) => k !== i) })} aria-label="ลบบัญชี"><Trash2 size={13} /></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div><button className="btn btn-outline btn-sm" onClick={() => upd({ accounts: [...d.accounts, { code: '', name: '', type: 'asset', active: true }] })} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Plus size={14} /> เพิ่มบัญชี</button></div>
            </Section>

            <Section title="บัญชีที่ใช้ลงรายการอัตโนมัติ">
                <div style={row}>
                    <label style={lab}>ลูกหนี้ค่าเช่า/บริการ{select(d.posting.ar_account, v => upd({ posting: { ...d.posting, ar_account: v } }), active(['asset']))}</label>
                    {REVENUE_CATEGORIES.map(c => (
                        <label key={c} style={lab}>รายได้: {REVENUE_CATEGORY_LABELS_TH[c]}{select(d.posting.revenue_accounts[c] ?? '', v => upd({ posting: { ...d.posting, revenue_accounts: { ...d.posting.revenue_accounts, [c]: v } } }), active(['revenue']))}</label>
                    ))}
                </div>
                <strong style={{ fontSize: '0.85rem' }}>ช่องทางรับเงิน → บัญชีสินทรัพย์ (เงินสด/ธนาคาร)</strong>
                <div style={row}>
                    {channels.map(c => <label key={c.key} style={lab}>{c.label}{select(d.posting.channels[c.key] ?? '', v => setChannel(c.key, v), active(['asset']), 'ไม่ใช้ช่องทางนี้')}</label>)}
                </div>
            </Section>

            <Section title="ตัวเลือก">
                <div style={row}>
                    <label style={lab}>วันที่ตั้งลูกหนี้
                        <select style={input} value={d.options.invoice_date_basis} onChange={e => upd({ options: { ...d.options, invoice_date_basis: e.target.value as Ledger['options']['invoice_date_basis'] } })}>
                            <option value="issued_at">วันที่ออกบิล</option><option value="month_end">สิ้นเดือนของงวดบิล</option>
                        </select></label>
                    <label style={lab}>บิลก่อนเดือนนี้เป็นยอดยกมา ไม่ลงซ้ำ<input style={input} placeholder="YYYY-MM" value={d.options.opening_cutoff_month ?? ''} onChange={e => upd({ options: { ...d.options, opening_cutoff_month: e.target.value.trim() || null } })} /></label>
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={d.options.count_unverified_transfers} onChange={e => upd({ options: { ...d.options, count_unverified_transfers: e.target.checked } })} /> นับเงินโอนที่ยังไม่ยืนยันกับบัญชีธนาคารเป็นเงินรับ (ไม่แนะนำ)
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={d.options.auto_post !== false} onChange={e => upd({ options: { ...d.options, auto_post: e.target.checked } })} /> ลงบัญชีอัตโนมัติทันที (ตั้งลูกหนี้เมื่อออกบิล · รับชำระเมื่อได้รับเงิน)
                </label>
                {lastAuto && (
                    <p style={{ margin: 0, fontSize: '0.78rem', color: lastAuto.problems ? '#B45309' : 'var(--color-gray-500)' }}>
                        ลงอัตโนมัติล่าสุด {new Date(lastAuto.at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })} · ลงใหม่ {lastAuto.posted} รายการ
                        {lastAuto.problems ? ` · ข้าม ${lastAuto.problems} รายการ: ${lastAuto.first_problem ?? ''}` : ''}
                    </p>
                )}
            </Section>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void save()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />} บันทึกการตั้งค่า
                </button>
            </div>

            {!isNew && (
                <Section title="ปิดงวดบัญชี" hint="หลังปิดงวด จะลงรายการหรือกลับรายการที่มีวันที่ในงวดนั้นไม่ได้ เปิดงวดย้อนหลังต้องระบุเหตุผลและถูกบันทึก">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.9rem' }}>{d.locked_through ? `ปิดงวดถึง ${d.locked_through}` : 'ยังไม่ได้ปิดงวด'}</span>
                        <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void lock()} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Lock size={13} /> ปิดงวด</button>
                        {d.locked_through && <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void unlock()}>เปิดงวดย้อนหลัง</button>}
                    </div>
                </Section>
            )}
        </div>
    );
}
