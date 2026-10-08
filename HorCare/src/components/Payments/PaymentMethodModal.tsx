import { useState } from 'react';
import { X, Banknote, Landmark, QrCode, MoreHorizontal, Check, Loader2 } from 'lucide-react';
import type { PaymentMethod, PaymentVerification } from '../../types';
import { bankAccountLabel, maskAccountNumber, type BankAccount } from '../../shared/banks';
import BankLogo from './BankLogo';
import {
    PAYMENT_METHODS, PAYMENT_METHOD_LABELS, VERIFICATION_LABELS, compactFields,
    type PaymentRecordFields,
} from '../../utils/paymentMethods';

const ICONS: Record<PaymentMethod, React.ElementType> = {
    cash: Banknote, bank_transfer: Landmark, qr_gateway: QrCode, other: MoreHorizontal,
};

interface PaymentMethodModalProps {
    /** Room labels shown in the header (one for a single payment, many for bulk). */
    labels: string[];
    /** Present for a single payment: pre-fills and validates the amount. Omit for bulk. */
    amount?: number;
    defaultMethod?: PaymentMethod;
    defaultReference?: string;
    receiverName: string;
    /** Active receiving accounts to choose from for bank transfers. */
    accounts?: BankAccount[];
    /** Preselect this account (e.g. the one the slip was matched to). */
    defaultAccountId?: string;
    onConfirm: (fields: PaymentRecordFields) => Promise<void>;
    onClose: () => void;
}

function toLocalInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PaymentMethodModal({
    labels, amount, defaultMethod = 'cash', defaultReference = '', receiverName, accounts = [], defaultAccountId, onConfirm, onClose,
}: PaymentMethodModalProps) {
    const isBulk = amount === undefined;
    const [method, setMethod] = useState<PaymentMethod>(defaultMethod);
    const [paidAmount, setPaidAmount] = useState(amount !== undefined ? String(amount) : '');
    const [when, setWhen] = useState(toLocalInput(new Date()));
    const [receivedBy, setReceivedBy] = useState(receiverName);
    const [bankAccount, setBankAccount] = useState('');
    // '' = "another account" typed by hand. Defaults: the slip's matched account, else the default account.
    const [accountId, setAccountId] = useState<string>(() => {
        const preferred = accounts.find(a => a.id === defaultAccountId) ?? accounts.find(a => a.is_default) ?? accounts[0];
        return preferred?.id ?? '';
    });
    const selectedAccount = accounts.find(a => a.id === accountId);
    const [reference, setReference] = useState(defaultReference);
    const [verification, setVerification] = useState<PaymentVerification>('unverified');
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);

    const amountNum = Number(paidAmount);
    const amountOk = isBulk || (paidAmount !== '' && Number.isFinite(amountNum) && amountNum > 0);
    const receiverOk = method !== 'cash' || receivedBy.trim().length > 0;
    const canSubmit = !saving && amountOk && receiverOk && when !== '';

    const submit = async () => {
        if (!canSubmit) return;
        setSaving(true);
        try {
            const iso = new Date(when).toISOString();
            const fields: PaymentRecordFields = compactFields({
                payment_method: method,
                paid_at: iso,
                paid_method: 'manual' as const,
                paid_amount: isBulk ? undefined : amountNum,
                received_by: method === 'cash' || method === 'other' ? receivedBy.trim() : undefined,
                bank_account: method === 'bank_transfer' ? (selectedAccount ? bankAccountLabel(selectedAccount) : bankAccount.trim()) : undefined,
                bank_account_id: method === 'bank_transfer' ? selectedAccount?.id : undefined,
                transaction_ref: method === 'bank_transfer' || method === 'qr_gateway' ? reference.trim() : undefined,
                verification_status: method === 'bank_transfer' ? verification : undefined,
                payment_note: note.trim(),
            });
            await onConfirm(fields);
        } finally {
            setSaving(false);
        }
    };

    const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 };

    return (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
            <div className="modal" style={{ maxWidth: 480 }} role="dialog" aria-modal="true" aria-label="บันทึกการชำระเงิน">
                <div className="modal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div className="modal-title">บันทึกการชำระเงิน</div>
                        <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)', marginTop: 2 }}>
                            {labels.length === 1 ? labels[0] : `${labels.length} รายการ`}
                        </div>
                    </div>
                    <button className="btn-icon" onClick={onClose} disabled={saving} aria-label="ปิด"><X size={18} /></button>
                </div>

                <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div role="radiogroup" aria-label="วิธีชำระเงิน" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
                        {PAYMENT_METHODS.map(m => {
                            const Icon = ICONS[m];
                            const on = method === m;
                            return (
                                <button
                                    key={m} type="button" role="radio" aria-checked={on} onClick={() => setMethod(m)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.625rem 0.75rem',
                                        borderRadius: 10, cursor: 'pointer', fontSize: '0.875rem', fontWeight: on ? 700 : 500, textAlign: 'left',
                                        border: `1.5px solid ${on ? '#6366F1' : 'var(--color-gray-200)'}`,
                                        background: on ? 'rgba(99,102,241,0.08)' : 'transparent',
                                        color: on ? '#4F46E5' : 'var(--color-gray-700)',
                                    }}
                                >
                                    <Icon size={18} /> {PAYMENT_METHOD_LABELS[m]}
                                </button>
                            );
                        })}
                    </div>

                    {!isBulk && (
                        <label style={field}>
                            <span className="form-label">จำนวนเงินที่ได้รับ (฿)</span>
                            <input className="form-input mono" inputMode="decimal" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} />
                            {!amountOk && <span style={{ color: '#DC2626', fontSize: '0.75rem' }}>กรอกจำนวนเงินมากกว่า 0</span>}
                            {amountOk && amount !== undefined && amountNum !== amount && (
                                <span style={{ color: '#D97706', fontSize: '0.75rem' }}>ไม่ตรงกับยอดบิล ฿{amount.toLocaleString()}</span>
                            )}
                        </label>
                    )}
                    {isBulk && (
                        <p style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)', margin: 0 }}>
                            จำนวนเงินของแต่ละรายการจะบันทึกตามยอดบิลของรายการนั้น
                        </p>
                    )}

                    <label style={field}>
                        <span className="form-label">{method === 'cash' ? 'วันเวลาที่รับเงิน' : 'วันเวลาที่ชำระ'}</span>
                        <input className="form-input" type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} />
                    </label>

                    {(method === 'cash' || method === 'other') && (
                        <label style={field}>
                            <span className="form-label">ผู้รับเงิน{method === 'cash' ? ' *' : ''}</span>
                            <input className="form-input" value={receivedBy} onChange={e => setReceivedBy(e.target.value)} />
                        </label>
                    )}

                    {method === 'bank_transfer' && (
                        <>
                            <div style={field}>
                                <span className="form-label">บัญชีที่รับเงิน</span>
                                {accounts.length > 0 && (
                                    <div role="radiogroup" aria-label="บัญชีที่รับเงิน" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {accounts.map(a => {
                                            const on = accountId === a.id;
                                            return (
                                                <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => setAccountId(a.id)}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 10, padding: '0.5rem 0.625rem', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                                                        border: `1.5px solid ${on ? '#6366F1' : 'var(--color-gray-200)'}`, background: on ? 'rgba(99,102,241,0.08)' : 'transparent',
                                                        color: 'var(--color-gray-800)',
                                                    }}>
                                                    <BankLogo short={a.bank_short} size={30} />
                                                    <span style={{ minWidth: 0 }}>
                                                        <span style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem' }}>{a.nickname || a.bank_short} · {a.account_name}</span>
                                                        <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>{maskAccountNumber(a.account_number)}</span>
                                                    </span>
                                                </button>
                                            );
                                        })}
                                        <button type="button" role="radio" aria-checked={accountId === ''} onClick={() => setAccountId('')}
                                            style={{
                                                padding: '0.4rem 0.625rem', borderRadius: 10, cursor: 'pointer', textAlign: 'left', fontSize: '0.8125rem',
                                                border: `1.5px solid ${accountId === '' ? '#6366F1' : 'var(--color-gray-200)'}`, background: accountId === '' ? 'rgba(99,102,241,0.08)' : 'transparent',
                                                color: 'var(--color-gray-700)',
                                            }}>บัญชีอื่น (พิมพ์เอง)</button>
                                    </div>
                                )}
                                {(accounts.length === 0 || accountId === '') && (
                                    <input className="form-input" placeholder="เช่น กสิกร xxx-x-x1234-x" value={bankAccount} onChange={e => setBankAccount(e.target.value)} />
                                )}
                                {accounts.length === 0 && (
                                    <span style={{ fontSize: '0.72rem', color: 'var(--color-gray-500)' }}>เพิ่มบัญชีรับเงินได้ที่ปุ่ม "บัญชีรับเงิน" ในหน้านี้ เพื่อเลือกบัญชีและตรวจสลิปอัตโนมัติ</span>
                                )}
                            </div>
                            <label style={field}>
                                <span className="form-label">เลขที่อ้างอิงรายการ</span>
                                <input className="form-input mono" value={reference} onChange={e => setReference(e.target.value)} />
                            </label>
                            <label style={field}>
                                <span className="form-label">สถานะการตรวจสอบ</span>
                                <select className="form-input" value={verification} onChange={e => setVerification(e.target.value as PaymentVerification)}>
                                    {(Object.keys(VERIFICATION_LABELS) as PaymentVerification[]).map(v => (
                                        <option key={v} value={v}>{VERIFICATION_LABELS[v]}</option>
                                    ))}
                                </select>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>
                                    สลิปอย่างเดียวไม่ถือว่ายืนยันกับบัญชี — เลือก "ยืนยันแล้ว" เมื่อเห็นเงินเข้าบัญชีจริง
                                </span>
                            </label>
                        </>
                    )}

                    {method === 'qr_gateway' && (
                        <label style={field}>
                            <span className="form-label">เลขที่อ้างอิง</span>
                            <input className="form-input mono" value={reference} onChange={e => setReference(e.target.value)} />
                        </label>
                    )}

                    <label style={field}>
                        <span className="form-label">หมายเหตุ</span>
                        <input className="form-input" value={note} onChange={e => setNote(e.target.value)} />
                    </label>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-outline" onClick={onClose} disabled={saving}>ยกเลิก</button>
                    <button className="btn btn-success" onClick={submit} disabled={!canSubmit}>
                        {saving ? <Loader2 size={16} className="spin" /> : <Check size={16} />} ยืนยันการชำระเงิน
                    </button>
                </div>
            </div>
        </div>
    );
}
