import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { useBuildingRooms } from '../../hooks/useAccountingData';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { bankAccountLabel } from '../../shared/banks';
import {
    REVENUE_CATEGORIES, REVENUE_CATEGORY_LABELS_TH, emptyProfile, profileGaps, type MangoProfile,
} from '../../shared/accounting';
import type { Building } from '../../types';

interface Props { ownerUid: string; buildings: Building[]; profiles: MangoProfile[] }

const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.875rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 8 };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box', width: '100%' };
const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 };
const lab: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.8rem' };

const ERRORS: Record<string, string> = {
    property_in_other_profile: 'สถานที่นี้อยู่ในโปรไฟล์อื่นแล้ว (หนึ่งสถานที่ส่งออกได้โดยนิติบุคคลเดียว)',
    profile_incomplete: 'ยังอนุมัติไม่ได้ — การตั้งค่าไม่ครบ',
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบช่องที่กรอก',
    forbidden: 'คุณไม่มีสิทธิ์ตั้งค่า (ต้องเป็นเจ้าของ/ผู้จัดการ)',
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

/** Customer-code table for the rooms of one property. */
function CustomerCodes({ ownerUid, building, profile, setProfile }: { ownerUid: string; building: Building; profile: MangoProfile; setProfile: (p: MangoProfile) => void }) {
    const { rooms } = useBuildingRooms(ownerUid, building.id);
    const missing = rooms.filter(r => !profile.customers[r.id]?.code?.trim()).length;
    const set = (roomId: string, code: string) => setProfile({ ...profile, customers: { ...profile.customers, [roomId]: { code } } });
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <strong style={{ fontSize: '0.85rem' }}>{building.name} {missing > 0 && <span style={{ color: '#B45309', fontWeight: 400 }}>· ยังไม่มีรหัส {missing} รายการ</span>}</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 6 }}>
                {rooms.map(r => (
                    <label key={r.id} style={{ ...lab, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <span style={{ minWidth: 48 }}>{r.room_number}</span>
                        <input style={input} placeholder="Customer Code" value={profile.customers[r.id]?.code ?? ''} onChange={e => set(r.id, e.target.value)} maxLength={40} />
                    </label>
                ))}
            </div>
        </div>
    );
}

function ChannelRows({ ownerUid, buildingId, profile, setProfile }: { ownerUid: string; buildingId: string; profile: MangoProfile; setProfile: (p: MangoProfile) => void }) {
    const { accounts } = useBankAccounts(ownerUid, buildingId);
    const entries = [
        { key: 'cash', label: 'เงินสด' },
        ...accounts.map(a => ({ key: `bank:${a.id}`, label: bankAccountLabel(a) })),
        { key: 'qr_gateway', label: 'QR / Payment Gateway' },
        { key: 'other', label: 'อื่นๆ' },
    ];
    const set = (key: string, patch: Partial<{ account: string; option_code: string | null }>) =>
        setProfile({ ...profile, channels: { ...profile.channels, [key]: { ...(profile.channels[key] ?? { account: '', option_code: null }), ...patch } } });
    return (
        <>
            {entries.map(e => (
                <div key={e.key} style={row}>
                    <div style={{ fontSize: '0.85rem', alignSelf: 'center', overflowWrap: 'anywhere' }}>{e.label}</div>
                    <input style={input} placeholder="รหัสบัญชีรับเงิน" value={profile.channels[e.key]?.account ?? ''} onChange={ev => set(e.key, { account: ev.target.value })} maxLength={40} />
                    <input style={input} placeholder="Option pay & Receipt" value={profile.channels[e.key]?.option_code ?? ''} onChange={ev => set(e.key, { option_code: ev.target.value || null })} maxLength={40} />
                </div>
            ))}
        </>
    );
}

export default function MangoSettingsTab({ ownerUid, buildings, profiles }: Props) {
    const [selected, setSelected] = useState<string>(profiles[0]?.id ?? 'new');
    const [draft, setDraft] = useState<MangoProfile | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (selected === 'new') return;
        const p = profiles.find(x => x.id === selected);
        if (p) setDraft(structuredClone(p));
    }, [selected, profiles]);
    const startNew = () => { setSelected('new'); setDraft(emptyProfile(crypto.randomUUID())); };

    const gaps = useMemo(() => (draft ? profileGaps(draft) : []), [draft]);
    const chosen = useMemo(() => buildings.filter(b => draft?.property_ids.includes(b.id)), [buildings, draft]);
    if (!draft) {
        return <div style={card}>ยังไม่มีโปรไฟล์ <button className="btn btn-primary btn-sm" onClick={startNew} style={{ alignSelf: 'flex-start' }}>สร้างโปรไฟล์ Mango</button></div>;
    }
    const d = draft;
    const upd = (patch: Partial<MangoProfile>) => setDraft({ ...d, ...patch });
    const codes = (patch: Partial<MangoProfile['codes']>) => upd({ codes: { ...d.codes, ...patch } });
    const opts = (patch: Partial<MangoProfile['options']>) => upd({ options: { ...d.options, ...patch } });
    const nullable = (v: string) => v.trim() || null;

    const save = async (status: 'draft' | 'approved') => {
        setBusy(true);
        try {
            await apiPost('accounting', { owner_uid: ownerUid, action: 'profile_save', profile_id: d.id, profile: { ...d, status } });
            toast.success(status === 'approved' ? 'อนุมัติโปรไฟล์แล้ว' : 'บันทึกฉบับร่างแล้ว');
            setSelected(d.id);
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'บันทึกไม่สำเร็จ');
        } finally { setBusy(false); }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={selected} onChange={e => setSelected(e.target.value)} style={{ ...input, width: 'auto' }} aria-label="โปรไฟล์">
                    {profiles.map(p => <option key={p.id} value={p.id}>{p.name || p.legal_entity_name}{p.status === 'draft' ? ' (ร่าง)' : ''}</option>)}
                    {selected === 'new' && <option value="new">โปรไฟล์ใหม่</option>}
                </select>
                <button className="btn btn-outline btn-sm" onClick={startNew} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Plus size={14} /> โปรไฟล์ใหม่</button>
                <span style={{ fontSize: '0.8rem' }}>สถานะ: <strong>{d.status === 'approved' ? 'อนุมัติแล้ว' : 'ฉบับร่าง'}</strong></span>
            </div>

            {gaps.length > 0 && (
                <div style={{ ...card, background: '#FEF3C7' }}>
                    <strong style={{ display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={15} /> ยังขาด {gaps.length} รายการก่อนอนุมัติ</strong>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem' }}>{gaps.map(g => <li key={g.code}>{g.message}</li>)}</ul>
                </div>
            )}

            <Section title="นิติบุคคลและสถานที่" hint="หนึ่งโปรไฟล์ = หนึ่งนิติบุคคล และหนึ่งสถานที่อยู่ได้ในโปรไฟล์เดียว">
                <div style={row}>
                    <label style={lab}>ชื่อโปรไฟล์<input style={input} value={d.name} onChange={e => upd({ name: e.target.value })} maxLength={80} /></label>
                    <label style={lab}>ชื่อนิติบุคคล<input style={input} value={d.legal_entity_name} onChange={e => upd({ legal_entity_name: e.target.value })} maxLength={120} /></label>
                    <label style={lab}>เวอร์ชัน template ของ Mango ที่ยืนยันแล้ว<input style={input} value={d.template_version} onChange={e => upd({ template_version: e.target.value })} maxLength={60} placeholder="เช่น ชื่อ/วันที่ไฟล์ที่ฝ่ายบัญชีรับรอง" /></label>
                </div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {buildings.map(b => (
                        <label key={b.id} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: '0.85rem' }}>
                            <input type="checkbox" checked={d.property_ids.includes(b.id)} onChange={e => upd({ property_ids: e.target.checked ? [...d.property_ids, b.id] : d.property_ids.filter(x => x !== b.id) })} /> {b.name}
                            {d.property_ids.includes(b.id) && buildings.length > 1 && (
                                <input style={{ ...input, width: 80 }} placeholder="รหัสย่อ" maxLength={12} value={d.property_codes[b.id] ?? ''} onChange={e => upd({ property_codes: { ...d.property_codes, [b.id]: e.target.value } })} />
                            )}
                        </label>
                    ))}
                </div>
            </Section>

            <Section title="รหัสบัญชีหลัก" hint="ใส่เฉพาะที่ฝ่ายบัญชียืนยัน ช่องที่ Mango กรอกเองให้เว้นว่าง — ระบบไม่เติมค่าจากไฟล์ตัวอย่าง">
                <div style={row}>
                    <label style={lab}>บัญชีลูกหนี้ *<input style={input} value={d.codes.ar_account} onChange={e => codes({ ar_account: e.target.value })} maxLength={40} /></label>
                    <label style={lab}>Project Code<input style={input} value={d.codes.project ?? ''} onChange={e => codes({ project: nullable(e.target.value) })} maxLength={40} /></label>
                    <label style={lab}>Job Code<input style={input} value={d.codes.job ?? ''} onChange={e => codes({ job: nullable(e.target.value) })} maxLength={40} /></label>
                    <label style={lab}>Department Code<input style={input} value={d.codes.department ?? ''} onChange={e => codes({ department: nullable(e.target.value) })} maxLength={40} /></label>
                    <label style={lab}>Cost Code<input style={input} value={d.codes.cost_code ?? ''} onChange={e => codes({ cost_code: nullable(e.target.value) })} maxLength={40} /></label>
                    <label style={lab}>Book (ว่าง = Mango กรอก)<input style={input} value={d.codes.book ?? ''} onChange={e => codes({ book: nullable(e.target.value) })} maxLength={40} /></label>
                    <label style={lab}>PU Cost Y/N (ว่าง = Mango กรอก)<input style={input} value={d.codes.pu_cost_yn ?? ''} onChange={e => codes({ pu_cost_yn: nullable(e.target.value) })} maxLength={40} /></label>
                    <label style={lab}>AC Type (ว่าง = Mango กรอก)<input style={input} value={d.codes.ac_type ?? ''} onChange={e => codes({ ac_type: nullable(e.target.value) })} maxLength={40} /></label>
                    <label style={lab}>Data Type (ว่าง = Mango กรอก)<input style={input} value={d.codes.data_type ?? ''} onChange={e => codes({ data_type: nullable(e.target.value) })} maxLength={40} /></label>
                    <label style={lab}>Remark 1 — ตั้งลูกหนี้<input style={input} value={d.remarks.invoice} onChange={e => upd({ remarks: { ...d.remarks, invoice: e.target.value } })} maxLength={100} /></label>
                    <label style={lab}>Remark 1 — ตัดลูกหนี้<input style={input} value={d.remarks.receipt} onChange={e => upd({ remarks: { ...d.remarks, receipt: e.target.value } })} maxLength={100} /></label>
                </div>
            </Section>

            <Section title="บัญชีรายได้ตามหมวด" hint="หมวดที่ใช้ในบิลทุกหมวดต้องมีบัญชี ไม่เช่นนั้นเอกสารจะถูกบล็อก">
                <div style={row}>
                    {REVENUE_CATEGORIES.map(c => (
                        <label key={c} style={lab}>{REVENUE_CATEGORY_LABELS_TH[c]}
                            <input style={input} value={d.revenue_accounts[c] ?? ''} onChange={e => upd({ revenue_accounts: { ...d.revenue_accounts, [c]: e.target.value } })} maxLength={40} />
                        </label>
                    ))}
                </div>
            </Section>

            <Section title="ช่องทางรับเงิน → บัญชีรับเงิน" hint="เงินสดและแต่ละบัญชีธนาคารแยกกัน (แสดงตามบัญชีของสถานที่แรกที่เลือก)">
                {chosen[0] ? <ChannelRows ownerUid={ownerUid} buildingId={chosen[0].id} profile={d} setProfile={setDraft} /> : <span style={{ fontSize: '0.85rem' }}>เลือกสถานที่ก่อน</span>}
            </Section>

            <Section title="Customer Code ของแต่ละแผง/ห้อง" hint="รหัสลูกค้าใน Mango — ไม่ใช้เลขห้องหรือชื่อแทนรหัส ถ้าไม่ใส่ เอกสารของห้องนั้นจะถูกบล็อก">
                {chosen.length === 0 ? <span style={{ fontSize: '0.85rem' }}>เลือกสถานที่ก่อน</span> : chosen.map(b => <CustomerCodes key={b.id} ownerUid={ownerUid} building={b} profile={d} setProfile={setDraft} />)}
            </Section>

            <Section title="ตัวเลือกการส่งออก" hint="ค่าที่ตัวอย่างไฟล์ยังไม่ตอบ — ให้ฝ่ายบัญชีเลือกตามที่ Mango รับ">
                <div style={row}>
                    <label style={lab}>วันที่ตั้งลูกหนี้
                        <select style={input} value={d.options.invoice_date_basis} onChange={e => opts({ invoice_date_basis: e.target.value as MangoProfile['options']['invoice_date_basis'] })}>
                            <option value="issued_at">วันที่ออกบิล</option><option value="month_end">สิ้นเดือนของงวดบิล</option>
                        </select></label>
                    <label style={lab}>รูปแบบวันที่ในไฟล์
                        <select style={input} value={d.options.date_format} onChange={e => opts({ date_format: e.target.value as MangoProfile['options']['date_format'] })}>
                            <option value="dd/mm/yyyy">05/10/2026</option><option value="dd/mm/yyyy_be">05/10/2569 (พ.ศ.)</option><option value="yyyy-mm-dd">2026-10-05</option>
                        </select></label>
                    <label style={lab}>บิลก่อนเดือนนี้มีใน Mango แล้ว (ยกยอด)<input style={input} placeholder="YYYY-MM เช่น 2026-10" value={d.options.opening_cutoff_month ?? ''} onChange={e => opts({ opening_cutoff_month: e.target.value.trim() || null })} /></label>
                </div>
                {([
                    ['header_on_every_line', 'ใส่ข้อมูลหัวเอกสาร (เลขที่ วันที่ Remark) ซ้ำทุกบรรทัด'],
                    ['customer_code_all_lines', 'ใส่ Customer Code ทุกบรรทัด (ไม่เลือก = เฉพาะบรรทัดลูกหนี้)'],
                    ['voucher_no_from_horcare', 'ใช้เลขเอกสารของ HorCare เป็น Voucher no. (ไม่เลือก = ให้ Mango ออกเลข)'],
                    ['count_unverified_transfers', 'นับเงินโอนที่ยังไม่ยืนยันกับบัญชีธนาคารเป็นเงินรับ (ไม่แนะนำ)'],
                ] as const).map(([k, text]) => (
                    <label key={k} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem' }}>
                        <input type="checkbox" checked={d.options[k]} onChange={e => opts({ [k]: e.target.checked })} /> {text}
                    </label>
                ))}
            </Section>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => void save('draft')} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    {busy ? <Loader2 size={14} className="spin" /> : <Save size={14} />} บันทึกฉบับร่าง
                </button>
                <button className="btn btn-primary btn-sm" disabled={busy || gaps.length > 0} onClick={() => { if (window.confirm('ยืนยันว่าฝ่ายบัญชีตรวจสอบรหัสทั้งหมดแล้ว และอนุมัติให้ใช้ส่งออก?')) void save('approved'); }}>
                    อนุมัติให้ใช้ส่งออก
                </button>
            </div>
        </div>
    );
}
