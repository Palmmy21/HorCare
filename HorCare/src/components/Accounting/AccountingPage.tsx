import { useState } from 'react';
import { BarChart3, LineChart, ShieldCheck, Wallet } from 'lucide-react';
import type { Building } from '../../types';
import RecordPaymentTab from './RecordPaymentTab';
import FinanceOverviewTab from './FinanceOverviewTab';
import RevenueAudit from '../Market/RevenueAudit';

type Tab = 'overview' | 'payment' | 'audit';

/** The money picture across a property (charts), recording payments that settle several bills, and the revenue audit. */
export default function AccountingPage({ ownerUid, buildings }: { ownerUid: string; buildings: Building[] }) {
    const [tab, setTab] = useState<Tab>('overview');
    // markets first: the audit was made for stalls (zones, the round), but any property's monthly rent can be checked
    const auditable = [...buildings].sort((a, b) => Number(b.building_type === 'market') - Number(a.building_type === 'market') || a.order - b.order);
    const [auditId, setAuditId] = useState<string>(auditable[0]?.id ?? '');
    const audited = auditable.find(b => b.id === auditId) ?? auditable[0];
    const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: 'overview', label: 'ภาพรวมการเงิน', icon: BarChart3 },
        { id: 'payment', label: 'บันทึกรับชำระแบบตัดหลายบิล', icon: Wallet },
        ...(auditable.length ? [{ id: 'audit' as Tab, label: 'ตรวจยอดรายได้', icon: ShieldCheck }] : []),
    ];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="page-header" style={{ marginBottom: 0 }}>
                <h1 className="page-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><LineChart size={24} /> ภาพรวมการเงิน</h1>
                <p className="page-subtitle">ยอดเรียกเก็บ รับเงินจริง ยอดค้าง และตรวจยอดว่าเงินหายไปตรงไหน — ลงบัญชีอยู่ที่หน้า "สมุดบัญชี"</p>
            </div>
            <div className="seg" role="tablist" aria-label="ภาพรวมการเงิน" style={{ alignSelf: 'flex-start', marginBottom: 0, flexWrap: 'wrap' }}>
                {tabs.map(t => (
                    <button key={t.id} role="tab" aria-selected={tab === t.id} className={`seg-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                        <t.icon size={14} /> {t.label}
                    </button>
                ))}
            </div>
            {tab === 'overview' && <FinanceOverviewTab ownerUid={ownerUid} buildings={buildings} />}
            {tab === 'payment' && <RecordPaymentTab ownerUid={ownerUid} buildings={buildings} />}
            {tab === 'audit' && audited && (
                <>
                    {auditable.length > 1 && (
                        <label style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="form-label" style={{ margin: 0 }}>สาขา</span>
                            <select className="form-input" style={{ maxWidth: 320 }} value={audited.id} onChange={e => setAuditId(e.target.value)}>
                                {auditable.map(b => <option key={b.id} value={b.id}>{b.name}{b.building_type === 'market' ? ' (ตลาด)' : ''}</option>)}
                            </select>
                        </label>
                    )}
                    <RevenueAudit key={audited.id} ownerUid={ownerUid} buildingId={audited.id} dormName={audited.name} />
                </>
            )}
        </div>
    );
}
