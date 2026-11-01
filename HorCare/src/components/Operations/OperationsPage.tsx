import { lazy, Suspense } from 'react';
import type { Room, Fine, CommonFee } from '../../types';
import { HardHat, Package, Layers, Receipt, AlertTriangle, Building2, Wrench, ClipboardCheck, Sparkles, Users, MessageCircle } from 'lucide-react';
import StaffTeamTab from './StaffTeamTab';
import { canOpenOpsTab, type OpsTab } from '../../shared/viewAccess';
import type { Permission } from '../../shared/permissions';
import VendorsTab from './VendorsTab';
import StockTab from './StockTab';
import AssetsTab from './AssetsTab';
import ExpensesTab from './ExpensesTab';
import FinesTab from './FinesTab';
import CommonFeesTab from './CommonFeesTab';

// The service work lives here too (it used to be three separate menu entries)
const MaintenancePage = lazy(() => import('../Maintenance/MaintenancePage'));
const WorkOrdersPage = lazy(() => import('../WorkOrders/WorkOrdersPage'));
const CleaningPage = lazy(() => import('../Cleaning/CleaningPage'));

export type { OpsTab };

interface Props {
  uid: string;
  buildingId: string;
  rooms: Room[];
  unitName: string;
  tab: OpsTab;
  onTabChange: (tab: OpsTab) => void;
  /** null = the owner (everything) */
  permissions: readonly Permission[] | null;
  /** Housekeeping needs a paid plan */
  cleaningAvailable: boolean;
  isMarket: boolean;
  counts: { maintenance: number; cleaning: number; stock: number };
  fines: Fine[];
  commonFees: CommonFee[];
  onAddFine: (data: Omit<Fine, 'id' | 'created_at'>) => Promise<void>;
  onUpdateFine: (fineId: string, updates: Partial<Fine>) => Promise<void>;
  onDeleteFine: (fineId: string) => Promise<void>;
  onAddCommonFee: (data: Omit<CommonFee, 'id' | 'created_at'>) => Promise<void>;
  onUpdateCommonFee: (feeId: string, updates: Partial<CommonFee>) => Promise<void>;
  onDeleteCommonFee: (feeId: string) => Promise<void>;
}

interface TabDef { id: OpsTab; label: string; Icon: React.ComponentType<{ size?: number }>; badge?: number }


/** ระบบจัดการ: service work (repairs, work orders, housekeeping) and the property's back office, as tabs. */
export default function OperationsPage(props: Props) {
  const { uid, buildingId, rooms, tab, onTabChange, permissions, counts, fines } = props;
  const unpaidFines = fines.filter(f => f.status === 'unpaid').length;
  const can = (t: OpsTab) => canOpenOpsTab(t, permissions) && (t !== 'cleaning' || props.cleaningAvailable);

  const allGroups: { label: string; tabs: TabDef[] }[] = [
    {
      label: 'งานบริการ',
      tabs: [
        { id: 'maintenance', label: 'แจ้งซ่อม', Icon: Wrench, badge: counts.maintenance },
        { id: 'workorders', label: 'ใบงาน', Icon: ClipboardCheck },
        { id: 'cleaning', label: props.isMarket ? 'ดูแลตลาด/ขยะ' : 'งานแม่บ้าน', Icon: Sparkles, badge: counts.cleaning },
        { id: 'team', label: 'ทีมช่าง/แม่บ้าน', Icon: Users },
      ],
    },
    {
      label: 'ข้อมูลอาคาร',
      tabs: [
        { id: 'vendors', label: 'ผู้รับเหมา', Icon: HardHat },
        { id: 'stock', label: 'สต็อก', Icon: Package, badge: counts.stock },
        { id: 'assets', label: 'ทรัพย์สิน', Icon: Layers },
        { id: 'expenses', label: 'ค่าใช้จ่าย', Icon: Receipt },
        { id: 'fines', label: 'ค่าปรับ', Icon: AlertTriangle, badge: unpaidFines },
        { id: 'common_fees', label: 'ส่วนกลาง', Icon: Building2 },
      ],
    },
  ];
  const groups = allGroups.map(g => ({ ...g, tabs: g.tabs.filter(t => can(t.id)) })).filter(g => g.tabs.length > 0);

  const allowed = groups.flatMap(g => g.tabs.map(t => t.id));
  // a tab this account may not open (or that does not exist for it) falls back to the first one it may
  const active: OpsTab | undefined = allowed.includes(tab) ? tab : allowed[0];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">ระบบจัดการ</h1>
        <p className="page-subtitle">งานซ่อม ใบงานช่าง งานแม่บ้าน และข้อมูลอาคาร ในที่เดียว</p>
      </div>

      <nav className="ops-tabs" aria-label="หมวดในระบบจัดการ">
        {groups.map(g => (
          <div key={g.label} className="ops-tab-group">
            <span className="ops-tab-group-label">{g.label}</span>
            <div className="ops-tab-row" role="tablist">
              {g.tabs.map(t => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active === t.id}
                  className={`ops-tab${active === t.id ? ' is-active' : ''}`}
                  onClick={() => onTabChange(t.id)}
                >
                  <t.Icon size={16} />
                  {t.label}
                  {!!t.badge && <span className="ops-tab-badge">{t.badge > 9 ? '9+' : t.badge}</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <Suspense fallback={<div className="ops-loading"><div className="loading-spinner" /></div>}>
        {active === 'maintenance' && <MaintenancePage uid={uid} buildingId={buildingId} embedded />}
        {active === 'workorders' && <WorkOrdersPage ownerUid={uid} buildingId={buildingId} rooms={rooms} unitName={props.unitName} embedded />}
        {active === 'cleaning' && <CleaningPage uid={uid} buildingId={buildingId} embedded />}
      </Suspense>
      {active === 'team' && (
        <>
          <div className="ops-portal-note">
            <MessageCircle size={20} aria-hidden />
            <div>
              <strong>หน้างานส่วนตัวของช่างและแม่บ้าน</strong>
              <p>เมื่อเชื่อม LINE แล้ว ให้พิมพ์ <b>งานของฉัน</b> ในแชท LINE ของทีมงาน จะได้ลิงก์ที่เห็นงานทั้งหมดของตัวเองทุกสถานที่ กดเริ่มงาน แนบรูป และส่งงานได้เลย ไม่ต้องมีรหัสผ่าน</p>
            </div>
          </div>
          <StaffTeamTab uid={uid} buildingId={buildingId} />
        </>
      )}
      {active === 'vendors' && <VendorsTab uid={uid} buildingId={buildingId} />}
      {active === 'stock' && <StockTab uid={uid} buildingId={buildingId} />}
      {active === 'assets' && <AssetsTab uid={uid} buildingId={buildingId} rooms={rooms} />}
      {active === 'expenses' && <ExpensesTab uid={uid} buildingId={buildingId} />}
      {active === 'fines' && (
        <FinesTab uid={uid} buildingId={buildingId} rooms={rooms} fines={fines}
          onAdd={props.onAddFine} onUpdate={props.onUpdateFine} onDelete={props.onDeleteFine} />
      )}
      {active === 'common_fees' && (
        <CommonFeesTab uid={uid} buildingId={buildingId} commonFees={props.commonFees}
          onAdd={props.onAddCommonFee} onUpdate={props.onUpdateCommonFee} onDelete={props.onDeleteCommonFee} />
      )}
    </div>
  );
}
