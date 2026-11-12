import { useState } from 'react';
import type { Building } from '../../types';
import RevenueAudit from './RevenueAudit';

/**
 * The revenue audit with a branch picker, markets first: used in ภาพรวมการเงิน and in สมุดบัญชี, so whoever keeps the
 * books checks "expected vs collected" where they already work. `marketsOnly` lists only market branches.
 */
export default function RevenueAuditPanel({ ownerUid, buildings, marketsOnly = false }: { ownerUid: string; buildings: Building[]; marketsOnly?: boolean }) {
    const auditable = [...buildings]
        .filter(b => !marketsOnly || b.building_type === 'market')
        .sort((a, b) => Number(b.building_type === 'market') - Number(a.building_type === 'market') || a.order - b.order);
    const [auditId, setAuditId] = useState<string>(auditable[0]?.id ?? '');
    const audited = auditable.find(b => b.id === auditId) ?? auditable[0];
    if (!audited) return <div style={{ color: 'var(--color-gray-500)' }}>ยังไม่มีสาขาที่เป็นตลาด — ตรวจยอดรายได้ใช้กับสาขาประเภทตลาด</div>;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {auditable.length > 1 && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="form-label" style={{ margin: 0 }}>สาขา</span>
                    <select className="form-input" style={{ maxWidth: 320 }} value={audited.id} onChange={e => setAuditId(e.target.value)}>
                        {auditable.map(b => <option key={b.id} value={b.id}>{b.name}{b.building_type === 'market' ? ' (ตลาด)' : ''}</option>)}
                    </select>
                </label>
            )}
            <RevenueAudit key={audited.id} ownerUid={ownerUid} buildingId={audited.id} dormName={audited.name} />
        </div>
    );
}
