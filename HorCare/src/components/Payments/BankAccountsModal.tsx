import { useMemo, useState } from 'react';
import { X, Plus, Loader2, Star, Eye, EyeOff, Pencil, Landmark, Power } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import {
    BANKS, bankByCode, isValidAccountNumber, maskAccountNumber, type BankAccount,
} from '../../shared/banks';
import { cleanPromptPayId, maskPromptPayId } from '../../shared/thaiQr';
import BankLogo from './BankLogo';

interface Props {
    ownerUid: string;
    buildingId: string;
    accounts: BankAccount[];
    loading: boolean;
    /** Owner / property manager. Others only see the list. */
    canManage: boolean;
    /** PromptPay number the property used to keep in Settings; offered once so it can be moved onto an account. */
    legacyPromptPay?: string | null;
    onClose: () => void;
}

const ERRORS: Record<string, string> = {
    duplicate_account: 'มีบัญชีนี้อยู่แล้ว',
    invalid_input: 'ข้อมูลไม่ถูกต้อง ตรวจสอบธนาคาร ชื่อบัญชี และเลขบัญชี (10–15 หลัก)',
    invalid_promptpay: 'เลข PromptPay ไม่ถูกต้อง ต้องเป็นเบอร์โทร 10 หลัก (ขึ้นต้นด้วย 0) หรือเลขบัตรประชาชน/เลขผู้เสียภาษี 13 หลัก',
    forbidden: 'คุณไม่มีสิทธิ์จัดการบัญชีรับเงิน',
    unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
    account_inactive: 'บัญชีที่ปิดใช้งานตั้งเป็นบัญชีหลักไม่ได้',
};

interface FormState { bank_code: string; account_name: string; account_number: string; nickname: string; promptpay_id: string }
const EMPTY: FormState = { bank_code: '', account_name: '', account_number: '', nickname: '', promptpay_id: '' };

export default function BankAccountsModal({ ownerUid, buildingId, accounts, loading, canManage, legacyPromptPay: legacyRaw, onClose }: Props) {
    const legacyPromptPay = legacyRaw ? cleanPromptPayId(legacyRaw) : null;
    const [form, setForm] = useState<FormState>(EMPTY);
    const [editingId, setEditingId] = useState<string | null>(null);   // null + showForm = adding
    const [showForm, setShowForm] = useState(false);
    const [search, setSearch] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [revealed, setRevealed] = useState<Set<string>>(new Set());

    const banks = useMemo(() => {
        const q = search.trim().toLowerCase();
        return q ? BANKS.filter(b => `${b.short} ${b.name_th}`.toLowerCase().includes(q)) : BANKS;
    }, [search]);

    const call = async (key: string, body: Record<string, unknown>, ok?: string): Promise<boolean> => {
        setBusy(key);
        setError(null);
        try {
            await apiPost('bank-accounts', { owner_uid: ownerUid, building_id: buildingId, ...body });
            if (ok) toast.success(ok);
            return true;
        } catch (e) {
            const err = e as ApiError;
            setError(ERRORS[err.code] ?? err.message ?? 'ดำเนินการไม่สำเร็จ');
            return false;
        } finally {
            setBusy(null);
        }
    };

    const openAdd = () => { setForm(EMPTY); setEditingId(null); setShowForm(true); setError(null); };
    const openEdit = (a: BankAccount) => {
        setForm({ bank_code: a.bank_code, account_name: a.account_name, account_number: a.account_number, nickname: a.nickname ?? '', promptpay_id: a.promptpay_id ?? '' });
        setEditingId(a.id); setShowForm(true); setError(null);
    };

    const numberOk = isValidAccountNumber(form.account_number);
    const promptpayOk = form.promptpay_id.trim() === '' || cleanPromptPayId(form.promptpay_id) !== null;
    const canSubmit = !busy && !!bankByCode(form.bank_code) && form.account_name.trim().length >= 2 && numberOk && promptpayOk;

    const submit = async () => {
        if (!canSubmit) return;
        const payload = { bank_code: form.bank_code, account_name: form.account_name.trim(), account_number: form.account_number, nickname: form.nickname.trim(), promptpay_id: form.promptpay_id.trim() };
        const ok = editingId
            ? await call('save', { action: 'update', account_id: editingId, ...payload }, 'บันทึกบัญชีแล้ว')
            : await call('save', { action: 'create', ...payload }, 'เพิ่มบัญชีแล้ว');
        if (ok) { setShowForm(false); setEditingId(null); }
    };

    const toggleReveal = (id: string) => setRevealed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div className="modal" style={{ maxWidth: 600 }} role="dialog" aria-modal="true" aria-label="บัญชีรับเงิน">
                <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="modal-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Landmark size={20} /> บัญชีรับเงิน</span>
                    <button className="btn-icon" onClick={onClose} aria-label="ปิด"><X size={18} /></button>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-gray-600)' }}>
                        เมื่อลูกบ้านส่งสลิป ระบบจะอ่านยอด ชื่อผู้รับ เลขบัญชี และวันเวลาจากสลิป แล้วเทียบกับบัญชีเหล่านี้
                        (รวมถึงเลข PromptPay ของบัญชี) การอนุมัติอัตโนมัติจากสลิปยังไม่ใช่การยืนยันกับบัญชีธนาคารจริง ส่วน QR ที่ลูกบ้านสแกนจ่ายสร้างจากบัญชีหลักนี้
                    </p>

                    {loading ? (
                        <div style={{ padding: '1.5rem', textAlign: 'center' }}><Loader2 size={22} className="spin" /></div>
                    ) : accounts.length === 0 && !showForm ? (
                        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--color-gray-500)' }}>
                            <Landmark size={32} style={{ opacity: 0.4, margin: '0 auto 6px' }} />
                            ยังไม่มีบัญชีรับเงิน
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {accounts.map(a => {
                                const bank = bankByCode(a.bank_code);
                                const shown = revealed.has(a.id);
                                return (
                                    <div key={a.id} className="card" style={{ padding: '0.625rem 0.75rem', opacity: a.status === 'active' ? 1 : 0.55 }}>
                                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                            <BankLogo short={a.bank_short} size={38} />
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <b>{bank?.name_th ?? a.bank_short}</b>
                                                    {a.is_default && <span title="บัญชีหลัก" style={{ fontSize: '0.68rem', fontWeight: 800, color: '#B45309', display: 'inline-flex', gap: 2, alignItems: 'center' }}><Star size={11} fill="currentColor" /> หลัก</span>}
                                                    {a.status !== 'active' && <span style={{ fontSize: '0.68rem', color: '#6B7280', fontWeight: 700 }}>ปิดใช้งาน</span>}
                                                </div>
                                                <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-600)' }}>
                                                    {a.account_name}{a.nickname ? ` · ${a.nickname}` : ''}{a.promptpay_id ? ` · PromptPay ${maskPromptPayId(a.promptpay_id)}` : ''}
                                                </div>
                                                <div className="mono" style={{ fontSize: '0.8125rem' }}>
                                                    {shown ? a.account_number.replace(/^(\d{3})(\d)(\d{5})(\d+)$/, '$1-$2-$3-$4') : maskAccountNumber(a.account_number)}
                                                </div>
                                            </div>
                                            <button className="btn-icon" onClick={() => toggleReveal(a.id)} aria-label={shown ? 'ซ่อนเลขบัญชี' : 'แสดงเลขบัญชี'}>
                                                {shown ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        </div>
                                        {canManage && (
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                                                <button className="btn btn-outline btn-sm" onClick={() => openEdit(a)}><Pencil size={13} /> แก้ไข</button>
                                                {a.status === 'active' && !a.is_default && (
                                                    <button className="btn btn-outline btn-sm" disabled={busy === `d-${a.id}`}
                                                        onClick={() => void call(`d-${a.id}`, { action: 'set_default', account_id: a.id }, 'ตั้งเป็นบัญชีหลักแล้ว')}>
                                                        <Star size={13} /> ตั้งเป็นบัญชีหลัก
                                                    </button>
                                                )}
                                                <button className="btn btn-outline btn-sm" disabled={busy === `s-${a.id}`}
                                                    onClick={() => void call(`s-${a.id}`, { action: 'update', account_id: a.id, status: a.status === 'active' ? 'inactive' : 'active' }, a.status === 'active' ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว')}>
                                                    <Power size={13} /> {a.status === 'active' ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {canManage && !showForm && (
                        <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={openAdd}><Plus size={16} /> เพิ่มบัญชี</button>
                    )}

                    {canManage && showForm && (
                        <div className="card" style={{ padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ fontWeight: 700 }}>{editingId ? 'แก้ไขบัญชี' : 'เพิ่มบัญชีรับเงิน'}</div>

                            <div style={field}>
                                <span className="form-label">ธนาคาร *</span>
                                <input className="form-input" placeholder="ค้นหาธนาคาร" value={search} onChange={e => setSearch(e.target.value)} />
                                <div role="listbox" aria-label="เลือกธนาคาร" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6, maxHeight: 190, overflowY: 'auto', padding: 2 }}>
                                    {banks.map(b => {
                                        const on = form.bank_code === b.code;
                                        return (
                                            <button key={b.code} type="button" role="option" aria-selected={on} onClick={() => setForm(f => ({ ...f, bank_code: b.code }))}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 8, padding: '0.4rem 0.5rem', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                                                    border: `1.5px solid ${on ? '#6366F1' : 'var(--color-gray-200)'}`, background: on ? 'rgba(99,102,241,0.08)' : 'transparent',
                                                    color: 'var(--color-gray-800)', fontSize: '0.78rem', fontWeight: on ? 700 : 500,
                                                }}>
                                                <BankLogo short={b.short} size={26} />
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name_th.replace('ธนาคาร', '')}</span>
                                            </button>
                                        );
                                    })}
                                    {banks.length === 0 && <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)' }}>ไม่พบธนาคาร</span>}
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                                <label style={field}><span className="form-label">ชื่อบัญชี * (ตามสมุดบัญชี)</span>
                                    <input className="form-input" maxLength={100} value={form.account_name} onChange={e => setForm(f => ({ ...f, account_name: e.target.value }))} /></label>
                                <label style={field}><span className="form-label">เลขบัญชี *</span>
                                    <input className="form-input mono" inputMode="numeric" maxLength={20} value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))} />
                                    {form.account_number !== '' && !numberOk && <span style={{ color: '#DC2626', fontSize: '0.72rem' }}>เลขบัญชีต้องมี 10–15 หลัก</span>}</label>
                                <label style={field}><span className="form-label">เลข PromptPay — เบอร์โทร หรือ เลขบัตรประชาชน (ไม่บังคับ)</span>
                                    <input className="form-input mono" inputMode="numeric" maxLength={17} placeholder="เช่น 0812345678" value={form.promptpay_id} onChange={e => setForm(f => ({ ...f, promptpay_id: e.target.value }))} />
                                    {legacyPromptPay && form.promptpay_id.trim() === '' && (
                                        <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setForm(f => ({ ...f, promptpay_id: legacyPromptPay }))}>ใช้ PromptPay เดิมจากการตั้งค่า</button>
                                    )}
                                    {!promptpayOk && <span style={{ color: '#DC2626', fontSize: '0.72rem' }}>ต้องเป็นเบอร์โทร 10 หลัก (ขึ้นต้นด้วย 0) หรือเลข 13 หลัก</span>}</label>
                                <label style={field}><span className="form-label">ชื่อเรียก (ไม่บังคับ)</span>
                                    <input className="form-input" maxLength={40} placeholder="เช่น บัญชีค่าเช่า" value={form.nickname} onChange={e => setForm(f => ({ ...f, nickname: e.target.value }))} /></label>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--color-gray-500)' }}>
                                ใส่ชื่อให้ตรงกับที่ปรากฏบนสลิปโอนเงิน ระบบใช้เทียบชื่อผู้รับ (สลิปมักแสดงชื่อแบบย่อ ซึ่งรองรับ) ถ้าใส่เลข PromptPay ลูกบ้านจะสแกน QR PromptPay ซึ่งแอปธนาคารรองรับทุกแห่ง ถ้าไม่ใส่จะสร้าง QR จากเลขบัญชี (ยังไม่ได้ทดสอบกับทุกแอปธนาคาร)
                            </p>

                            {error && <div role="alert" style={{ color: '#DC2626', fontSize: '0.8125rem' }}>{error}</div>}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
                                    {busy === 'save' ? <Loader2 size={16} className="spin" /> : null} {editingId ? 'บันทึก' : 'เพิ่มบัญชี'}
                                </button>
                                <button className="btn btn-outline" onClick={() => { setShowForm(false); setEditingId(null); }}>ยกเลิก</button>
                            </div>
                        </div>
                    )}
                    {!showForm && error && <div role="alert" style={{ color: '#DC2626', fontSize: '0.8125rem' }}>{error}</div>}
                </div>

                <div className="modal-footer"><button className="btn btn-outline" onClick={onClose}>ปิด</button></div>
            </div>
        </div>
    );
}
