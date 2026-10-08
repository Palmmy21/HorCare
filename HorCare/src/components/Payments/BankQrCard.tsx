import { QRCodeSVG } from 'qrcode.react';
import { CreditCard } from 'lucide-react';
import { bankByCode, type PayAccount } from '../../shared/banks';
import { paymentQrPayload } from '../../shared/thaiQr';
import BankLogo from './BankLogo';

interface Props {
  account: PayAccount;
  amount: number;
  /** Heading above the code, e.g. "Scan to pay". */
  title: string;
  /** Formats the amount the way the page does (currency symbol, language). */
  formatAmount: (n: number) => string;
}

/**
 * Scan-to-pay card: a Thai QR built from the property's receiving account (a PromptPay code when the account has a
 * PromptPay id, otherwise a bank-account code), with the amount filled in. Draws nothing if the account cannot form a
 * valid code, so a broken setup never shows a QR that would fail at the bank.
 */
export default function BankQrCard({ account, amount, title, formatAmount }: Props) {
  let payload: string;
  try { payload = paymentQrPayload(account, amount); } catch { return null; }
  const bank = bankByCode(account.bank_code);
  return (
    <div style={{
      background: 'linear-gradient(135deg, #034A6E 0%, #0369A1 100%)', borderRadius: '20px', padding: '1.25rem', color: '#FFFFFF',
      boxShadow: '0 8px 24px -4px rgba(3, 105, 161, 0.35)', marginTop: '0.75rem', textAlign: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.8125rem', fontWeight: 700, color: 'rgba(255,255,255,0.9)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.875rem' }}>
        <CreditCard size={14} /> {title}
      </div>
      <div style={{ background: '#FFFFFF', borderRadius: '16px', padding: '0.875rem', display: 'inline-block', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
        <QRCodeSVG value={payload} size={168} level="M" />
      </div>
      <div style={{ marginTop: '0.875rem' }}>
        <div style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#38BDF8' }}>{formatAmount(amount)}</div>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.85)', marginTop: '0.35rem', display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          <BankLogo short={account.bank_short} size={20} />
          <span>{bank?.name_th ?? account.bank_short}</span>
          <span>· {account.account_name}</span>
        </div>
      </div>
    </div>
  );
}