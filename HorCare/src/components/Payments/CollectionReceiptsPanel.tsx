import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, Clock, Landmark, Loader2, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost } from '../../utils/api';
import { useLiveRefresh } from '../../hooks/useLiveRefresh';
import { collectionsError } from '../../hooks/useCollections';
import { CHARGE_KIND_LABELS_TH, type ChargeKind } from '../../shared/collections';
import type { BankAccount } from '../../shared/banks';
import { autoPostNote, type AutoPostOutcome } from '../../shared/autoPostNote';

interface Receipt {
    id: string; charge_id: string; amount_satang: number; method: 'cash' | 'transfer'; kind: 'payment' | 'deposit' | 'refund';
    received_at: string; received_by_name: string; bank_account_id: string | null; note: string | null; has_slip: boolean;
    verification: 'n/a' | 'unverified' | 'verified' | 'rejected';
    room_number: string | null; party_name: string; charge_kind: ChargeKind; description: string;
}
interface Listing { month: string; can_verify: boolean; receipts: Receipt[] }

const baht = (s: number) => `฿${(s / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const signed = (r: Receipt) => (r.kind === 'refund' ? -r.amount_satang : r.amount_satang);

/**
 * Money taken on site in the month — POS Care, the stall round, the front desk (charges, not monthly bills). The list
 * refreshes by itself, so a payment taken on a collector's phone shows here within seconds. A transfer waits for
 * "ยืนยันเงินเข้า" from someone who checks the bank account; that is also when its receipt goes into the ledger.
 * Renders nothing for a property that takes no such money.
 */
export default function CollectionReceiptsPanel({ ownerUid, buildingId, month, accounts }: { ownerUid: string; buildingId: string; month: string; accounts: BankAccount[] }) {
    const [data, setData] = useState<Listing | null>(null);
    const [working, setWorking] = useState<string | null>(null);
    const [open, setOpen] = useState(true);

    const load = useCallback(async () => {
        try {
            setData(await apiPost<Listing>('collections', { owner_uid: ownerUid, building_id: buildingId, action: 'receipts', month }));
        } catch { /* no collections module / no permission: the panel simply stays hidden */ }
    }, [ownerUid, buildingId, month]);
    useEffect(() => { void load(); }, [load]);
    useLiveRefresh(() => { void load(); });

    const bankOf = useMemo(() => new Map(accounts.map(a => [a.id, a])), [accounts]);
    // an answer for another month (the month was just changed) is not shown
    const rows = useMemo(() => (data?.month === month ? data.receipts : []), [data, month]);
    const totals = useMemo(() => {
        let cash = 0, transfer = 0, waiting = 0;
        for (const r of rows) {
            if (r.verification === 'rejected') continue;
            if (r.method === 'cash') cash += signed(r); else transfer += signed(r);
            if (r.method === 'transfer' && r.verification === 'unverified') waiting += signed(r);
        }
        return { cash, transfer, waiting };
    }, [rows]);

    const verify = async (r: Receipt) => {
        setWorking(r.id);
        try {
            const res = await apiPost<{ posted?: AutoPostOutcome }>('collections', { owner_uid: ownerUid, building_id: buildingId, action: 'payment_verify', payment_id: r.id });
            const note = autoPostNote(res.posted);
            if (note) toast(`ยืนยันเงินเข้าแล้ว — ${note}`, { icon: '⚠️', duration: 7000 });
            else toast.success(`ยืนยันเงินเข้า ${baht(r.amount_satang)} แล้ว`);
            await load();
        } catch (e) { toast.error(collectionsError(e)); } finally { setWorking(null); }
    };

    if (rows.length === 0) return null;
    const waitingCount = rows.filter(r => r.method === 'transfer' && r.verification === 'unverified').length;

    return (
        <section className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.125rem' }} aria-label="รับเงินหน้างาน">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Smartphone size={18} aria-hidden />
                <strong style={{ fontSize: '0.95rem' }}>รับเงินหน้างาน (POS Care / เดินเก็บ / เคาน์เตอร์)</strong>
                <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>อัปเดตอัตโนมัติ</span>
                <span style={{ flex: 1 }} />
                <button type="button" className="btn btn-outline btn-sm" onClick={() => void load()} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><RefreshCw size={13} aria-hidden /> โหลดใหม่</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)} aria-expanded={open}>{open ? 'ย่อ' : `ดู ${rows.length} รายการ`}</button>
            </div>
            <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', margin: '0.625rem 0', fontSize: '0.875rem' }}>
                <span><Banknote size={14} aria-hidden style={{ verticalAlign: 'text-bottom' }} /> เงินสด <strong>{baht(totals.cash)}</strong></span>
                <span><Landmark size={14} aria-hidden style={{ verticalAlign: 'text-bottom' }} /> โอน <strong>{baht(totals.transfer)}</strong></span>
                <span>รวม <strong>{baht(totals.cash + totals.transfer)}</strong></span>
                {totals.waiting > 0 && (
                    <span style={{ color: '#B45309' }}>
                        <Clock size={14} aria-hidden style={{ verticalAlign: 'text-bottom' }} /> โอนรอยืนยันเงินเข้า <strong>{baht(totals.waiting)}</strong> ({waitingCount} รายการ) — ยังไม่ลงสมุดบัญชี
                    </span>
                )}
            </div>
            {open && (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ textAlign: 'left', color: 'var(--color-gray-500)' }}>
                                <th style={{ padding: '0.375rem 0.5rem' }}>เวลา</th><th style={{ padding: '0.375rem 0.5rem' }}>รายการ</th><th style={{ padding: '0.375rem 0.5rem' }}>ช่องทาง</th>
                                <th style={{ padding: '0.375rem 0.5rem', textAlign: 'right' }}>จำนวน</th><th style={{ padding: '0.375rem 0.5rem' }}>ผู้รับเงิน</th><th style={{ padding: '0.375rem 0.5rem' }}>สถานะ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => {
                                const bank = r.bank_account_id ? bankOf.get(r.bank_account_id) : undefined;
                                const cell = { padding: '0.375rem 0.5rem', borderTop: '1px solid var(--color-gray-100)' } as const;
                                return (
                                    <tr key={r.id}>
                                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>{when(r.received_at)}</td>
                                        <td style={cell}>
                                            {r.room_number ? `${r.room_number} · ` : ''}{CHARGE_KIND_LABELS_TH[r.charge_kind] ?? 'ค่าบริการ'}{r.party_name ? ` · ${r.party_name}` : ''}
                                            {r.kind === 'refund' ? ' (คืนเงิน)' : r.kind === 'deposit' ? ' (มัดจำ)' : ''}
                                        </td>
                                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                                            {r.method === 'cash' ? 'เงินสด' : `โอน${bank ? ` · ${bank.bank_short ?? ''} ${bank.account_number?.slice(-4) ?? ''}` : ''}${r.has_slip ? ' · มีสลิป' : ''}`}
                                        </td>
                                        <td style={{ ...cell, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.kind === 'refund' ? '-' : ''}{baht(r.amount_satang)}</td>
                                        <td style={cell}>{r.received_by_name}</td>
                                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                                            {r.method === 'cash' || r.verification === 'verified' ? (
                                                <span style={{ color: '#15803D', display: 'inline-flex', gap: 4, alignItems: 'center' }}><CheckCircle2 size={14} aria-hidden /> {r.method === 'cash' ? 'รับแล้ว' : 'เงินเข้าแล้ว'}</span>
                                            ) : r.verification === 'rejected' ? (
                                                <span style={{ color: '#B91C1C' }}>ไม่ผ่าน</span>
                                            ) : data?.can_verify ? (
                                                <button type="button" className="btn btn-primary btn-sm" disabled={!!working} onClick={() => void verify(r)} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                                                    {working === r.id ? <Loader2 size={13} className="spin" aria-hidden /> : <ShieldCheck size={13} aria-hidden />} ยืนยันเงินเข้า
                                                </button>
                                            ) : (
                                                <span style={{ color: '#B45309', display: 'inline-flex', gap: 4, alignItems: 'center' }}><Clock size={14} aria-hidden /> รอยืนยันเงินเข้า</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
