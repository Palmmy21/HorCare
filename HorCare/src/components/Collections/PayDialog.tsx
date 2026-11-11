import { useMemo, useRef, useState } from 'react';
import { Banknote, Camera, CheckCircle2, Loader2, QrCode, RefreshCw, X, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import BankQrCard from '../Payments/BankQrCard';
import { collectionsError } from '../../hooks/useCollections';
import { outstanding, type Charge } from '../../shared/collections';
import type { BankAccount } from '../../shared/banks';

interface SlipResult {
  recorded: boolean; auto?: boolean; needs_review?: boolean; note?: string; ai_amount?: number | null;
  outstanding_satang?: number; suggested_bank_account_id?: string | null;
}

interface Props {
  charge: Charge;
  accounts: BankAccount[];
  call: <T>(body: Record<string, unknown>) => Promise<T>;
  /** Called after money was recorded, so the screen refreshes. */
  onDone: () => void;
  onClose: () => void;
  /** A daily stall that has not paid yet can be marked "did not come" instead. */
  onAbsent?: () => void;
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
const big: React.CSSProperties = { padding: '0.85rem', fontSize: '1.05rem', display: 'inline-flex', gap: 6, justifyContent: 'center', alignItems: 'center' };

/**
 * Take the money for one stall / stay: cash → confirm. Transfer → the QR to scan → photo of the slip and confirm (the
 * slip is kept as evidence and the AI checks it, so the same slip can never be used twice) — or skip the photo and
 * confirm the transfer as seen.
 */
export default function PayDialog({ charge, accounts, call, onDone, onClose, onAbsent }: Props) {
  const left = outstanding(charge);
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [amount, setAmount] = useState(String(left / 100));
  const [bankId, setBankId] = useState(accounts.find(a => a.is_default)?.id ?? accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const account = useMemo(() => accounts.find(a => a.id === bankId) ?? null, [accounts, bankId]);
  const amountNum = Number(amount);
  const amountOk = Number.isFinite(amountNum) && amountNum > 0 && Math.round(amountNum * 100) <= left;
  const shown = amountOk ? amountNum.toLocaleString('th-TH') : '—';

  const finish = (msg: string) => { toast.success(msg); onDone(); onClose(); };

  const payManual = async (m: 'cash' | 'transfer') => {
    if (!amountOk) return;
    setBusy(true);
    try {
      await call({ action: 'charge_pay', charge_id: charge.id, method: m, amount: amountNum, ...(m === 'transfer' ? { bank_account_id: bankId, note: 'โอน (ไม่มีรูปสลิป)' } : {}) });
      finish(m === 'cash' ? `รับเงินสด ฿${shown} แล้ว` : `บันทึกรับโอน ฿${shown} แล้ว`);
    } catch (e) { toast.error(collectionsError(e)); } finally { setBusy(false); }
  };

  /** The collector looked at the slip and confirms: recorded with the photo as evidence (the AI's reading is kept too). */
  const confirmWithSlip = async () => {
    if (!image || !amountOk || !bankId) return;
    setBusy(true);
    try {
      const r = await call<SlipResult>({ action: 'charge_slip', charge_id: charge.id, image, confirm: true, amount: amountNum, bank_account_id: bankId });
      if (r.recorded) { finish(r.auto ? `รับโอน ฿${shown} แล้ว — AI ตรวจสลิปผ่าน` : `รับโอน ฿${shown} แล้ว พร้อมรูปสลิป`); return; }
      setNote(r.note ?? 'บันทึกไม่ได้ — ตรวจยอดอีกครั้ง');
    } catch (e) { toast.error(collectionsError(e)); } finally { setBusy(false); }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try { setImage(await fileToJpegDataUrl(file)); setNote(null); }
    catch { toast.error('อ่านไฟล์รูปไม่ได้'); }
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="modal" style={{ maxWidth: 480, width: '100%' }} role="dialog" aria-modal="true" aria-label="รับเงิน">
        <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="modal-title">รับเงิน · {charge.room_number ? `${charge.kind.startsWith('stall') ? 'แผง' : 'ห้อง'} ${charge.room_number}` : charge.party_name}</span>
          <button className="btn-icon" onClick={onClose} disabled={busy} aria-label="ปิด"><X size={18} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ ...box, background: 'var(--color-gray-50, #F4F7FB)' }}>
            <span style={{ fontSize: '0.85rem' }}>{charge.description || charge.party_name}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span>ยอด {baht(charge.amount_satang)}{charge.paid_satang > 0 ? ` · รับแล้ว ${baht(charge.paid_satang)}` : ''}</span>
              <strong style={{ fontSize: '1.25rem' }}>ต้องเก็บ ฿{baht(left)}</strong>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button className={method === 'cash' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setMethod('cash')} style={big} aria-pressed={method === 'cash'}><Banknote size={18} /> เงินสด</button>
            <button className={method === 'transfer' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setMethod('transfer')} style={big} aria-pressed={method === 'transfer'}><QrCode size={18} /> โอน</button>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: '0.8rem' }}>จำนวนเงินที่รับ (บาท) — แก้ได้ถ้าจ่ายไม่ครบ</span>
            <input style={field} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
            {!amountOk && amount !== '' && <span style={{ color: '#B91C1C', fontSize: '0.78rem' }}>ต้องมากกว่า 0 และไม่เกินยอดที่ต้องเก็บ</span>}
          </label>

          {method === 'cash' && (
            <button className="btn btn-primary" disabled={busy || !amountOk} onClick={() => void payManual('cash')} style={big}>
              {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={18} />} ยืนยันรับเงินสด ฿{shown}
            </button>
          )}

          {method === 'transfer' && (
            accounts.length === 0 ? (
              <div style={{ ...box, borderColor: '#F59E2E', background: '#FEF6EC' }}>ยังไม่มีบัญชีรับเงิน — เพิ่มที่หน้า "การชำระเงิน → บัญชีรับเงิน" ก่อน</div>
            ) : (
              <>
                {accounts.length > 1 && (
                  <select style={field} value={bankId} onChange={e => setBankId(e.target.value)} aria-label="บัญชีที่รับเงิน">
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.nickname || `${a.bank_short} ${a.account_name}`}</option>)}
                  </select>
                )}
                {account && amountOk && <BankQrCard account={account} amount={amountNum} title="ให้ผู้ค้าสแกนจ่าย" formatAmount={n => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`} />}

                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={e => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
                {!image ? (
                  <button className="btn btn-primary" disabled={busy} onClick={() => fileRef.current?.click()} style={big}>
                    <Camera size={18} /> ถ่ายรูปสลิป
                  </button>
                ) : (
                  <div style={{ ...box, alignItems: 'stretch' }}>
                    <img src={image} alt="รูปสลิป" style={{ maxHeight: 220, objectFit: 'contain', borderRadius: 8, background: '#F4F7FB' }} />
                    <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => fileRef.current?.click()} style={{ display: 'inline-flex', gap: 4, justifyContent: 'center', alignItems: 'center' }}><RefreshCw size={14} /> ถ่ายใหม่</button>
                    <button className="btn btn-primary" disabled={busy || !amountOk || !bankId} onClick={() => void confirmWithSlip()} style={big}>
                      {busy ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={18} />} ยืนยันรับโอน ฿{shown}
                    </button>
                  </div>
                )}
                {note && <div style={{ ...box, borderColor: '#F59E2E', background: '#FEF6EC', fontSize: '0.85rem' }}>{note}</div>}
                <button className="btn btn-outline" disabled={busy || !amountOk} onClick={() => void payManual('transfer')}>
                  ข้าม — ยืนยันรับโอนโดยไม่ถ่ายสลิป
                </button>
              </>
            )
          )}

          {onAbsent && (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={onAbsent} style={{ display: 'inline-flex', gap: 4, justifyContent: 'center', alignItems: 'center', color: '#557089' }}>
              <XCircle size={15} /> แผงนี้ไม่มาขายวันนี้
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
