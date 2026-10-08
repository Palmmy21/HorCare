import { useState } from 'react';
import { BookOpenCheck, FileSpreadsheet, Settings2, Wallet } from 'lucide-react';
import type { Building } from '../../types';
import { useMangoProfiles } from '../../hooks/useAccountingData';
import MangoExportTab from './MangoExportTab';
import MangoSettingsTab from './MangoSettingsTab';
import RecordPaymentTab from './RecordPaymentTab';

type Tab = 'export' | 'settings' | 'payment';

export default function AccountingPage({ ownerUid, buildings }: { ownerUid: string; buildings: Building[] }) {
    const { profiles, loading, error } = useMangoProfiles(ownerUid);
    const [tab, setTab] = useState<Tab>('export');
    const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: 'export', label: 'ส่งออก Mango', icon: FileSpreadsheet },
        { id: 'settings', label: 'ตั้งค่า Mango', icon: Settings2 },
        { id: 'payment', label: 'บันทึกรับชำระแบบตัดหลายบิล', icon: Wallet },
    ];
    return (
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', display: 'flex', gap: 8, alignItems: 'center' }}><BookOpenCheck size={26} /> บัญชี · Export สำหรับ Mango</h1>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                    สร้างไฟล์ตั้งลูกหนี้และตัดลูกหนี้จากบิลและการรับชำระจริง แล้วนำเข้า Mango เอง — HorCare ยังไม่ส่งเข้า Mango โดยตรง
                </p>
            </div>
            <div style={{ display: 'inline-flex', flexWrap: 'wrap', background: 'var(--color-gray-100)', borderRadius: 'var(--radius-md)', padding: 3, gap: 3, alignSelf: 'flex-start' }}>
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} aria-pressed={tab === t.id} style={{
                        border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '0.45rem 0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                        fontSize: '0.8125rem', fontWeight: 600, background: tab === t.id ? 'var(--color-white)' : 'transparent',
                        color: tab === t.id ? 'var(--color-gray-800)' : 'var(--color-gray-500)', boxShadow: tab === t.id ? 'var(--shadow-sm)' : 'none',
                    }}><t.icon size={14} /> {t.label}</button>
                ))}
            </div>
            {error && <div style={{ color: '#B91C1C' }}>คุณไม่มีสิทธิ์ดูข้อมูลบัญชี หรือโหลดไม่สำเร็จ</div>}
            {!loading && tab === 'export' && <MangoExportTab ownerUid={ownerUid} profiles={profiles} />}
            {!loading && tab === 'settings' && <MangoSettingsTab ownerUid={ownerUid} buildings={buildings} profiles={profiles} />}
            {tab === 'payment' && <RecordPaymentTab ownerUid={ownerUid} buildings={buildings} />}
        </div>
    );
}
