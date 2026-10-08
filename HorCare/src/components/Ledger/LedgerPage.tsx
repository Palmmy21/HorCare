import { useState } from 'react';
import { BarChart3, BookOpen, FileBarChart, ListOrdered, Send, Settings2 } from 'lucide-react';
import type { Building } from '../../types';
import { useLedgerEntries, useLedgers } from '../../hooks/useLedgerData';
import PostingTab from './PostingTab';
import JournalTab from './JournalTab';
import ReportsTab from './ReportsTab';
import LedgerSettingsTab from './LedgerSettingsTab';
import FinanceOverviewTab from '../Accounting/FinanceOverviewTab';

type Tab = 'overview' | 'post' | 'journal' | 'reports' | 'settings';

export default function LedgerPage({ ownerUid, buildings }: { ownerUid: string; buildings: Building[] }) {
    const { ledgers, loading, error } = useLedgers(ownerUid);
    const [selected, setSelected] = useState('');
    const [tab, setTab] = useState<Tab>('overview');
    const current = ledgers.find(l => l.id === selected) ?? ledgers[0];
    const { entries, loading: entriesLoading } = useLedgerEntries(ownerUid, current?.id ?? null);

    const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: 'overview', label: 'ภาพรวม (กราฟ)', icon: BarChart3 },
        { id: 'post', label: 'ลงบัญชี', icon: Send },
        { id: 'journal', label: 'สมุดรายวัน', icon: ListOrdered },
        { id: 'reports', label: 'รายงาน', icon: FileBarChart },
        { id: 'settings', label: 'ตั้งค่า', icon: Settings2 },
    ];
    const activeTab: Tab = current || tab === 'overview' ? tab : 'settings';
    // the charts follow the properties of the selected ledger; with no ledger yet they cover every property
    const chartBuildings = current ? buildings.filter(b => current.property_ids.includes(b.id)) : buildings;

    return (
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
                <h1 style={{ margin: 0, fontSize: '1.4rem', display: 'flex', gap: 8, alignItems: 'center' }}><BookOpen size={26} /> สมุดบัญชี</h1>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--color-gray-500)' }}>
                    บัญชีบริหารของ HorCare — ลงรายการจากบิลและเงินที่รับจริง ดูรายงาน และส่งออกไประบบบัญชีอื่น รายการที่ลงแล้วแก้ไม่ได้ แก้ด้วยการกลับรายการ
                </p>
            </div>
            <div style={{ display: 'inline-flex', flexWrap: 'wrap', background: 'var(--color-gray-100)', borderRadius: 'var(--radius-md)', padding: 3, gap: 3, alignSelf: 'flex-start' }}>
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} aria-pressed={activeTab === t.id} disabled={!current && t.id !== 'settings' && t.id !== 'overview'} style={{
                        border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '0.45rem 0.9rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                        fontSize: '0.8125rem', fontWeight: 600, background: activeTab === t.id ? 'var(--color-white)' : 'transparent',
                        color: activeTab === t.id ? 'var(--color-gray-800)' : 'var(--color-gray-500)', boxShadow: activeTab === t.id ? 'var(--shadow-sm)' : 'none',
                    }}><t.icon size={14} /> {t.label}</button>
                ))}
            </div>
            {ledgers.length > 1 && activeTab !== 'settings' && (
                <select value={current?.id} onChange={e => setSelected(e.target.value)} aria-label="สมุดบัญชี" style={{ alignSelf: 'flex-start', padding: '0.45rem 0.6rem', borderRadius: 8, border: '1px solid var(--color-gray-300, #D1D5DB)' }}>
                    {ledgers.map(l => <option key={l.id} value={l.id}>{l.name || l.legal_entity_name}</option>)}
                </select>
            )}
            {error && <div style={{ color: '#B91C1C' }}>คุณไม่มีสิทธิ์ดูสมุดบัญชี หรือโหลดไม่สำเร็จ</div>}
            {activeTab === 'overview' && <FinanceOverviewTab key={current?.id ?? 'all'} ownerUid={ownerUid} buildings={chartBuildings.length ? chartBuildings : buildings} />}
            {!loading && activeTab === 'settings' && <LedgerSettingsTab ownerUid={ownerUid} buildings={buildings} ledgers={ledgers} selectedId={selected || current?.id || 'new'} onSelect={setSelected} />}
            {current && activeTab === 'post' && <PostingTab ownerUid={ownerUid} ledger={current} />}
            {current && activeTab === 'journal' && (entriesLoading ? <div>กำลังโหลด…</div> : <JournalTab ownerUid={ownerUid} ledger={current} entries={entries} />)}
            {current && activeTab === 'reports' && (entriesLoading ? <div>กำลังโหลด…</div> : <ReportsTab ownerUid={ownerUid} ledger={current} entries={entries} />)}
        </div>
    );
}
