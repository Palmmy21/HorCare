import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { fromSatang } from '../../shared/accounting';
import {
    ACCOUNT_TYPE_LABELS_TH, accountLedger, receivablesByParty, revenueByAccount, todayThDate, trialBalance, trialTotals,
    type JournalEntry, type Ledger,
} from '../../shared/ledger';
import { useBuildingRooms } from '../../hooks/useAccountingData';
import { downloadCsv } from '../../utils/csv';

interface Props { ownerUid: string; ledger: Ledger; entries: JournalEntry[] }
type Report = 'trial' | 'account' | 'receivables' | 'revenue';

const baht = (s: number) => fromSatang(s).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: 0, background: 'var(--color-white, #fff)', overflowX: 'auto' };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit' };
const th: React.CSSProperties = { padding: '0.5rem', textAlign: 'left', background: 'var(--color-gray-50, #F9FAFB)', fontSize: '0.8rem' };
const td: React.CSSProperties = { padding: '0.4rem 0.5rem', borderTop: '1px solid var(--color-gray-100, #F3F4F6)', fontSize: '0.85rem' };
const num: React.CSSProperties = { textAlign: 'right' };

export default function ReportsTab({ ownerUid, ledger, entries }: Props) {
    const [report, setReport] = useState<Report>('trial');
    const [asOf, setAsOf] = useState(todayThDate());
    const [from, setFrom] = useState(`${todayThDate().slice(0, 8)}01`);
    const [to, setTo] = useState(todayThDate());
    const [code, setCode] = useState(ledger.posting.ar_account);
    const rooms = useBuildingRooms(ownerUid, ledger.property_ids[0] ?? null).rooms;
    const roomName = useMemo(() => new Map(rooms.map(r => [r.id, r.room_number])), [rooms]);

    const trial = useMemo(() => trialBalance(entries, ledger.accounts, asOf), [entries, ledger.accounts, asOf]);
    const totals = trialTotals(trial);
    const account = ledger.accounts.find(a => a.code === code);
    const acct = useMemo(() => (account ? accountLedger(entries, account, from, to) : null), [entries, account, from, to]);
    const ar = useMemo(() => [...receivablesByParty(entries, ledger.posting.ar_account, asOf)].sort((a, b) => b[1] - a[1]), [entries, ledger.posting.ar_account, asOf]);
    const revenue = useMemo(() => revenueByAccount(entries, ledger.accounts, from, to), [entries, ledger.accounts, from, to]);

    const tabs: [Report, string][] = [['trial', 'งบทดลอง'], ['account', 'บัญชีแยกประเภท'], ['receivables', 'ลูกหนี้รายแผง/ห้อง'], ['revenue', 'รายได้ตามหมวด']];
    const dateRange = (
        <>
            <label style={{ fontSize: '0.85rem' }}>ตั้งแต่ <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={input} /></label>
            <label style={{ fontSize: '0.85rem' }}>ถึง <input type="date" value={to} onChange={e => setTo(e.target.value)} style={input} /></label>
        </>
    );
    const asOfInput = <label style={{ fontSize: '0.85rem' }}>ณ วันที่ <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={input} /></label>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {tabs.map(([id, label]) => <button key={id} onClick={() => setReport(id)} className={report === id ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>{label}</button>)}
            </div>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>คำนวณจากรายการที่ลงบัญชีแล้วทั้งหมด ({entries.length} รายการ) — รายงานบริหาร ไม่ใช่งบการเงินตามกฎหมาย</p>

            {report === 'trial' && (
                <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {asOfInput}
                        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`trial-balance-${asOf}.csv`, [['รหัส', 'ชื่อบัญชี', 'ประเภท', 'เดบิต', 'เครดิต', 'คงเหลือ'], ...trial.map(r => [r.account.code, r.account.name, ACCOUNT_TYPE_LABELS_TH[r.account.type], fromSatang(r.dr_satang), fromSatang(r.cr_satang), fromSatang(r.balance_satang)])])} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={13} /> CSV</button>
                    </div>
                    <div style={card}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th style={th}>รหัส</th><th style={th}>ชื่อบัญชี</th><th style={{ ...th, ...num }}>เดบิต</th><th style={{ ...th, ...num }}>เครดิต</th><th style={{ ...th, ...num }}>คงเหลือ</th></tr></thead>
                            <tbody>
                                {trial.map(r => <tr key={r.account.code}><td style={td}>{r.account.code}</td><td style={td}>{r.account.name}</td><td style={{ ...td, ...num }}>{baht(r.dr_satang)}</td><td style={{ ...td, ...num }}>{baht(r.cr_satang)}</td><td style={{ ...td, ...num }}>{baht(r.balance_satang)}</td></tr>)}
                                <tr style={{ fontWeight: 700 }}><td style={td} colSpan={2}>รวม</td><td style={{ ...td, ...num }}>{baht(totals.dr_satang)}</td><td style={{ ...td, ...num }}>{baht(totals.cr_satang)}</td><td style={td}>{totals.dr_satang === totals.cr_satang ? '✓ สมดุล' : '✗ ไม่สมดุล'}</td></tr>
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {report === 'account' && (
                <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <select style={input} value={code} onChange={e => setCode(e.target.value)} aria-label="บัญชี">
                            {ledger.accounts.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                        </select>
                        {dateRange}
                    </div>
                    {acct && account && (
                        <div style={card}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead><tr><th style={th}>วันที่</th><th style={th}>เอกสาร</th><th style={th}>รายการ</th><th style={{ ...th, ...num }}>เดบิต</th><th style={{ ...th, ...num }}>เครดิต</th><th style={{ ...th, ...num }}>คงเหลือ</th></tr></thead>
                                <tbody>
                                    <tr><td style={td} colSpan={5}>ยอดยกมา</td><td style={{ ...td, ...num }}>{baht(acct.opening_satang)}</td></tr>
                                    {acct.rows.map((r, i) => <tr key={i}><td style={td}>{r.entry.date}</td><td style={td}>{r.entry.doc_ref}</td><td style={td}>{r.line.description}</td><td style={{ ...td, ...num }}>{r.line.dr_satang ? baht(r.line.dr_satang) : ''}</td><td style={{ ...td, ...num }}>{r.line.cr_satang ? baht(r.line.cr_satang) : ''}</td><td style={{ ...td, ...num }}>{baht(r.running_satang)}</td></tr>)}
                                    <tr style={{ fontWeight: 700 }}><td style={td} colSpan={5}>ยอดคงเหลือ</td><td style={{ ...td, ...num }}>{baht(acct.closing_satang)}</td></tr>
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {report === 'receivables' && (
                <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {asOfInput}
                        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`receivables-${asOf}.csv`, [['แผง/ห้อง', 'ยอดค้าง'], ...ar.map(([id, v]) => [roomName.get(id) ?? id, fromSatang(v)])])} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={13} /> CSV</button>
                    </div>
                    <div style={card}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th style={th}>แผง/ห้อง</th><th style={{ ...th, ...num }}>ยอดค้างชำระ</th></tr></thead>
                            <tbody>
                                {ar.length === 0 ? <tr><td style={td} colSpan={2}>ไม่มียอดค้าง</td></tr> : ar.map(([id, v]) => <tr key={id}><td style={td}>{roomName.get(id) ?? id}</td><td style={{ ...td, ...num }}>{baht(v)}</td></tr>)}
                                {ar.length > 0 && <tr style={{ fontWeight: 700 }}><td style={td}>รวม</td><td style={{ ...td, ...num }}>{baht(ar.reduce((s, [, v]) => s + v, 0))}</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {report === 'revenue' && (
                <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{dateRange}</div>
                    <div style={card}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th style={th}>บัญชีรายได้</th><th style={{ ...th, ...num }}>จำนวนเงิน</th></tr></thead>
                            <tbody>
                                {revenue.length === 0 ? <tr><td style={td} colSpan={2}>ไม่มีรายได้ในช่วงนี้</td></tr> : revenue.map(r => <tr key={r.account.code}><td style={td}>{r.account.code} {r.account.name}</td><td style={{ ...td, ...num }}>{baht(r.amount_satang)}</td></tr>)}
                                {revenue.length > 0 && <tr style={{ fontWeight: 700 }}><td style={td}>รวม</td><td style={{ ...td, ...num }}>{baht(revenue.reduce((s, r) => s + r.amount_satang, 0))}</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </>
            )}
        </div>
    );
}
