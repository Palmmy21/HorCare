import { Building2, Plus } from 'lucide-react';
import horcareLogo from '../../assets/horcare_logo.png';
import './BranchSelector.css';

interface Building {
  id: string;
  name: string;
  logo?: string;
}

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
          <p>กรุณาเลือกสาขาที่ต้องการจัดการในเซสชันนี้</p>
        </div>

        <div className="branch-grid">
          {buildings.map((b) => (
            <button
              key={b.id}
              className="branch-card"
              onClick={() => onSelect(b.id)}
            >
              <div className={`branch-card-icon ${b.logo ? 'has-logo' : ''}`}>
                {b.logo ? (
                  <img src={b.logo} alt={b.name} />
                ) : (
                  <Building2 size={28} />
                )}
              </div>
              <div className="branch-card-content">
                <h3>{b.name}</h3>
                <span>เข้าสู่ระบบจัดการ &rarr;</span>
              </div>
            </button>
          ))}

          {canAddBuilding && (
            <button className="branch-card add-branch-card" onClick={onAddBuilding}>
              <div className="branch-card-icon add-icon">
                <Plus size={28} />
              </div>
              <div className="branch-card-content">
                <h3>เพิ่มสาขาใหม่</h3>
                <span>สร้างหอพักใหม่</span>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
