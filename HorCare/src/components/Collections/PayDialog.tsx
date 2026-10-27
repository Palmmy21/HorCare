import { useMemo, useRef, useState } from 'react';
import { Banknote, Camera, CheckCircle2, Loader2, QrCode, X } from 'lucide-react';
import toast from 'react-hot-toast';
import BankQrCard from '../Payments/BankQrCard';
import { collectionsError } from '../../hooks/useCollections';
import { outstanding, type Charge } from '../../shared/collections';
import type { BankAccount } from '../../shared/banks';

interface SlipResult {
  recorded: boolean; auto?: boolean; needs_review?: boolean; note?: string; ai_amount?: number | null;
  outstanding_satang?: number; suggested_bank_account_id?: string | null;
  details?: { amount?: number | null; sender_name?: string | null; receiver_name?: string | null; datetime_iso?: string | null } | null;
}

interface Props {
  charge: Charge;
  accounts: BankAccount[];
  call: <T>(body: Record<string, unknown>) => Promise<T>;
  /** Called after money was recorded, so the screen refreshes. */
  onDone: () => void;
  onClose: () => void;
}

const baht = (s: number) => (s / 100).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const MAX_SIDE = 1280;

/** Shrink a phone photo before upload: slips are read by AI and kept as evidence, so a 1280px JPEG is plenty. */
function fileToJpegDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); reject(new Error('canvas')); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

const box: React.CSSProperties = { border: '1px solid var(--color-gray-200, #DCE5EF)', borderRadius: 12, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: 8 };
const field: React.CSSProperties = { padding: '0.6rem 0.7rem', border: '1px solid var(--color-gray-300, #C3D0DE)', borderRadius: 10, font: 'inherit', minWidth: 0, boxSizing: 'border-box', width: '100%', fontSize: '1rem' };

export default function PayDialog({ charge, accounts, call, onDone, onClose }: Props) {
  const left = outstanding(charge);
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [amount, setAmount] = useState(String(left / 100));
  const [bankId, setBankId] = useState(accounts.find(a => a.is_default)?.id ?? accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<SlipResult | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const account = useMemo(() => accounts.find(a => a.id === bankId) ?? null, [accounts, bankId]);
  const amountNum = Number(amount);
  const amountOk = Number.isFinite(amountNum) && amountNum > 0 && Math.round(amountNum * 100) <= left;

  const finish = (msg: string) => { toast.success(msg); onDone(); onClose(); };

  const payManual = async (m: 'cash' | 'transfer') => {
    if (!amountOk) return;
    setBusy(true);
    try {
      await call({ action: 'charge_pay', charge_id: charge.id, method: m, amount: amountNum, ...(m === 'transfer' ? { bank_account_id: bankId } : {}) });
      finish(m === 'cash' ? 'รับเงินสดแล้ว' : 'บันทึกการโอนแล้ว');
    } catch (e) { toast.error(collectionsError(e)); } finally { setBusy(false); }
  };

  const sendSlip = async (img: string, confirm?: { amount: number; bank: string }) => {
    setBusy(true);
    try {
      const r = await call<SlipResult>({
        action: 'charge_slip', charge_id: charge.id, image: img,
        ...(confirm ? { confirm: true, amount: confirm.amount, bank_account_id: confirm.bank } : {}),
      });
      if (r.recorded) { finish(r.auto ? 'AI อ่านสลิปแล้ว ตรงกับยอด — บันทึกการรับเงินเรียบร้อย' : 'บันทึกการรับเงินจากสลิปแล้ว'); return; }
      setReview(r);
      if (r.suggested_bank_account_id) setBankId(r.suggested_bank_account_id);
      if (r.ai_amount) setAmount(String(Math.min(r.ai_amount, left / 100)));
    } catch (e) { toast.error(collectionsError(e)); } finally { setBusy(false); }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try { const img = await fileToJpegDataUrl(file); setImage(img); setReview(null); await sendSlip(img); }
    catch { toast.error('อ่านไฟล์รูปไม่ได้'); }
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" style={{ maxWidth: 480, width: '100%' }} role="dialog" aria-modal="true" aria-label="รับเงิน">
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="modal-title">รับเงิน · {charge.room_number ?? charge.party_name}</span>
          <button className="btn-icon" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...box, background: 'var(--color-gray-50, #F4F7FB)' }}>
            <span style={{ fontSize: '0.85rem' }}>{charge.description || charge.party_name}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>ยอดทั้งหมด {baht(charge.amount_satang)} · รับแล้ว {baht(charge.paid_satang)}</span>
              <strong style={{ fontSize: '1.15rem' }}>ค้าง ฿{baht(left)}</strong>
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.8rem' }}>จำนวนเงินที่รับ (บาท)</span>
            <input style={field} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
            {!amountOk && amount !== '' && <span style={{ color: '#B91C1C', fontSize: '0.78rem' }}>ต้องมากกว่า 0 และไม่เกินยอดค้าง</span>}
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className={method === 'cash' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setMethod('cash')} style={{ display: 'inline-flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}><Banknote size={16} /> เงินสด</button>
            <button className={method === 'transfer' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setMethod('transfer')} style={{ display: 'inline-flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}><QrCode size={16} /> โอน / QR</button>
          </div>

          {method === 'cash' && (
            <button className="btn btn-primary" disabled={busy || !amountOk} onClick={() => void payManual('cash')} style={{ padding: '0.85rem', fontSize: '1.05rem' }}>
              {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} รับเงินสด ฿{amountOk ? amountNum.toLocaleString('th-TH') : '—'}
            </button>
          )}

          {method === 'transfer' && (
            accounts.length === 0 ? (
              <div style={{ ...box, borderColor: '#F59E2E', background: '#FEF6EC' }}>ยังไม่มีบัญชีรับเงิน — เพิ่มที่หน้า "การชำระเงิน → บัญชีรับเงิน" ก่อน</div>
            ) : (
              <>
                {accounts.length > 1 && (
                  <select style={field} value={bankId} onChange={e => setBankId(e.target.value)}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.nickname || `${a.bank_short} ${a.account_name}`}</option>)}
                  </select>
                )}
                {account && amountOk && <BankQrCard account={account} amount={amountNum} title="สแกนเพื่อชำระ" formatAmount={n => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`} />}

                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
                <button className="btn btn-outline" disabled={busy} onClick={() => fileRef.current?.click()} style={{ display: 'inline-flex', gap: 6, justifyContent: 'center', alignItems: 'center', padding: '0.8rem' }}>
                  {busy ? <Loader2 size={16} className="spin" /> : <Camera size={16} />} แนบสลิป — ให้ AI อ่านและบันทึก
                </button>

                {review && (
                  <div style={{ ...box, borderColor: '#F59E2E', background: '#FEF6EC' }}>
                    <strong>AI ยังยืนยันอัตโนมัติไม่ได้ — โปรดตรวจสลิปด้วยตา</strong>
                    <span style={{ fontSize: '0.85rem' }}>{review.note}</span>
                    <span style={{ fontSize: '0.85rem' }}>
                      AI อ่านได้: {review.ai_amount != null ? `฿${review.ai_amount.toLocaleString('th-TH')}` : 'ไม่พบยอด'}
                      {review.details?.sender_name ? ` · ผู้โอน ${review.details.sender_name}` : ''}
                      {review.details?.receiver_name ? ` · ผู้รับ ${review.details.receiver_name}` : ''}
                    </span>
                    <button className="btn btn-primary" disabled={busy || !amountOk || !bankId || !image} onClick={() => image && void sendSlip(image, { amount: amountNum, bank: bankId })}>
                      ยืนยันว่าได้รับ ฿{amountOk ? amountNum.toLocaleString('th-TH') : '—'} แล้ว (ตรวจสลิปแล้ว)
                    </button>
                  </div>
                )}

                <button className="btn btn-outline btn-sm" disabled={busy || !amountOk} onClick={() => void payManual('transfer')}>
                  ลูกค้าโอนแล้ว ไม่มีสลิป — บันทึกเลย
                </button>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
