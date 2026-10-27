import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { fromSatang } from '../../shared/accounting';
import { balanceSheet, payablesByParty, profitAndLoss, todayThDate, type JournalEntry, type Ledger } from '../../shared/ledger';
import { downloadCsv } from '../../utils/csv';

type View = 'pnl' | 'bs' | 'payables';

const baht = (s: number) => fromSatang(s).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)', overflowX: 'auto' };
const input: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #C3D0DE)', borderRadius: 8, font: 'inherit' };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '0.3rem 0', borderTop: '1px solid var(--color-gray-100, #EBF1F7)', fontSize: '0.9rem' };
const total: React.CSSProperties = { ...row, fontWeight: 800, borderTop: '2px solid var(--color-gray-300, #C3D0DE)' };

function Section({ title, rows, sum, sumLabel }: { title: string; rows: { key: string; label: string; satang: number }[]; sum: number; sumLabel: string }) {
  return (
  <div style={{ marginBottom: 12 }}>
    <strong>{title}</strong>
    {rows.length === 0 ? <div style={{ ...row, color: 'var(--color-gray-500)' }}>ไม่มีรายการ</div> : rows.map(r => <div key={r.key} style={row}><span>{r.label}</span><span>{baht(r.satang)}</span></div>)}
    <div style={total}><span>{sumLabel}</span><span>{baht(sum)}</span></div>
  </div>
)
}

/** Financial statements computed from the ledger's journal: profit and loss, balance sheet, and what is owed to suppliers. */
export default function StatementsTab({ ledger, entries }: { ledger: Ledger; entries: JournalEntry[] }) {
  const today = todayThDate();
  const [view, setView] = useState<View>('pnl');
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [asOf, setAsOf] = useState(today);
  const [apCode, setApCode] = useState(ledger.accounts.find(a => a.code === '2110')?.code ?? ledger.accounts.find(a => a.type === 'liability')?.code ?? '');

  const pnl = useMemo(() => profitAndLoss(entries, ledger.accounts, from, to), [entries, ledger.accounts, from, to]);
  const bs = useMemo(() => balanceSheet(entries, ledger.accounts, asOf), [entries, ledger.accounts, asOf]);
  const ap = useMemo(() => [...payablesByParty(entries, apCode, asOf)].sort((a, b) => b[1] - a[1]), [entries, apCode, asOf]);
  const labelOf = (r: { account: { code: string; name: string } }) => `${r.account.code} ${r.account.name}`;

  const exportPnl = () => downloadCsv(`profit-loss-${from}_${to}.csv`, [
    ['งบกำไรขาดทุน', `${from} ถึง ${to}`], ['รายได้'], ...pnl.revenue.map(r => [labelOf(r), fromSatang(r.amount_satang)]), ['รวมรายได้', fromSatang(pnl.revenue_satang)],
    ['ค่าใช้จ่าย'], ...pnl.expenses.map(r => [labelOf(r), fromSatang(r.amount_satang)]), ['รวมค่าใช้จ่าย', fromSatang(pnl.expense_satang)], ['กำไร(ขาดทุน)สุทธิ', fromSatang(pnl.net_satang)],
  ]);
  const exportBs = () => downloadCsv(`balance-sheet-${asOf}.csv`, [
    ['งบแสดงฐานะการเงิน', `ณ ${asOf}`], ['สินทรัพย์'], ...bs.assets.map(r => [labelOf(r), fromSatang(r.balance_satang)]), ['รวมสินทรัพย์', fromSatang(bs.assets_satang)],
    ['หนี้สิน'], ...bs.liabilities.map(r => [labelOf(r), fromSatang(r.balance_satang)]), ['รวมหนี้สิน', fromSatang(bs.liabilities_satang)],
    ['ส่วนของเจ้าของ'], ...bs.equity.map(r => [labelOf(r), fromSatang(r.balance_satang)]), ['กำไร(ขาดทุน)สะสมที่ยังไม่ปิดบัญชี', fromSatang(bs.earnings_satang)],
    ['รวมหนี้สินและส่วนของเจ้าของ', fromSatang(bs.liabilities_satang + bs.equity_satang + bs.earnings_satang)],
  ]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {([['pnl', 'งบกำไรขาดทุน'], ['bs', 'งบแสดงฐานะการเงิน'], ['payables', 'เจ้าหนี้รายราย']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={view === id ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'}>{label}</button>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>
        คำนวณจากรายการที่ลงสมุดบัญชีแล้ว ({entries.length} รายการ) — เป็นรายงานบริหาร ไม่ใช่งบการเงินตามกฎหมาย · ค่าใช้จ่ายต้องบันทึกที่แท็บ "บันทึกค่าใช้จ่าย" จึงจะเข้างบ
      </p>

      {view === 'pnl' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '0.85rem' }}>ตั้งแต่ <input type="date" style={input} value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label style={{ fontSize: '0.85rem' }}>ถึง <input type="date" style={input} value={to} onChange={e => setTo(e.target.value)} /></label>
            <button className="btn btn-outline btn-sm" onClick={exportPnl} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={13} /> CSV</button>
          </div>
          <div style={card}>
            <Section title="รายได้" rows={pnl.revenue.map(r => ({ key: r.account.code, label: labelOf(r), satang: r.amount_satang }))} sum={pnl.revenue_satang} sumLabel="รวมรายได้" />
            <Section title="ค่าใช้จ่าย" rows={pnl.expenses.map(r => ({ key: r.account.code, label: labelOf(r), satang: r.amount_satang }))} sum={pnl.expense_satang} sumLabel="รวมค่าใช้จ่าย" />
            <div style={{ ...total, color: pnl.net_satang >= 0 ? '#15803D' : '#B91C1C', fontSize: '1.05rem' }}><span>{pnl.net_satang >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'}</span><span>{baht(Math.abs(pnl.net_satang))}</span></div>
          </div>
        </>
      )}

      {view === 'bs' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '0.85rem' }}>ณ วันที่ <input type="date" style={input} value={asOf} onChange={e => setAsOf(e.target.value)} /></label>
            <button className="btn btn-outline btn-sm" onClick={exportBs} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={13} /> CSV</button>
          </div>
          <div style={card}>
            <Section title="สินทรัพย์" rows={bs.assets.map(r => ({ key: r.account.code, label: labelOf(r), satang: r.balance_satang }))} sum={bs.assets_satang} sumLabel="รวมสินทรัพย์" />
            <Section title="หนี้สิน" rows={bs.liabilities.map(r => ({ key: r.account.code, label: labelOf(r), satang: r.balance_satang }))} sum={bs.liabilities_satang} sumLabel="รวมหนี้สิน" />
            <Section title="ส่วนของเจ้าของ" rows={[...bs.equity.map(r => ({ key: r.account.code, label: labelOf(r), satang: r.balance_satang })), { key: 'earn', label: 'กำไร(ขาดทุน)สะสมที่ยังไม่ปิดบัญชี', satang: bs.earnings_satang }]}
              sum={bs.equity_satang + bs.earnings_satang} sumLabel="รวมส่วนของเจ้าของ" />
            <div style={{ ...total, color: bs.balanced ? '#15803D' : '#B91C1C' }}>
              <span>{bs.balanced ? 'สินทรัพย์ = หนี้สิน + ส่วนของเจ้าของ ✓' : 'งบไม่สมดุล — โปรดตรวจรายการในสมุดรายวัน'}</span>
              <span>{baht(bs.liabilities_satang + bs.equity_satang + bs.earnings_satang)}</span>
            </div>
          </div>
        </>
      )}

      {view === 'payables' && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '0.85rem' }}>บัญชีเจ้าหนี้ <select style={input} value={apCode} onChange={e => setApCode(e.target.value)}>{ledger.accounts.filter(a => a.type === 'liability').map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></label>
            <label style={{ fontSize: '0.85rem' }}>ณ วันที่ <input type="date" style={input} value={asOf} onChange={e => setAsOf(e.target.value)} /></label>
          </div>
          <div style={card}>
            {ap.length === 0 ? <div style={{ color: 'var(--color-gray-500)' }}>ไม่มียอดค้างจ่าย</div> : ap.map(([party, v]) => <div key={party} style={row}><span>{party}</span><strong>{baht(v)}</strong></div>)}
            {ap.length > 0 && <div style={total}><span>รวมค้างจ่าย</span><span>{baht(ap.reduce((s, [, v]) => s + v, 0))}</span></div>}
          </div>
        </>
      )}
    </div>
  );
}
