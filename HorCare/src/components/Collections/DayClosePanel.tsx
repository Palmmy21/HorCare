import { useState } from 'react';
import toast from 'react-hot-toast';
import { collectionsError, type CollectionsSnapshot } from '../../hooks/useCollections';
import type { DayTotals } from '../../shared/collections';

const baht = (s: number) => (s / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** End of day: count the cash in the pouch against what the system says was taken. One close per day. */
export default function DayClosePanel({ data, totals, call, reload }: {
  data: CollectionsSnapshot; totals: DayTotals; call: <T>(body: Record<string, unknown>) => Promise<T>; reload: () => void;
}) {
  const closed = data.day_closes.find(c => c.close_date === data.today);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const diff = counted === '' ? null : Math.round(Number(counted) * 100) - totals.cash_satang;

  const close = async () => {
    setBusy(true);
    try {
      await call({ action: 'day_close', date: data.today, counted_cash: Number(counted), note: note || undefined });
      toast.success('ปิดยอดวันนี้แล้ว'); reload();
    } catch (e) { toast.error(collectionsError(e)); } finally { setBusy(false); }
  };

  return (
    <div style={{ border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong>ปิดยอดประจำวัน</strong>
      <span style={{ fontSize: '0.85rem' }}>ระบบบันทึกเงินสดวันนี้ ฿{baht(totals.cash_satang)} · โอน ฿{baht(totals.transfer_satang)} ({totals.count} รายการ)</span>
      {closed ? (
        <div style={{ background: closed.difference_satang === 0 ? '#F0FDF4' : '#FEF3C7', borderRadius: 8, padding: 8 }}>
          ปิดยอดแล้วโดย {closed.closed_by_name} · นับได้ ฿{baht(closed.counted_cash_satang)}
          {closed.difference_satang !== 0 && <strong> · ผลต่าง {closed.difference_satang > 0 ? '+' : ''}{baht(closed.difference_satang)}</strong>}
        </div>
      ) : (
        <>
          <input style={{ padding: '0.7rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 10, font: 'inherit' }} inputMode="decimal" placeholder="เงินสดที่นับได้ (บาท)" value={counted} onChange={e => setCounted(e.target.value)} />
          {diff !== null && <span style={{ fontSize: '0.85rem', color: diff === 0 ? '#16A34A' : '#B45309' }}>{diff === 0 ? 'ตรงกับระบบ' : `ผลต่าง ${diff > 0 ? 'เกิน' : 'ขาด'} ฿${baht(Math.abs(diff))}`}</span>}
          {diff !== null && diff !== 0 && <input style={{ padding: '0.7rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 10, font: 'inherit' }} placeholder="หมายเหตุสาเหตุที่ไม่ตรง" value={note} onChange={e => setNote(e.target.value)} maxLength={300} />}
          <button className="btn btn-primary" disabled={busy || counted === '' || !(Number(counted) >= 0)} onClick={() => void close()}>ปิดยอด</button>
        </>
      )}
    </div>
  );
}
