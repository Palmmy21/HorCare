import { useState } from 'react';
import type { Room, Fine, CommonFee } from '../../types';
import { HardHat, Package, Layers, Receipt, AlertTriangle, Building2 } from 'lucide-react';
import VendorsTab from './VendorsTab';
import StockTab from './StockTab';
import AssetsTab from './AssetsTab';
import ExpensesTab from './ExpensesTab';
import FinesTab from './FinesTab';
import CommonFeesTab from './CommonFeesTab';

interface Props {
  uid: string;
  buildingId: string;
  rooms: Room[];
  lowStockCount?: number;
  fines: Fine[];
  commonFees: CommonFee[];
  onAddFine: (data: Omit<Fine, 'id' | 'created_at'>) => Promise<void>;
  onUpdateFine: (fineId: string, updates: Partial<Fine>) => Promise<void>;
  onDeleteFine: (fineId: string) => Promise<void>;
  onAddCommonFee: (data: Omit<CommonFee, 'id' | 'created_at'>) => Promise<void>;
  onUpdateCommonFee: (feeId: string, updates: Partial<CommonFee>) => Promise<void>;
  onDeleteCommonFee: (feeId: string) => Promise<void>;
}

type Tab = 'vendors' | 'stock' | 'assets' | 'expenses' | 'fines' | 'common_fees';

export default function OperationsPage({
  uid, buildingId, rooms, lowStockCount = 0,
  fines, commonFees,
  onAddFine, onUpdateFine, onDeleteFine,
  onAddCommonFee, onUpdateCommonFee, onDeleteCommonFee,
}: Props) {
  const [tab, setTab] = useState<Tab>('vendors');

  const unpaidFinesCount = fines.filter(f => f.status === 'unpaid').length;

  const tabs: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'vendors',     label: 'ผู้รับเหมา', Icon: HardHat },
    { id: 'stock',       label: 'สต็อก',      Icon: Package },
    { id: 'assets',      label: 'ทรัพย์สิน',  Icon: Layers  },
    { id: 'expenses',    label: 'ค่าใช้จ่าย', Icon: Receipt },
    { id: 'fines',       label: 'ค่าปรับ',    Icon: AlertTriangle },
    { id: 'common_fees', label: 'ส่วนกลาง',   Icon: Building2 },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">ระบบจัดการ</h1>
        <p className="page-subtitle">ผู้รับเหมา · สต็อกวัสดุ · ทรัพย์สิน · ค่าใช้จ่าย · ค่าปรับ · ส่วนกลาง</p>
      </div>

      {/* Tab bar */}
      <div className="card mb-6" style={{ padding: '0.5rem', display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
        {tabs.map(t => {
          const active = tab === t.id;
          const showStockBadge = t.id === 'stock' && lowStockCount > 0;
          const showFinesBadge = t.id === 'fines' && unpaidFinesCount > 0;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                flex: 1, minWidth: 'calc(33.333% - 0.5rem)',
                padding: '0.625rem 0.5rem', borderRadius: '10px', cursor: 'pointer',
                border: active ? '1.5px solid var(--color-primary, #8B5CF6)' : '1.5px solid transparent',
                background: active ? 'rgba(139,92,246,0.1)' : 'none',
                color: active ? 'var(--color-primary, #8B5CF6)' : 'var(--color-text-muted, #6B7280)',
                fontWeight: active ? 700 : 500, fontSize: '0.8125rem',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem',
                transition: 'all 0.15s', position: 'relative',
              }}
            >
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <t.Icon size={18} />
                {(showStockBadge || showFinesBadge) && (
                  <span style={{
                    position: 'absolute', top: -3, right: -5,
                    minWidth: 14, height: 14, borderRadius: 7,
                    background: '#EF4444', color: '#fff',
                    fontSize: '0.6rem', fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px',
                    border: '1.5px solid var(--color-white, #fff)',
                  }}>
                    {showStockBadge ? (lowStockCount > 9 ? '9+' : lowStockCount) : (unpaidFinesCount > 9 ? '9+' : unpaidFinesCount)}
                  </span>
                )}
              </span>
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'vendors'     && <VendorsTab  uid={uid} buildingId={buildingId} />}
      {tab === 'stock'       && <StockTab    uid={uid} buildingId={buildingId} />}
      {tab === 'assets'      && <AssetsTab   uid={uid} buildingId={buildingId} rooms={rooms} />}
      {tab === 'expenses'    && <ExpensesTab uid={uid} buildingId={buildingId} />}
      {tab === 'fines'       && (
        <FinesTab
          uid={uid}
          buildingId={buildingId}
          rooms={rooms}
          fines={fines}
          onAdd={onAddFine}
          onUpdate={onUpdateFine}
          onDelete={onDeleteFine}
        />
      )}
      {tab === 'common_fees' && (
        <CommonFeesTab
          uid={uid}
          buildingId={buildingId}
          commonFees={commonFees}
          onAdd={onAddCommonFee}
          onUpdate={onUpdateCommonFee}
          onDelete={onDeleteCommonFee}
        />
      )}
    </div>
  );
}
