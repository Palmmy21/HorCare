import type { DormConfig } from '../types';

export interface WorkspaceTerms {
  // Unit (ห้อง / แผง / คูหา)
  unitName: string;           // 'ห้อง' | 'แผง' | 'คูหา'
  unitNamePlural: string;     // 'ห้องพัก' | 'แผงค้า' | 'คูหา/ยูนิต'
  unitPrefix: string;         // 'ห้อง ' | 'แผง ' | 'คูหา '
  unitNumberLabel: string;    // 'เลขห้อง' | 'รหัสแผง/ล็อก' | 'เลขคูหา'
  unitCountLabel: string;     // 'จำนวนห้องทั้งหมด' | 'จำนวนแผงทั้งหมด' | 'จำนวนคูหาทั้งหมด'
  occupiedUnitLabel: string;  // 'มีผู้เช่า' | 'มีผู้ค้า'
  vacantUnitLabel: string;    // 'ห้องว่าง' | 'แผงว่าง'
  reservedUnitLabel: string;  // 'ติดจอง'
  addUnitLabel: string;       // 'เพิ่มห้อง' | 'เพิ่มแผงค้า'
  manageUnitsLabel: string;   // 'จัดการห้อง' | 'จัดการแผงค้า'
  unitPlaceholder: string;    // 'เช่น 101, 102' | 'เช่น A01, B12'

  // Tenant (ผู้เช่า / ผู้ค้า)
  tenantLabel: string;        // 'ผู้เช่า' | 'ผู้ค้า'
  tenantsLabel: string;       // Alias for tenantLabel
  tenantTitle: string;        // 'ผู้เช่าห้องพัก' | 'ผู้ค้า / เจ้าของแผง'
  tenantPlural: string;       // 'ผู้พักอาศัย' | 'ผู้ค้า / พ่อค้าแม่ค้า'
  tenantPortalLabel: string;  // 'พอร์ทัลผู้เช่า' | 'พอร์ทัลผู้ค้า'

  // Grouping (ชั้น / โซน)
  groupLabel: string;         // 'ชั้น' | 'โซน'
  groupPlural: string;        // 'ชั้นอาคาร' | 'โซนตลาด'
  zonePlaceholder: string;    // 'ชั้น 1, ชั้น 2' | 'โซน A (อาหาร), โซน B (ของสด)'

  // Financial & Rates
  rentLabel: string;          // 'ค่าเช่าห้อง' | 'ค่าเช่าแผง'
  depositLabel: string;       // 'เงินประกัน / มัดจำ' | 'เงินมัดจำแผง'
  meterRecordingLabel: string;// 'จดมิเตอร์' | 'มิเตอร์ & ค่าไฟแผง'
  commonFeeLabel: string;     // 'ค่าส่วนกลาง' | 'ค่าบริการ / ค่าขยะ'

  // Facility / Property
  facilityType: string;       // 'หอพัก' | 'ตลาด' | 'อาคารพาณิชย์'
  facilityNameLabel: string;  // 'ชื่อหอพัก' | 'ชื่อตลาด'
  contractTitle: string;      // 'สัญญาเช่าห้องพัก' | 'สัญญาเช่าแผงค้าตลาด'

  // Booleans
  isMarket: boolean;
  isCommercial: boolean;
  /** Meter reading + utility bills. Off for hotels/resorts: the room price is all-in, collected per stay. */
  usesMeters: boolean;
  buildingType: DormConfig['building_type'];
}

export const DEFAULT_MARKET_ZONES = [
  'โซน A (อาหารปรุงสำเร็จ / สตรีทฟู้ด)',
  'โซน B (ผัก ผลไม้ อาหารสด)',
  'โซน C (เสื้อผ้า แฟชั่น ของใช้)',
  'โซน D (เครื่องดื่ม เบเกอรี่ คาเฟ่)',
  'โซน E (เปิดท้าย ลานโปรโมชัน)',
];

/** Asset type as the owner names it (branch cards, headers). */
export const BUILDING_TYPE_LABELS: Record<DormConfig['building_type'], string> = {
  dormitory: 'หอพัก', market: 'ตลาด / แผงค้า', commercial: 'อาคารพาณิชย์', apartment: 'อพาร์ตเมนต์',
  condo: 'คอนโดมิเนียม', house: 'บ้านเช่า / ทาวน์โฮม', resort: 'รีสอร์ท', hotel: 'โรงแรม', office: 'ออฟฟิศ', other: 'อื่น ๆ',
};

/** The collection style a building type starts with; the owner can still change it. */
export function defaultCollectionStyle(type: string | undefined): 'monthly' | 'nightly' | 'stall' {
  if (type === 'resort' || type === 'hotel') return 'nightly';
  if (type === 'market') return 'stall';
  return 'monthly';
}

type RentType = 'monthly' | 'semester' | 'yearly' | 'daily' | 'weekly';
type BuildingKind = DormConfig['building_type'] | undefined;

/** The rent cycle a new room/stall starts with. Hotels/resorts price per night, markets collect per day or week, the rest monthly. */
export function defaultRentType(type: BuildingKind, marketCycle?: 'daily' | 'weekly' | 'monthly'): RentType {
  if (type === 'resort' || type === 'hotel') return 'daily';
  if (type === 'market') return marketCycle ?? 'daily';
  return 'monthly';
}

/** How a rent cycle is worded in this workspace (a hotel has "per night", a market "collected as scheduled" - never "monthly"). */
export function rentTypeLabel(rentType: RentType | undefined, type: BuildingKind): string {
  const r = rentType ?? 'monthly';
  if (type === 'resort' || type === 'hotel') {
    return { daily: 'ต่อคืน', weekly: 'รายสัปดาห์', monthly: 'พักรายเดือน', semester: 'รายเทอม', yearly: 'รายปี' }[r];
  }
  if (type === 'market') {
    return { daily: 'เก็บรายวัน', weekly: 'เก็บรายสัปดาห์', monthly: 'เก็บตามกำหนด', semester: 'เก็บตามกำหนด', yearly: 'เก็บตามกำหนด' }[r];
  }
  return { daily: 'รายวัน', weekly: 'รายสัปดาห์', monthly: 'รายเดือน', semester: 'รายเทอม', yearly: 'รายปี' }[r];
}

/** Cycles offered when creating/editing a room in this workspace, most relevant first. */
export function rentTypeOptions(type: BuildingKind): { value: RentType; label: string }[] {
  const order: RentType[] = type === 'resort' || type === 'hotel' ? ['daily', 'weekly', 'monthly']
    : type === 'market' ? ['daily', 'weekly', 'monthly']
    : ['monthly', 'daily', 'weekly', 'semester', 'yearly'];
  return order.map(value => ({ value, label: rentTypeLabel(value, type) }));
}

/** Unit the room price is quoted per ("บาท/คืน"). */
export function rentUnitLabel(rentType: RentType | undefined, type: BuildingKind): string {
  const r = rentType ?? 'monthly';
  if (r === 'daily') return type === 'resort' || type === 'hotel' ? 'คืน' : 'วัน';
  return { weekly: 'สัปดาห์', monthly: 'เดือน', semester: 'เทอม', yearly: 'ปี' }[r];
}
/** How a property collects money: its saved choice, else what its building type starts with. */
export function collectionStyleOf(config: Pick<DormConfig, 'building_type' | 'collection_style'> | undefined): 'monthly' | 'nightly' | 'stall' {
  return config?.collection_style ?? defaultCollectionStyle(config?.building_type);
}

export function getWorkspaceTerms(buildingType?: DormConfig['building_type']): WorkspaceTerms {
  const type = buildingType || 'dormitory';

  if (type === 'market') {
    return {
      unitName: 'แผง',
      unitNamePlural: 'แผงค้า / ล็อก',
      unitPrefix: 'แผง ',
      unitNumberLabel: 'รหัสแผง / ล็อก',
      unitCountLabel: 'จำนวนแผงทั้งหมด',
      occupiedUnitLabel: 'มีผู้ค้า',
      vacantUnitLabel: 'แผงว่าง',
      reservedUnitLabel: 'ติดจอง',
      addUnitLabel: 'เพิ่มแผงค้า',
      manageUnitsLabel: 'จัดการแผงค้า',
      unitPlaceholder: 'เช่น A01, B12, แผง 05',

      tenantLabel: 'ผู้ค้า',
      tenantsLabel: 'ผู้ค้า',
      tenantTitle: 'ผู้ค้า / ผู้เช่าแผง',
      tenantPlural: 'ผู้ค้า / พ่อค้าแม่ค้า',
      tenantPortalLabel: 'พอร์ทัลผู้ค้า',

      groupLabel: 'โซน',
      groupPlural: 'โซนตลาด',
      zonePlaceholder: 'เช่น โซน A (อาหาร), โซน B (ของสด)',

      rentLabel: 'ค่าเช่าแผง',
      depositLabel: 'เงินมัดจำแผง / ประกันล็อก',
      meterRecordingLabel: 'มิเตอร์ & ไฟแผง',
      commonFeeLabel: 'ค่าบริการ / ค่าขยะแผง',

      facilityType: 'ตลาด',
      facilityNameLabel: 'ชื่อตลาด / โครงการ',
      contractTitle: 'สัญญาเช่าแผงค้าตลาด',

      isMarket: true,
      isCommercial: true,
      usesMeters: true,
      buildingType: type,
    };
  }

  if (type === 'commercial') {
    return {
      unitName: 'คูหา',
      unitNamePlural: 'คูหา / ยูนิต',
      unitPrefix: 'คูหา ',
      unitNumberLabel: 'เลขคูหา / ยูนิต',
      unitCountLabel: 'จำนวนคูหาทั้งหมด',
      occupiedUnitLabel: 'มีผู้เช่า',
      vacantUnitLabel: 'คูหาว่าง',
      reservedUnitLabel: 'ติดจอง',
      addUnitLabel: 'เพิ่มคูหา',
      manageUnitsLabel: 'จัดการคูหา',
      unitPlaceholder: 'เช่น A1, B2',

      tenantLabel: 'ผู้เช่า',
      tenantsLabel: 'ผู้เช่า',
      tenantTitle: 'ผู้เช่าเชิงพาณิชย์',
      tenantPlural: 'ผู้ประกอบการ / ผู้เช่า',
      tenantPortalLabel: 'พอร์ทัลผู้เช่า',

      groupLabel: 'ชั้น / โซน',
      groupPlural: 'ชั้น / โซน',
      zonePlaceholder: 'เช่น ชั้น 1, อาคารหน้า',

      rentLabel: 'ค่าเช่าคูหา',
      depositLabel: 'เงินประกันสัญญา',
      meterRecordingLabel: 'จดมิเตอร์',
      commonFeeLabel: 'ค่าส่วนกลาง',

      facilityType: 'อาคารพาณิชย์',
      facilityNameLabel: 'ชื่ออาคาร / โครงการ',
      contractTitle: 'สัญญาเช่าอาคารพาณิชย์',

      isMarket: false,
      isCommercial: true,
      usesMeters: true,
      buildingType: type,
    };
  }

  // Default: Dormitory, Apartment, Condo, House, Resort, etc.
  return {
    unitName: 'ห้อง',
    unitNamePlural: 'ห้องพัก',
    unitPrefix: 'ห้อง ',
    unitNumberLabel: 'เลขห้อง',
    unitCountLabel: 'จำนวนห้องทั้งหมด',
    occupiedUnitLabel: 'มีผู้เช่า',
    vacantUnitLabel: 'ห้องว่าง',
    reservedUnitLabel: 'ติดจอง',
    addUnitLabel: 'เพิ่มห้อง',
    manageUnitsLabel: 'จัดการห้อง',
    unitPlaceholder: 'เช่น 101, 102, 201',

    tenantLabel: 'ผู้เช่า',
    tenantsLabel: 'ผู้เช่า',
    tenantTitle: 'ผู้พักอาศัย',
    tenantPlural: 'ผู้พักอาศัย',
    tenantPortalLabel: 'พอร์ทัลผู้เช่า',

    groupLabel: 'ชั้น',
    groupPlural: 'ชั้นอาคาร',
    zonePlaceholder: 'เช่น ชั้น 1, ชั้น 2',

    rentLabel: 'ค่าเช่าห้อง',
    depositLabel: 'เงินประกัน / มัดจำ',
    meterRecordingLabel: 'จดมิเตอร์',
    commonFeeLabel: 'ค่าบริการส่วนกลาง',

    facilityType: type === 'apartment' ? 'อพาร์ตเมนต์' : type === 'condo' ? 'คอนโด' : type === 'house' ? 'บ้านเช่า' : 'หอพัก',
    facilityNameLabel: 'ชื่อหอพัก / อาคาร',
    contractTitle: 'สัญญาเช่าห้องพัก',

    isMarket: false,
    isCommercial: ['resort', 'hotel', 'office'].includes(type),
    usesMeters: !['resort', 'hotel'].includes(type),
    buildingType: type,
  };
}
