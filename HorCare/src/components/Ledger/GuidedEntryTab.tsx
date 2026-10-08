import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiPost, ApiError } from '../../utils/api';
import { fromSatang, toSatang } from '../../shared/accounting';
import { todayThDate, validateEntryLines, type Ledger } from '../../shared/ledger';
import { WHT_RATES, expenseLines, openingBalanceLines, payablePaymentLines, vatSplit } from '../../shared/entryTemplates';

type Kind = 'expense' | 'payable' | 'pay' | 'opening';

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'expense', label: 'ค่าใช้จ่าย (จ่ายแล้ว)', hint: 'จ่ายเงินสดหรือโอนไปแล้ว เช่น ซ่อมแอร์ ค่าน้ำดื่ม' },
  { id: 'payable', label: 'ค่าใช้จ่ายค้างจ่าย (เจ้าหนี้)', hint: 'รับของ/บริการแล้วแต่ยังไม่จ่าย บันทึกว่าค้างจ่ายใคร' },
  { id: 'pay', label: 'จ่ายชำระเจ้าหนี้', hint: 'จ่ายเงินที่ค้างไว้ หักภาษี ณ ที่จ่ายได้' },
  { id: 'opening', label: 'ยอดยกมา', hint: 'ยอดเงินสด/ธนาคาร/ลูกหนี้/เจ้าหนี้ ที่มีอยู่ก่อนเริ่มใช้ HorCare' },
];
const ERRORS: Record<string, string> = {
  period_locked: 'งวดนี้ปิดแล้ว', invalid_entry: 'รายการไม่ถูกต้อง ตรวจสอบบัญชีและยอดเงิน', invalid_input: 'ข้อมูลไม่ถูกต้อง', memo_required: 'กรุณาระบุคำอธิบาย',
  forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้', unauthenticated: 'กรุณาเข้าสู่ระบบใหม่',
};

const baht = (s: number) => fromSatang(s).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const field: React.CSSProperties = { padding: '0.5rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit', minWidth: 0, boxSizing: 'border-box', width: '100%' };
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.75rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 8 };

/** "What happened?" instead of debit/credit: the lines, VAT and withholding tax are worked out and shown before saving. */
export default function GuidedEntryTab({ ownerUid, ledger }: { ownerUid: string; ledger: Ledger }) {
  const accounts = ledger.accounts.filter(a => a.active);
  const pick = (code: string, type?: string) => (accounts.some(a => a.code === code) ? code : (accounts.find(a => !type || a.type === type)?.code ?? ''));
  const [kind, setKind] = useState<Kind>('expense');
  const [date, setDate] = useState(todayThDate());
  const [memo, setMemo] = useState('');
  const [amount, setAmount] = useState('');
  const [expenseAcc, setExpenseAcc] = useState(pick('5101', 'expense'));
  const [payAcc, setPayAcc] = useState(pick('1101', 'asset'));
  const [apAcc, setApAcc] = useState(pick('2110', 'liability'));
  const [supplier, setSupplier] = useState('');
  const [vatOn, setVatOn] = useState(false);
  const [vatMode, setVatMode] = useState<'inclusive' | 'exclusive'>('inclusive');
  const [vatAcc, setVatAcc] = useState(pick('1160', 'asset'));
  const [whtRate, setWhtRate] = useState(0);
  const [whtAcc, setWhtAcc] = useState(pick('2210', 'liability'));
  const [equityAcc, setEquityAcc] = useState(pick('3101', 'equity'));
  const [openRows, setOpenRows] = useState([{ account: pick('1101', 'asset'), debit: '', credit: '', party: '' }]);
  const [busy, setBusy] = useState(false);

  const amountSatang = toSatang(Number(amount) || 0);
  const lines = useMemo(() => {
    if (kind === 'opening') {
      return openingBalanceLines(openRows.map(r => ({ account: r.account, debitSatang: toSatang(Number(r.debit) || 0), creditSatang: toSatang(Number(r.credit) || 0), party: r.party || undefined })), equityAcc);
    }
    if (amountSatang <= 0) return [];
    const vat = vatOn ? { mode: vatMode, account: vatAcc } : undefined;
    if (kind === 'pay') {
      const base = vatOn ? vatSplit(amountSatang, vatMode).net_satang : amountSatang;
      return payablePaymentLines({ payableAccount: apAcc, payAccount: payAcc, amountSatang: vatOn && vatMode === 'exclusive' ? vatSplit(amountSatang, 'exclusive').gross_satang : amountSatang, description: memo || 'จ่ายชำระเจ้าหนี้', supplier: supplier || undefined, wht: whtRate > 0 ? { ratePct: whtRate, baseSatang: base, account: whtAcc } : undefined });
    }
    return expenseLines({ expenseAccount: expenseAcc, counterAccount: kind === 'payable' ? apAcc : payAcc, amountSatang, description: memo || 'ค่าใช้จ่าย', supplier: kind === 'payable' ? supplier || undefined : undefined, vat });
  }, [kind, openRows, equityAcc, amountSatang, vatOn, vatMode, vatAcc, apAcc, payAcc, memo, supplier, whtRate, whtAcc, expenseAcc]);

  const issues = validateEntryLines(lines, ledger.accounts);
  const nameOf = (code: string) => ledger.accounts.find(a => a.code === code)?.name ?? '';
  const missingAccounts = (kind === 'expense' || kind === 'payable') && vatOn && !accounts.some(a => a.code === vatAcc);
  const ready = lines.length > 0 && issues.length === 0 && memo.trim().length >= 2 && (kind !== 'payable' || supplier.trim().length > 0);

  const save = async () => {
    setBusy(true);
    try {
      await apiPost('ledger', {
        owner_uid: ownerUid, ledger_id: ledger.id, action: 'manual_entry', date, memo: memo.trim(),
        lines: lines.map(l => ({ account: l.account, debit: l.dr_satang ? l.dr_satang / 100 : undefined, credit: l.cr_satang ? l.cr_satang / 100 : undefined, description: l.description, party_id: l.party_id ?? undefined })),
      });
      toast.success('บันทึกรายการแล้ว');
      setMemo(''); setAmount(''); setSupplier(''); setOpenRows([{ account: pick('1101', 'asset'), debit: '', credit: '', party: '' }]);
    } catch (e) { const err = e as ApiError; toast.error(ERRORS[err.code] ?? err.message ?? 'บันทึกไม่สำเร็จ'); } finally { setBusy(false); }
  };

  const accSelect = (value: string, set: (v: string) => void, type?: string, label?: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: '0.78rem' }}>{label}
      <select style={field} value={value} onChange={e => set(e.target.value)}>{accounts.filter(a => !type || a.type === type).map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select>
    </label>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {KINDS.map(k => <button key={k.id} className={kind === k.id ? 'btn btn-primary btn-sm' : 'btn btn-outline btn-sm'} onClick={() => setKind(k.id)}>{k.label}</button>)}
      </div>
      <span style={{ fontSize: '0.82rem', color: 'var(--color-gray-500)' }}>{KINDS.find(k => k.id === kind)!.hint}</span>

      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
          <label style={{ fontSize: '0.78rem' }}>วันที่<input type="date" style={field} value={date} max={todayThDate()} onChange={e => setDate(e.target.value)} /></label>
          <label style={{ fontSize: '0.78rem', gridColumn: 'span 2' }}>คำอธิบาย<input style={field} value={memo} maxLength={300} placeholder={kind === 'opening' ? 'เช่น ยอดยกมา 1 ม.ค.' : 'เช่น ซ่อมแอร์ห้อง 203'} onChange={e => setMemo(e.target.value)} /></label>
          {kind !== 'opening' && <label style={{ fontSize: '0.78rem' }}>{vatOn && vatMode === 'exclusive' ? 'จำนวนเงินก่อน VAT (บาท)' : 'จำนวนเงิน (บาท)'}<input style={field} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></label>}
          {(kind === 'payable' || kind === 'pay') && <label style={{ fontSize: '0.78rem' }}>ชื่อเจ้าหนี้ / ร้านค้า<input style={field} value={supplier} maxLength={100} onChange={e => setSupplier(e.target.value)} /></label>}
        </div>

        {(kind === 'expense' || kind === 'payable') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
            {accSelect(expenseAcc, setExpenseAcc, 'expense', 'บัญชีค่าใช้จ่าย')}
            {kind === 'expense' ? accSelect(payAcc, setPayAcc, 'asset', 'จ่ายจาก (เงินสด/ธนาคาร)') : accSelect(apAcc, setApAcc, 'liability', 'บัญชีเจ้าหนี้')}
          </div>
        )}
        {kind === 'pay' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
            {accSelect(apAcc, setApAcc, 'liability', 'บัญชีเจ้าหนี้ที่จ่ายชำระ')}{accSelect(payAcc, setPayAcc, 'asset', 'จ่ายจาก (เงินสด/ธนาคาร)')}
          </div>
        )}

        {kind !== 'opening' && (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {kind !== 'pay' && <label><input type="checkbox" checked={vatOn} onChange={e => setVatOn(e.target.checked)} /> มี VAT 7% (ภาษีซื้อ)</label>}
            {vatOn && kind !== 'pay' && (
              <>
                <select style={{ ...field, width: 'auto' }} value={vatMode} onChange={e => setVatMode(e.target.value as 'inclusive' | 'exclusive')}><option value="inclusive">ราคานี้รวม VAT แล้ว</option><option value="exclusive">ราคานี้ยังไม่รวม VAT</option></select>
                <div style={{ minWidth: 220 }}>{accSelect(vatAcc, setVatAcc, 'asset', 'บัญชีภาษีซื้อ')}</div>
              </>
            )}
            {kind === 'pay' && (
              <label style={{ fontSize: '0.85rem' }}>หักภาษี ณ ที่จ่าย{' '}
                <select style={{ ...field, width: 'auto' }} value={whtRate} onChange={e => setWhtRate(Number(e.target.value))}>
                  <option value={0}>ไม่หัก</option>{WHT_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                </select>
              </label>
            )}
            {kind === 'pay' && whtRate > 0 && <div style={{ minWidth: 220 }}>{accSelect(whtAcc, setWhtAcc, 'liability', 'บัญชีภาษีหัก ณ ที่จ่ายรอนำส่ง')}</div>}
          </div>
        )}

        {kind === 'opening' && (
          <>
            {openRows.map((r, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,2fr) 1fr 1fr minmax(110px,1fr) auto', gap: 6 }}>
                <select style={field} value={r.account} onChange={e => setOpenRows(openRows.map((x, k) => (k === i ? { ...x, account: e.target.value } : x)))}>{accounts.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select>
                <input style={field} inputMode="decimal" placeholder="เดบิต" value={r.debit} onChange={e => setOpenRows(openRows.map((x, k) => (k === i ? { ...x, debit: e.target.value, credit: e.target.value ? '' : x.credit } : x)))} />
                <input style={field} inputMode="decimal" placeholder="เครดิต" value={r.credit} onChange={e => setOpenRows(openRows.map((x, k) => (k === i ? { ...x, credit: e.target.value, debit: e.target.value ? '' : x.debit } : x)))} />
                <input style={field} placeholder="ชื่อ (ถ้ามี)" value={r.party} onChange={e => setOpenRows(openRows.map((x, k) => (k === i ? { ...x, party: e.target.value } : x)))} />
                <button className="btn btn-outline btn-sm" disabled={openRows.length <= 1} onClick={() => setOpenRows(openRows.filter((_, k) => k !== i))} aria-label="ลบแถว">✕</button>
              </div>
            ))}
            <div><button className="btn btn-outline btn-sm" onClick={() => setOpenRows([...openRows, { account: pick('1102', 'asset'), debit: '', credit: '', party: '' }])}>+ เพิ่มบัญชี</button></div>
            <div style={{ maxWidth: 320 }}>{accSelect(equityAcc, setEquityAcc, 'equity', 'ส่วนต่างเข้าบัญชี (ส่วนของเจ้าของ)')}</div>
          </>
        )}
      </div>

      <div style={card}>
        <strong>รายการที่จะบันทึก</strong>
        {lines.length === 0 ? <span style={{ color: 'var(--color-gray-500)', fontSize: '0.88rem' }}>กรอกจำนวนเงินเพื่อดูตัวอย่างรายการบัญชี</span> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr style={{ textAlign: 'left' }}><th>บัญชี</th><th style={{ textAlign: 'right' }}>เดบิต</th><th style={{ textAlign: 'right' }}>เครดิต</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--color-gray-100, #F3F4F6)' }}>
                  <td style={{ padding: '0.25rem 0' }}>{l.account} {nameOf(l.account)}{l.party_id ? <small style={{ color: 'var(--color-gray-500)' }}> · {l.party_id}</small> : null}</td>
                  <td style={{ textAlign: 'right' }}>{l.dr_satang ? baht(l.dr_satang) : ''}</td><td style={{ textAlign: 'right' }}>{l.cr_satang ? baht(l.cr_satang) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {missingAccounts && <span style={{ color: '#B91C1C', fontSize: '0.82rem' }}>ผังบัญชีนี้ยังไม่มีบัญชีภาษีซื้อ — เพิ่มที่แท็บ "ตั้งค่า" หรือเลือกบัญชีที่มีอยู่</span>}
        {lines.length > 0 && issues.length > 0 && <span style={{ color: '#B91C1C', fontSize: '0.82rem' }}>{issues.map(i => i.message).join(' · ')}</span>}
        <div><button className="btn btn-primary" disabled={!ready || busy} onClick={() => void save()}>{busy ? <Loader2 size={14} className="spin" /> : null} บันทึกลงสมุดบัญชี</button></div>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>บันทึกแล้วแก้ไขหรือลบไม่ได้ — ถ้าผิดให้ใช้ "กลับรายการ" ที่แท็บสมุดรายวัน</span>
      </div>
    </div>
  );
}
