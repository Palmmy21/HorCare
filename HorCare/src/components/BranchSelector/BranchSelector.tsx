import { Building2, Store, Plus } from 'lucide-react';
import horcareLogo from '../../assets/horcare_logo.png';
import type { Building } from '../../types';
import './BranchSelector.css';

interface BranchSelectorProps {
  buildings: Building[];
  onSelect: (id: string) => void;
  canAddBuilding: boolean;
  onAddBuilding: () => void;
  userName: string;
}

export default function BranchSelector({
  buildings,
  onSelect,
  canAddBuilding,
  onAddBuilding,
  userName: _userName
}: BranchSelectorProps) {
  return (
    <div className="branch-selector-overlay">
      <div className="branch-selector-container">
        <div className="branch-selector-header">
          <div className="branch-selector-logo-wrapper">
            <img src={horcareLogo} alt="HorCare Logo" className="branch-selector-logo" />
          </div>
          <h2>ยินดีต้อนรับเข้าสู่ HorCare</h2>
          <p>กรุณาเลือกสาขาหรืออสังหาริมทรัพย์ที่ต้องการจัดการในเซสชันนี้</p>
        </div>

        <div className="branch-grid">
          {buildings.map((b) => {
            const isMarket = b.building_type === 'market';
            const isCommercial = b.building_type === 'commercial';
            return (
              <button
                key={b.id}
                className="branch-card"
                onClick={() => onSelect(b.id)}
              >
                <div className={`branch-card-icon ${b.logo ? 'has-logo' : ''}`}>
                  {b.logo ? (
                    <img src={b.logo} alt={b.name} />
                  ) : isMarket ? (
                    <Store size={28} color="#D97706" />
                  ) : isCommercial ? (
                    <Building2 size={28} color="#2563EB" />
                  ) : (
                    <Building2 size={28} />
                  )}
                </div>
                <div className="branch-card-content">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', justifyContent: 'center' }}>
                    <h3>{b.name}</h3>
                    {isMarket && (
                      <span style={{
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        background: '#FEF3C7',
                        color: '#B45309',
                        padding: '0.1rem 0.4rem',
                        borderRadius: '999px',
                        border: '1px solid #FDE68A',
                      }}>
                        ตลาด
                      </span>
                    )}
                  </div>
                  <span>เข้าสู่ระบบจัดการ &rarr;</span>
                </div>
              </button>
            );
          })}

          {canAddBuilding && (
            <button className="branch-card add-branch-card" onClick={onAddBuilding}>
              <div className="branch-card-icon add-icon">
                <Plus size={28} />
              </div>
              <div className="branch-card-content">
                <h3>เพิ่มสาขาใหม่</h3>
                <span>หอพัก / ตลาด / อสังหาฯ</span>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
