import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { fromSatang } from '../../shared/accounting';
import {
    ACCOUNT_TYPE_LABELS_TH, AGING_BUCKETS, accountLedger, receivablesAging, receivablesByParty, revenueByAccount, todayThDate, trialBalance, trialTotals,
    type JournalEntry, type Ledger,
} from '../../shared/ledger';
import { useBuildingRooms } from '../../hooks/useAccountingData';
import { downloadCsv } from '../../utils/csv';
import { downloadXlsx } from '../../utils/xlsxWriter';
import { accountantPack } from '../../utils/accountantPack';

interface Props { ownerUid: string; ledger: Ledger; entries: JournalEntry[] }
type Report = 'trial' | 'account' | 'receivables' | 'aging' | 'revenue';

const baht = (s: number) => fromSatang(s).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: 0, background: 'var(--color-white, #fff)', overflowX: 'auto' };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #C3D0DE)', borderRadius: 8, font: 'inherit' };
const th: React.CSSProperties = { padding: '0.5rem', textAlign: 'left', background: 'var(--color-gray-50, #F4F7FB)', fontSize: '0.8rem' };
const td: React.CSSProperties = { padding: '0.4rem 0.5rem', borderTop: '1px solid var(--color-gray-100, #EBF1F7)', fontSize: '0.85rem' };
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
    const aging = useMemo(() => receivablesAging(entries, ledger.posting.ar_account, asOf), [entries, ledger.posting.ar_account, asOf]);
    const exportPack = () => downloadXlsx(`accounting-${ledger.name || ledger.id}-${from}_${to}.xlsx`, accountantPack(ledger, entries, { from, to, partyName: roomName }));

    const tabs: [Report, string][] = [['trial', 'งบทดลอง'], ['account', 'บัญชีแยกประเภท'], ['receivables', 'ลูกหนี้รายแผง/ห้อง'], ['aging', 'ลูกหนี้ตามอายุ'], ['revenue', 'รายได้ตามหมวด']];
    const dateRange = (
        <>
            <label style={{ fontSize: '0.85rem' }}>ตั้งแต่ <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={input} /></label>
            <label style={{ fontSize: '0.85rem' }}>ถึง <input type="date" value={to} onChange={e => setTo(e.target.value)} style={input} /></label>
        </>
    );
    const asOfInput = <label style={{ fontSize: '0.85rem' }}>ณ วันที่ <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} style={input} /></label>;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ ...card, padding: '0.75rem 0.875rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <FileSpreadsheet size={22} color="#15803D" />
                <div style={{ flex: '1 1 220px' }}>
                    <div style={{ fontWeight: 700 }}>ส่งให้นักบัญชี</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>Excel ไฟล์เดียว: สมุดรายวัน แยกประเภท งบทดลอง งบกำไรขาดทุน งบดุล และลูกหนี้ตามอายุ ของงวดที่เลือก</div>
                </div>
                {dateRange}
                <button className="btn btn-primary btn-sm" onClick={exportPack} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={13} /> ดาวน์โหลด Excel</button>
            </div>
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
                        {acct && account && <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`ledger-${account.code}-${from}_${to}.csv`, [
                            ['วันที่', 'เอกสาร', 'รายการ', 'เดบิต', 'เครดิต', 'คงเหลือ'],
                            ['', '', 'ยอดยกมา', '', '', fromSatang(acct.opening_satang)],
                            ...acct.rows.map(r => [r.entry.date, r.entry.doc_ref, r.line.description, r.line.dr_satang ? fromSatang(r.line.dr_satang) : '', r.line.cr_satang ? fromSatang(r.line.cr_satang) : '', fromSatang(r.running_satang)]),
                            ['', '', 'ยอดคงเหลือ', '', '', fromSatang(acct.closing_satang)],
                        ])} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={13} /> CSV</button>}
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

            {report === 'aging' && (
                <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {asOfInput}
                        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`aging-${asOf}.csv`, [['แผง/ห้อง', ...AGING_BUCKETS.map(k => `${k} วัน`), 'รวม'], ...aging.map(r => [roomName.get(r.party_id) ?? r.party_id, ...AGING_BUCKETS.map(k => fromSatang(r.buckets[k])), fromSatang(r.total_satang)])])} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={13} /> CSV</button>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>เงินที่รับแล้วตัดหนี้ที่เก่าที่สุดก่อน ยอดที่เหลือแบ่งตามจำนวนวันนับจากวันที่ออกบิล</p>
                    <div style={card}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr><th style={th}>แผง/ห้อง</th>{AGING_BUCKETS.map(k => <th key={k} style={{ ...th, ...num }}>{k} วัน</th>)}<th style={{ ...th, ...num }}>รวม</th></tr></thead>
                            <tbody>
                                {aging.length === 0 ? <tr><td style={td} colSpan={6}>ไม่มียอดค้าง</td></tr> : aging.map(r => (
                                    <tr key={r.party_id}>
                                        <td style={td}>{roomName.get(r.party_id) ?? r.party_id}</td>
                                        {AGING_BUCKETS.map(k => <td key={k} style={{ ...td, ...num, color: k === '90+' && r.buckets[k] > 0 ? '#B91C1C' : undefined }}>{r.buckets[k] ? baht(r.buckets[k]) : ''}</td>)}
                                        <td style={{ ...td, ...num, fontWeight: 700 }}>{baht(r.total_satang)}</td>
                                    </tr>
                                ))}
                                {aging.length > 0 && (
                                    <tr style={{ fontWeight: 700 }}>
                                        <td style={td}>รวม</td>
                                        {AGING_BUCKETS.map(k => <td key={k} style={{ ...td, ...num }}>{baht(aging.reduce((s, r) => s + r.buckets[k], 0))}</td>)}
                                        <td style={{ ...td, ...num }}>{baht(aging.reduce((s, r) => s + r.total_satang, 0))}</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {report === 'revenue' && (
                <>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {dateRange}
                        <button className="btn btn-outline btn-sm" onClick={() => downloadCsv(`revenue-${from}_${to}.csv`, [['รหัส', 'บัญชีรายได้', 'จำนวนเงิน'], ...revenue.map(r => [r.account.code, r.account.name, fromSatang(r.amount_satang)])])} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={13} /> CSV</button>
                    </div>
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
