import { useState } from 'react';
import { BarChart3, LineChart, Wallet } from 'lucide-react';
import type { Building } from '../../types';
import RecordPaymentTab from './RecordPaymentTab';
import FinanceOverviewTab from './FinanceOverviewTab';

type Tab = 'overview' | 'payment';

/** The money picture across a property (charts) and recording payments that settle several bills. */
export default function AccountingPage({ ownerUid, buildings }: { ownerUid: string; buildings: Building[] }) {
    const [tab, setTab] = useState<Tab>('overview');
    const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: 'overview', label: 'ภาพรวมการเงิน', icon: BarChart3 },
        { id: 'payment', label: 'บันทึกรับชำระแบบตัดหลายบิล', icon: Wallet },
    ];
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="page-header" style={{ marginBottom: 0 }}>
                <h1 className="page-title" style={{ display: 'flex', gap: 8, alignItems: 'center' }}><LineChart size={24} /> ภาพรวมการเงิน</h1>
                <p className="page-subtitle">ยอดเรียกเก็บ รับเงินจริง และยอดค้าง — ลงบัญชีอยู่ที่หน้า "สมุดบัญชี"</p>
            </div>
            <div className="seg" role="tablist" aria-label="ภาพรวมการเงิน" style={{ alignSelf: 'flex-start', marginBottom: 0 }}>
                {tabs.map(t => (
                    <button key={t.id} role="tab" aria-selected={tab === t.id} className={`seg-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                        <t.icon size={14} /> {t.label}
                    </button>
                ))}
            </div>
            {tab === 'overview' && <FinanceOverviewTab ownerUid={ownerUid} buildings={buildings} />}
            {tab === 'payment' && <RecordPaymentTab ownerUid={ownerUid} buildings={buildings} />}
        </div>
    );
}
