import { QRCodeCanvas } from 'qrcode.react';
import './documents.css';
import horcareLogo from '../../assets/horcare_logo.png';
import type { BillLanguage, MonthlyBill } from '../../types';
import { bankByCode, formatAccountNumber, type PayAccount } from '../../shared/banks';
import { paymentQrPayload } from '../../shared/thaiQr';
import { bahtText } from '../../shared/voucher';
import { invoiceDueDate, invoiceLines, invoiceNumber, type InvoiceLine } from '../../shared/invoice';
import { thaiLongDate, type DocIssuer } from './docFormat';
import { fill, invoiceText, type InvoiceText } from './invoiceText';

const money = (n: number) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The tenant's locale when this browser can write dates in it (many can't do Burmese or Lao), else English. */
const dateLocale = (t: InvoiceText) => {
  try { return Intl.DateTimeFormat.supportedLocalesOf([t.locale]).length ? t.locale : 'en-GB'; } catch { return 'en-GB'; }
};
function longDate(iso: string, t: InvoiceText): string {
  if (t.locale === 'th-TH') return thaiLongDate(iso);
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(dateLocale(t), { day: 'numeric', month: 'long', year: 'numeric' });
}
const monthName = (month: string, t: InvoiceText) =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString(dateLocale(t), { month: 'long', year: 'numeric' });

/**
 * ใบแจ้งหนี้ — the bill as a real document: issuer, billed-to, invoice number and dates, line items with meter
 * readings, total in figures and words, how to pay (Thai QR with the amount), and a PAID stamp once settled.
 *
 * Worded in the tenant's language; with `secondLang` (the property's bilingual mode) every label carries both.
 */
export function InvoiceDocument({ bill, issuer, tenantName, unitWord, dueDay, payTo, lang = 'th', secondLang }: {
  bill: MonthlyBill;
  issuer: DocIssuer;
  tenantName?: string;
  /** what the unit is called in Thai (ห้อง / บ้านเช่า / ที่ดิน); other languages use their own word */
  unitWord?: string;
  dueDay?: number;
  payTo?: PayAccount | null;
  lang?: BillLanguage;
  secondLang?: BillLanguage | null;
}) {
  const t = invoiceText(lang);
  const t2 = secondLang && secondLang !== lang ? invoiceText(secondLang) : null;
  /** a label, in both languages when bilingual */
  const L = (k: keyof InvoiceText, v: Record<string, string | number> = {}) =>
    t2 ? `${fill(t[k], v)} / ${fill(t2[k], v)}` : fill(t[k], v);
  const unit = lang === 'th' && unitWord ? unitWord : t.unit;

  const lines = invoiceLines(bill);
  const total = Number(bill.total_bill) || 0;
  const paid = bill.payment_status === 'paid';
  const issued = (bill.created_at || bill.updated_at || '').slice(0, 10) || `${bill.month}-01`;
  let qr: string | null = null;
  if (!paid && payTo && total > 0) { try { qr = paymentQrPayload(payTo, total); } catch { qr = null; } }
  const bank = payTo ? bankByCode(payTo.bank_code) : undefined;
  const thaiWords = lang === 'th' || secondLang === 'th';
  const no = invoiceNumber(bill);

  const lineLabel = (l: InvoiceLine) => (l.kind === 'fee' || l.kind === 'adjustment' ? l.label : L(l.kind));
  const lineNote = (l: InvoiceLine) =>
    l.from !== undefined && l.to !== undefined ? fill(t.meter, { from: l.from, to: l.to })
      : l.days && l.of ? fill(t.prorate, { days: l.days, of: l.of }) : undefined;

  return (
    <>
      <header className="doc-head doc-block">
        <div className="doc-issuer">
          <img className="doc-logo" src={issuer.logo || horcareLogo} alt="" />
          <div style={{ minWidth: 0 }}>
            <div className="doc-issuer-name">{issuer.name || 'HorCare'}</div>
            {issuer.address && <div className="doc-issuer-line">{issuer.address}</div>}
            {issuer.phone && <div className="doc-issuer-line">โทร. / Tel. {issuer.phone}</div>}
          </div>
        </div>
        <div className="doc-head-side">
          <div className="doc-kind">{t.title}</div>
          <div className="doc-kind-en">{t2 ? t2.title : lang === 'th' ? 'Invoice' : 'ใบแจ้งหนี้'}</div>
        </div>
      </header>

      <div className="doc-meta doc-block">
        <div className="doc-box">
          <div className="doc-box-label">{L('billed_to')}</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#111827' }}>{tenantName || fill(t.tenant_of, { unit, no: bill.room_number })}</div>
          <div>{unit} <b>{bill.room_number}</b></div>
          <div style={{ color: '#4B5563' }}>{fill(t.service_month, { month: monthName(bill.month, t) })}</div>
        </div>
        <div className="doc-box">
          <dl className="doc-kv" style={{ margin: 0 }}>
            <dt>{L('invoice_no')}</dt><dd className="doc-num">{no}</dd>
            <dt>{L('issued')}</dt><dd>{longDate(issued, t)}</dd>
            <dt>{L('due')}</dt><dd>{longDate(invoiceDueDate(bill.month, dueDay), t)}</dd>
          </dl>
        </div>
      </div>

      <table className="doc-lines">
        <thead>
          <tr className="doc-block">
            <th className="c" style={{ width: 44 }}>#</th>
            <th>{L('item')}</th>
            <th className="r" style={{ width: 96 }}>{L('qty')}</th>
            <th className="r col-rate" style={{ width: 104 }}>{L('rate')}</th>
            <th className="r" style={{ width: 124 }}>{L('amount')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const note = lineNote(l);
            return (
              <tr key={i} className="doc-block">
                <td className="c">{i + 1}</td>
                <td>{lineLabel(l)}{note && <span className="doc-line-note">{note}</span>}</td>
                <td className="r doc-num">{l.qty !== undefined ? `${l.qty.toLocaleString('th-TH')} ${t.unit_label}` : ''}</td>
                <td className="r doc-num col-rate">{l.rate !== undefined ? money(l.rate) : ''}</td>
                <td className="r doc-num" style={{ color: l.amount < 0 ? '#B42318' : undefined }}>{money(l.amount)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="doc-totals doc-block">
        {thaiWords ? (
          <div className="doc-words">
            <div className="doc-box-label">{L('amount_words')}</div>
            <b>({bahtText(Math.round(total * 100))})</b>
          </div>
        ) : <div />}
        <table className="doc-sum">
          <tbody>
            <tr><td>{fill(t.items_total, { n: lines.length })}</td><td className="r doc-num">{money(total)}</td></tr>
            <tr className="grand"><td>{L('grand_total')}</td><td className="r doc-num">฿{money(total)}</td></tr>
          </tbody>
        </table>
      </div>

      {bill.bill_note?.trim() && <div className="doc-note doc-block"><b>{L('note')}:</b> {bill.bill_note}</div>}

      {paid ? (
        <div className="doc-pay doc-block">
          <div>
            <div className="doc-box-label">{L('payment')}</div>
            <div>
              {bill.paid_at ? fill(t.paid_on, { date: longDate(bill.paid_at, t) }) : t.stamp}
              {bill.paid_amount ? ` · ${fill(t.paid_amount, { amount: money(bill.paid_amount) })}` : ''}
            </div>
            {bill.transaction_ref && <div style={{ fontSize: 12, color: '#6B7280' }}>{t.ref} {bill.transaction_ref}</div>}
          </div>
          <span className="doc-stamp">{t.stamp}<span className="doc-stamp-sub">{lang === 'en' ? 'ชำระแล้ว' : 'PAID'}</span></span>
        </div>
      ) : payTo ? (
        <div className="doc-pay doc-block">
          <div>
            <div className="doc-box-label">{L('channel')}</div>
            <div><b>{lang === 'th' ? bank?.name_th ?? payTo.bank_short : `${payTo.bank_short}${bank ? ` (${bank.name_th})` : ''}`}</b></div>
            {payTo.account_number && <div>{t.account_no} <b className="doc-num">{formatAccountNumber(payTo.account_number)}</b></div>}
            <div>{t.account_name} {payTo.account_name}</div>
            {payTo.promptpay_id && <div>{t.promptpay} <span className="doc-num">{payTo.promptpay_id}</span></div>}
            <div style={{ fontSize: 12.5, color: '#4B5563', marginTop: 6 }}>{L('scan_hint')}</div>
          </div>
          {qr && <QRCodeCanvas value={qr} size={104} level="M" />}
        </div>
      ) : null}

      <div className="doc-signs doc-signs--compact doc-block">
        <div />
        <div className="doc-sign">
          <div className="doc-sign-img" />
          <div className="doc-sign-line" />
          <div className="doc-sign-name">( {issuer.name || 'HorCare'} )</div>
          <div className="doc-sign-role">{L('issuer_role')}</div>
        </div>
      </div>

      <footer className="doc-foot doc-foot--compact doc-block">
        <span>{t.footer}</span>
        <span className="doc-code">{no}</span>
      </footer>
    </>
  );
}
