import { useMemo, useState } from 'react';
import { CalendarCheck, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { fromSatang } from '../../shared/accounting';
import { closingLines, todayThDate, type JournalEntry, type Ledger } from '../../shared/ledger';

interface Props { ownerUid: string; ledger: Ledger; entries: JournalEntry[] }

const baht = (s: number) => fromSatang(s).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.875rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: '0.625rem' };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #C3D0DE)', borderRadius: 8, font: 'inherit' };
const td: React.CSSProperties = { padding: '0.35rem 0.5rem', borderTop: '1px solid var(--color-gray-100, #EBF1F7)', fontSize: '0.85rem' };

const ERRORS: Record<string, string> = {
    period_locked: 'วันที่นี้อยู่ในงวดที่ปิดแล้ว — เปิดงวดก่อน หรือเลือกวันที่หลังงวดที่ปิด',
    already_closed: 'ปิดบัญชีถึงวันนี้ (หรือหลังจากนี้) ไปแล้ว — ถ้าต้องการทำใหม่ ให้กลับรายการปิดบัญชีเดิมในสมุดรายวันก่อน',
    nothing_to_close: 'ไม่มียอดรายได้หรือค่าใช้จ่ายที่ต้องปิด',
    retained_account_invalid: 'เลือกบัญชีส่วนของเจ้าของที่ยังใช้งานอยู่',
    forbidden: 'ต้องเป็นผู้จัดการสมุดบัญชีจึงปิดบัญชีได้',
    invalid_input: 'วันที่ไม่ถูกต้อง',
};

/** Year-end close: revenue and expense balances go to retained earnings; the year's P&L stays readable afterwards. */
export default function YearEndClose({ ownerUid, ledger, entries }: Props) {
    const today = todayThDate();
    const [through, setThrough] = useState(() => {
        const y = Number(today.slice(0, 4));
        return today.slice(5) === '12-31' ? today : `${y - 1}-12-31`;
    });
    const equity = ledger.accounts.filter(a => a.type === 'equity' && a.active);
    const [account, setAccount] = useState(() => (equity.find(a => a.code === '3201') ?? equity.find(a => /สะสม/.test(a.name)) ?? equity[0])?.code ?? '');
    const [lockToo, setLockToo] = useState(true);
    const [busy, setBusy] = useState(false);

    const lines = useMemo(() => (account ? closingLines(entries, ledger.accounts, through, account) : []), [entries, ledger.accounts, through, account]);
    const retained = lines.find(l => l.account === account);
    const profit = retained ? retained.cr_satang - retained.dr_satang : 0;
    const names = new Map(ledger.accounts.map(a => [a.code, a.name]));
    const lastClose = entries.filter(e => e.kind === 'closing' && !e.reversed_by).sort((a, b) => b.date.localeCompare(a.date))[0];
    const hasRetained = equity.some(a => a.code === '3201' || /สะสม/.test(a.name));

    const close = async () => {
        if (!confirm(`ปิดบัญชีรายได้และค่าใช้จ่ายถึง ${through}\n${profit >= 0 ? 'กำไร' : 'ขาดทุน'}สุทธิ ${baht(Math.abs(profit))} บาท เข้าบัญชี ${account} ${names.get(account) ?? ''}\n\nแก้ภายหลังได้ด้วยการกลับรายการในสมุดรายวัน`)) return;
        setBusy(true);
        try {
            await apiPost('ledger', { owner_uid: ownerUid, ledger_id: ledger.id, action: 'close_year', through, account });
            if (lockToo && (!ledger.locked_through || ledger.locked_through < through)) {
                await apiPost('ledger', { owner_uid: ownerUid, ledger_id: ledger.id, action: 'lock_period', through });
            }
            toast.success(lockToo ? 'ปิดบัญชีและปิดงวดแล้ว' : 'ปิดบัญชีแล้ว');
        } catch (e) {
            const err = e as ApiError;
            toast.error(ERRORS[err.code] ?? err.message ?? 'ปิดบัญชีไม่สำเร็จ');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section style={card} aria-label="ปิดบัญชีสิ้นปี">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CalendarCheck size={20} color="#0F4C81" />
                <strong>ปิดบัญชีสิ้นปี</strong>
                {lastClose && <span style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>ปิดล่าสุดถึง {lastClose.date}</span>}
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>
                ล้างยอดบัญชีรายได้และค่าใช้จ่ายทั้งหมดให้เป็นศูนย์ แล้วโอนกำไร (ขาดทุน) สุทธิเข้าบัญชีกำไรสะสม — งบกำไรขาดทุนของปีนั้นยังดูได้เหมือนเดิม
            </p>
            {!hasRetained && (
                <div role="note" style={{ fontSize: '0.8rem', color: '#B45309' }}>
                    แนะนำให้เพิ่มบัญชี 3201 “กำไร (ขาดทุน) สะสม” (ประเภทส่วนของเจ้าของ) ในแท็บตั้งค่าก่อน
                </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ fontSize: '0.85rem' }}>ปิดถึงวันที่ <input type="date" value={through} max={today} onChange={e => setThrough(e.target.value)} style={input} /></label>
                <label style={{ fontSize: '0.85rem' }}>โอนเข้า{' '}
                    <select value={account} onChange={e => setAccount(e.target.value)} style={input}>
                        {equity.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                    </select>
                </label>
                <label style={{ fontSize: '0.85rem', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox" checked={lockToo} onChange={e => setLockToo(e.target.checked)} /> ปิดงวดถึงวันนั้นด้วย (กันลงรายการย้อนหลัง)
                </label>
            </div>
            {lines.length === 0 ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>ไม่มียอดรายได้หรือค่าใช้จ่ายค้างถึงวันที่นี้</div>
            ) : (
                <>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th style={{ ...td, textAlign: 'left' }}>บัญชี</th><th style={{ ...td, textAlign: 'right' }}>เดบิต</th><th style={{ ...td, textAlign: 'right' }}>เครดิต</th></tr></thead>
                            <tbody>
                                {lines.map(l => (
                                    <tr key={l.account} style={l.account === account ? { fontWeight: 700 } : undefined}>
                                        <td style={td}>{l.account} {names.get(l.account) ?? ''}</td>
                                        <td style={{ ...td, textAlign: 'right' }}>{l.dr_satang ? baht(l.dr_satang) : ''}</td>
                                        <td style={{ ...td, textAlign: 'right' }}>{l.cr_satang ? baht(l.cr_satang) : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: profit >= 0 ? '#15803D' : '#B91C1C' }}>{profit >= 0 ? 'กำไร' : 'ขาดทุน'}สุทธิ {baht(Math.abs(profit))} บาท</span>
                        <button className="btn btn-primary btn-sm" disabled={busy || !account} onClick={() => void close()}>
                            {busy ? <Loader2 size={14} className="spin" /> : <CalendarCheck size={14} />} ปิดบัญชี
                        </button>
                    </div>
                </>
            )}
        </section>
    );
}
