import { QRCodeCanvas } from 'qrcode.react';
import './documents.css';
import horcareLogo from '../../assets/horcare_logo.png';
import type { MonthlyBill } from '../../types';
import { bankByCode, formatAccountNumber, type PayAccount } from '../../shared/banks';
import { paymentQrPayload } from '../../shared/thaiQr';
import { bahtText } from '../../shared/voucher';
import { invoiceDueDate, invoiceLines, invoiceNumber } from '../../shared/invoice';
import { thaiLongDate, type DocIssuer } from './docFormat';

const money = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const thaiMonth = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

/**
 * ใบแจ้งหนี้ — the bill as a real document: issuer, billed-to, invoice number and dates, line items with meter
 * readings, total in figures and words, how to pay (Thai QR with the amount), and a PAID stamp once settled.
 */
export function InvoiceDocument({ bill, issuer, tenantName, unitWord = 'ห้อง', dueDay, payTo }: {
  bill: MonthlyBill;
  issuer: DocIssuer;
  tenantName?: string;
  unitWord?: string;
  dueDay?: number;
  payTo?: PayAccount | null;
}) {
  const lines = invoiceLines(bill);
  const total = Number(bill.total_bill) || 0;
  const paid = bill.payment_status === 'paid';
  const issued = (bill.created_at || bill.updated_at || '').slice(0, 10) || `${bill.month}-01`;
  let qr: string | null = null;
  if (!paid && payTo && total > 0) { try { qr = paymentQrPayload(payTo, total); } catch { qr = null; } }
  const bank = payTo ? bankByCode(payTo.bank_code) : undefined;

  return (
    <>
      <header className="doc-head doc-block">
        <div className="doc-issuer">
          <img className="doc-logo" src={issuer.logo || horcareLogo} alt="" />
          <div style={{ minWidth: 0 }}>
            <div className="doc-issuer-name">{issuer.name || 'หอพัก'}</div>
            {issuer.address && <div className="doc-issuer-line">{issuer.address}</div>}
            {issuer.phone && <div className="doc-issuer-line">โทร. {issuer.phone}</div>}
          </div>
        </div>
        <div className="doc-head-side">
          <div className="doc-kind">ใบแจ้งหนี้</div>
          <div className="doc-kind-en">Invoice</div>
        </div>
      </header>

      <div className="doc-meta doc-block">
        <div className="doc-box">
          <div className="doc-box-label">เรียกเก็บจาก</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>{tenantName || `ผู้เช่า${unitWord} ${bill.room_number}`}</div>
          <div>{unitWord} <b>{bill.room_number}</b></div>
          <div style={{ color: '#4B5563' }}>ค่าบริการประจำเดือน {thaiMonth(bill.month)}</div>
        </div>
        <div className="doc-box">
          <dl className="doc-kv" style={{ margin: 0 }}>
            <dt>เลขที่</dt><dd className="doc-num">{invoiceNumber(bill)}</dd>
            <dt>วันที่ออก</dt><dd>{thaiLongDate(issued)}</dd>
            <dt>ครบกำหนดชำระ</dt><dd>{thaiLongDate(invoiceDueDate(bill.month, dueDay))}</dd>
          </dl>
        </div>
      </div>

      <table className="doc-lines">
        <thead>
          <tr className="doc-block">
            <th className="c" style={{ width: 44 }}>#</th>
            <th>รายการ</th>
            <th className="r" style={{ width: 90, whiteSpace: 'nowrap' }}>จำนวน</th>
            <th className="r col-rate" style={{ width: 100 }}>ราคา/หน่วย</th>
            <th className="r" style={{ width: 120 }}>จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="doc-block">
              <td className="c">{i + 1}</td>
              <td>{l.label}{l.detail && <span className="doc-line-note">{l.detail}</span>}</td>
              <td className="r doc-num">{l.qty !== undefined ? `${l.qty.toLocaleString('th-TH')} ${l.unit ?? ''}` : ''}</td>
              <td className="r doc-num col-rate">{l.rate !== undefined ? money(l.rate) : ''}</td>
              <td className="r doc-num" style={{ color: l.amount < 0 ? '#B42318' : undefined }}>{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="doc-totals doc-block">
        <div className="doc-words">
          <div className="doc-box-label">จำนวนเงิน (ตัวอักษร)</div>
          <b>({bahtText(Math.round(total * 100))})</b>
        </div>
        <table className="doc-sum">
          <tbody>
            <tr><td>รวม {lines.length} รายการ</td><td className="r doc-num">{money(total)}</td></tr>
            <tr className="grand"><td>ยอดชำระทั้งสิ้น</td><td className="r doc-num">฿{money(total)}</td></tr>
          </tbody>
        </table>
      </div>

      {bill.bill_note?.trim() && <div className="doc-note doc-block"><b>หมายเหตุ:</b> {bill.bill_note}</div>}

      {paid ? (
        <div className="doc-pay doc-block">
          <div>
            <div className="doc-box-label">การชำระเงิน</div>
            <div>ได้รับชำระแล้ว{bill.paid_at ? ` เมื่อ ${thaiLongDate(bill.paid_at)}` : ''}{bill.paid_amount ? ` จำนวน ${money(bill.paid_amount)} บาท` : ''}</div>
            {bill.transaction_ref && <div style={{ fontSize: 12, color: '#6B7280' }}>อ้างอิง {bill.transaction_ref}</div>}
          </div>
          <span className="doc-stamp">ชำระแล้ว<span className="doc-stamp-sub">PAID</span></span>
        </div>
      ) : payTo ? (
        <div className="doc-pay doc-block">
          <div>
            <div className="doc-box-label">ช่องทางชำระเงิน</div>
            <div><b>{bank?.name_th ?? payTo.bank_short}</b></div>
            {payTo.account_number && <div>เลขที่บัญชี <b className="doc-num">{formatAccountNumber(payTo.account_number)}</b></div>}
            <div>ชื่อบัญชี {payTo.account_name}</div>
            {payTo.promptpay_id && <div>พร้อมเพย์ <span className="doc-num">{payTo.promptpay_id}</span></div>}
            <div style={{ fontSize: 12.5, color: '#4B5563', marginTop: 6 }}>สแกน QR เพื่อชำระพร้อมยอดเงิน แล้วส่งสลิปผ่าน LINE หรือหน้าพอร์ทัลผู้เช่า</div>
          </div>
          {qr && <QRCodeCanvas value={qr} size={104} level="M" />}
        </div>
      ) : null}

      <div className="doc-signs doc-signs--compact doc-block">
        <div />
        <div className="doc-sign">
          <div className="doc-sign-img" />
          <div className="doc-sign-line" />
          <div className="doc-sign-name">( {issuer.name || 'ผู้รับเงิน'} )</div>
          <div className="doc-sign-role">ผู้ออกเอกสาร</div>
        </div>
      </div>

      <footer className="doc-foot doc-foot--compact doc-block">
        <span>เอกสารนี้ออกโดยระบบ HorCare · หากชำระแล้วโปรดเก็บหลักฐานการโอนไว้</span>
        <span className="doc-code">{invoiceNumber(bill)}</span>
      </footer>
    </>
  );
}
