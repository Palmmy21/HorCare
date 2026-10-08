import { Landmark, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import BankLogo from '../Payments/BankLogo';
import { bankByCode, formatAccountNumber } from '../../shared/banks';
import type { TenantAccount } from '../../hooks/useTenantBankAccounts';

interface Props {
  accounts: TenantAccount[];
  Label: React.ComponentType<{ icon: React.ReactNode; label: string }>;
}

/** Bank accounts the tenant can transfer rent to. Renders nothing while loading, on error, or when none are set up. */
export default function TenantBankSection({ accounts, Label }: Props) {
  if (accounts.length === 0) return null;

  const copy = (n: string) => {
    navigator.clipboard?.writeText(n).then(() => toast.success('คัดลอกเลขบัญชีแล้ว'), () => toast.error('คัดลอกไม่สำเร็จ'));
  };

  return (
    <section>
      <Label icon={<Landmark size={14} />} label="โอนเงินเข้าบัญชี" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
        {accounts.map(a => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', borderRadius: 12, background: 'var(--card-bg, #fff)', border: '1px solid rgba(0,0,0,0.08)' }}>
            <BankLogo short={a.bank_short} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.8rem', opacity: 0.7 }}>{bankByCode(a.bank_code)?.name_th ?? a.bank_short}{a.nickname ? ` · ${a.nickname}` : ''}</div>
              <div style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.03em' }}>{formatAccountNumber(a.account_number)}</div>
              <div style={{ fontSize: '0.8rem', overflowWrap: 'anywhere' }}>{a.account_name}</div>
            </div>
            <button type="button" onClick={() => copy(a.account_number)} aria-label="คัดลอกเลขบัญชี"
              style={{ border: 'none', background: 'rgba(0,0,0,0.06)', borderRadius: 8, padding: '0.5rem', cursor: 'pointer' }}>
              <Copy size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}