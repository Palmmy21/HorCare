// The real-estate ERP's modules: what each one is for, which screens it has today, and what is planned.
// The sidebar groups (src/utils/navGroups.ts) use the same ids. Scope is real estate only — residential
// rentals, commercial units and markets — never manufacturing, general sales/inventory or payroll.

export interface ErpModule {
  id: string;
  label: string;
  purpose: string;
  /** Screens that exist today. */
  views: string[];
  /** Capabilities planned for this module; shown so the roadmap is visible, not clickable. */
  planned: string[];
}

export const VIEW_LABELS_TH: Record<string, string> = {
  rooms: 'จัดการห้อง/แผง', recording: 'จดมิเตอร์', leasing: 'ปล่อยเช่า (ผู้สนใจ จอง สัญญา)', tenants: 'ผู้เช่า',
  payments: 'การชำระเงิน', ledger: 'สมุดบัญชี', accounting: 'ส่งออกไป Mango', summary: 'สรุปยอด', archives: 'คลังเอกสาร',
  maintenance: 'แจ้งซ่อม', cleaning: 'งานแม่บ้าน', workorders: 'ใบงานช่าง/แม่บ้าน', operations: 'ระบบจัดการ (สต็อก ทรัพย์สิน ค่าใช้จ่าย)',
  parcels: 'พัสดุ', market: 'ร้านค้าแจ้งหยุด / ขาจร', messages: 'ข้อความ LINE', announcements: 'ประกาศและตอบอัตโนมัติ',
  security: 'ความปลอดภัยและสิทธิ์', settings: 'ตั้งค่า',
};

export function erpModules(isMarket: boolean): ErpModule[] {
  return [
    {
      id: 'property', label: isMarket ? 'แผงค้าและพื้นที่' : 'ทรัพย์สิน',
      purpose: isMarket ? 'ทะเบียนแผง โซน และมิเตอร์' : 'ทะเบียนห้อง/ยูนิต สิ่งอำนวยความสะดวก และมิเตอร์น้ำไฟ',
      views: ['rooms', 'recording', 'summary'],
      planned: ['ผังชั้น/โซน', 'เจ้าของทรัพย์สิน (กรณีบริหารแทน)'],
    },
    {
      id: 'leasing', label: 'ปล่อยเช่า',
      purpose: 'จากผู้สนใจ สู่การจอง สัญญาเช่า การต่อสัญญา ไปจนถึงย้ายออกและคืนมัดจำ',
      views: ['leasing', 'tenants'],
      planned: ['ตรวจรับห้องเข้า-ออก (checklist)', 'คืนเงินมัดจำและหักค่าเสียหาย', 'ใบเสนอราคา'],
    },
    {
      id: 'billing', label: 'เรียกเก็บและรับเงิน',
      purpose: 'บิลรายเดือน ค่าปรับ รับเงินสด/โอน อ่านสลิป และกระทบยอดธนาคาร',
      views: ['payments'],
      planned: ['ใบกำกับภาษี / VAT', 'เตือนค้างชำระอัตโนมัติ', 'ค่าปรับล่าช้าอัตโนมัติ'],
    },
    {
      id: 'accounting', label: 'บัญชี',
      purpose: 'สมุดบัญชีของ HorCare ลงรายการจากบิลและเงินรับ รายงาน และส่งออกไประบบบัญชีอื่น',
      views: ['ledger', 'accounting', 'archives'],
      planned: ['ยอดยกมา', 'งบกำไรขาดทุน / งบดุล', 'เจ้าหนี้และค่าใช้จ่าย', 'งบประมาณ', 'VAT / หัก ณ ที่จ่าย'],
    },
    {
      id: 'service', label: 'ซ่อมบำรุงและบริการ',
      purpose: 'แจ้งซ่อม ใบงานช่างและแม่บ้านผ่าน LINE สต็อกวัสดุ ทรัพย์สิน และค่าใช้จ่าย',
      views: ['maintenance', 'cleaning', 'workorders', 'operations'],
      planned: ['ซ่อมบำรุงตามรอบ (PM)', 'ค่าเสื่อมทรัพย์สิน', 'ใบสั่งซื้อ'],
    },
    {
      id: 'residents', label: isMarket ? 'ผู้ค้าและการสื่อสาร' : 'ลูกบ้านและการสื่อสาร',
      purpose: 'พอร์ทัลและ LINE ของลูกบ้าน พัสดุ ประกาศ ตอบอัตโนมัติ' + (isMarket ? ' ร้านค้าแจ้งหยุดและขาจร' : ''),
      views: isMarket ? ['parcels', 'market', 'messages', 'announcements'] : ['parcels', 'messages', 'announcements'],
      planned: ['จองพื้นที่ส่วนกลาง', 'ผู้มาเยือน / คีย์การ์ด'],
    },
    {
      id: 'system', label: 'ระบบ',
      purpose: 'สิทธิ์ตามบทบาทและสถานที่ บันทึกการใช้งาน การตั้งค่า',
      views: ['security', 'settings'],
      planned: ['ศูนย์รวมงานที่ต้องทำ', 'เวิร์กโฟลว์อนุมัติ'],
    },
  ];
}
