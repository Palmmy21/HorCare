// The tenant portal's housekeeping request, in every portal language. What the tenant picks is stored in Thai (the
// housekeeper reads Thai); only what the tenant sees is translated.
import type { BillLanguage, CleaningServiceType } from '../../types';

/** Stored values of the time slot (Thai, as the staff see them), in the order shown. */
export const CLEANING_SLOTS = ['เช้า (09:00 - 12:00)', 'บ่าย (13:00 - 16:00)', 'เย็น (16:00 - 18:00)', 'สะดวกทั้งวัน'] as const;

/** The kinds a tenant can ask for in the portal. */
export const PORTAL_CLEANING_TYPES = ['general', 'bathroom', 'balcony', 'deep', 'checkout'] as const;
export type PortalCleaningType = (typeof PORTAL_CLEANING_TYPES)[number];

export interface CleaningText {
  types: Record<PortalCleaningType, { label: string; desc: string }>;
  /** Kinds only staff create. */
  bed_linen: string;
  other: string;
  /** Labels of CLEANING_SLOTS, same order. */
  slots: [string, string, string, string];
  appointment: string;
  assigned: string;
  result: string;
  photo_alt: string;
  service_type: string;
  preferred_date: string;
  time_slot: string;
  details: string;
  details_placeholder: string;
}

export const CLEANING_TEXT: Record<BillLanguage, CleaningText> = {
  th: {
    types: {
      general: { label: 'ทำความสะอาดทั่วไป', desc: 'กวาด ถู ปัดฝุ่น' },
      bathroom: { label: 'ขัดล้างห้องน้ำ', desc: 'ล้างสุขภัณฑ์/พื้น' },
      balcony: { label: 'ล้างระเบียง', desc: 'ขัดพื้น/ซักล้าง' },
      deep: { label: 'บิ๊กคลีนนิ่ง', desc: 'ทำความสะอาดละเอียด' },
      checkout: { label: 'ก่อนย้ายออก', desc: 'เคลียร์ห้อง' },
    },
    bed_linen: 'เปลี่ยนผ้าปู / ซักรีด', other: 'อื่นๆ',
    slots: ['เช้า (09:00 - 12:00)', 'บ่าย (13:00 - 16:00)', 'เย็น (16:00 - 18:00)', 'สะดวกทั้งวัน'],
    appointment: 'วันนัดหมาย', assigned: 'ผู้รับผิดชอบ', result: 'ผลการทำความสะอาด', photo_alt: 'รูปทำความสะอาด',
    service_type: 'ประเภทบริการทำความสะอาด', preferred_date: 'วันที่ต้องการ (ถ้ามี)', time_slot: 'ช่วงเวลา',
    details: 'รายละเอียดเพิ่มเติม / จุดที่เน้นเป็นพิเศษ', details_placeholder: 'เช่น เน้นขัดร่องกระเบื้องห้องน้ำ, ทำความสะอาดตู้เย็น...',
  },
  en: {
    types: {
      general: { label: 'General cleaning', desc: 'Sweep, mop, dust' },
      bathroom: { label: 'Bathroom scrub', desc: 'Fixtures and floor' },
      balcony: { label: 'Balcony wash', desc: 'Scrub and rinse' },
      deep: { label: 'Deep cleaning', desc: 'Thorough clean' },
      checkout: { label: 'Before moving out', desc: 'Clear the room' },
    },
    bed_linen: 'Bed linen / laundry', other: 'Other',
    slots: ['Morning (09:00 - 12:00)', 'Afternoon (13:00 - 16:00)', 'Evening (16:00 - 18:00)', 'Any time'],
    appointment: 'Appointment', assigned: 'Assigned to', result: 'Cleaning result', photo_alt: 'Cleaning photo',
    service_type: 'Type of cleaning', preferred_date: 'Preferred date (optional)', time_slot: 'Time',
    details: 'More details / areas to focus on', details_placeholder: 'e.g. scrub the bathroom tile grout, clean the fridge...',
  },
  zh: {
    types: {
      general: { label: '日常清洁', desc: '扫地、拖地、除尘' },
      bathroom: { label: '浴室清洗', desc: '洁具和地面' },
      balcony: { label: '阳台清洗', desc: '刷洗地面' },
      deep: { label: '深度清洁', desc: '全面细致清洁' },
      checkout: { label: '退房前清洁', desc: '清理房间' },
    },
    bed_linen: '更换床单 / 洗衣', other: '其他',
    slots: ['上午 (09:00 - 12:00)', '下午 (13:00 - 16:00)', '傍晚 (16:00 - 18:00)', '全天都可以'],
    appointment: '预约日期', assigned: '负责人', result: '清洁结果', photo_alt: '清洁照片',
    service_type: '保洁服务类型', preferred_date: '希望日期（可选）', time_slot: '时间段',
    details: '补充说明 / 重点清洁区域', details_placeholder: '例如：重点刷洗浴室瓷砖缝、清洁冰箱…',
  },
  my: {
    types: {
      general: { label: 'ပုံမှန်သန့်ရှင်းရေး', desc: 'တံမြက်စည်းလှည်း၊ ကြမ်းတိုက်၊ ဖုန်သုတ်' },
      bathroom: { label: 'ရေချိုးခန်းဆေးကြောခြင်း', desc: 'ဘိုထိုင်နှင့် ကြမ်းပြင်' },
      balcony: { label: 'ဝရန်တာဆေးကြောခြင်း', desc: 'ကြမ်းပြင်တိုက်ချွတ်ခြင်း' },
      deep: { label: 'အထူးသန့်ရှင်းရေး', desc: 'အသေးစိတ်သန့်ရှင်းရေး' },
      checkout: { label: 'အခန်းမပြောင်းမီ', desc: 'အခန်းရှင်းလင်းခြင်း' },
    },
    bed_linen: 'အိပ်ရာခင်းလဲ / အဝတ်လျှော်', other: 'အခြား',
    slots: ['မနက် (09:00 - 12:00)', 'နေ့လယ် (13:00 - 16:00)', 'ညနေ (16:00 - 18:00)', 'တစ်နေ့လုံး အဆင်ပြေသည်'],
    appointment: 'ချိန်းဆိုသည့်နေ့', assigned: 'တာဝန်ခံ', result: 'သန့်ရှင်းရေးရလဒ်', photo_alt: 'သန့်ရှင်းရေးဓာတ်ပုံ',
    service_type: 'သန့်ရှင်းရေးအမျိုးအစား', preferred_date: 'လိုချင်သည့်နေ့ (ရှိလျှင်)', time_slot: 'အချိန်',
    details: 'အသေးစိတ် / အထူးဂရုစိုက်ရမည့်နေရာ', details_placeholder: 'ဥပမာ - ရေချိုးခန်းကြွေပြားကြားများ တိုက်ရန်၊ ရေခဲသေတ္တာ သန့်ရှင်းရန်...',
  },
  lo: {
    types: {
      general: { label: 'ທຳຄວາມສະອາດທົ່ວໄປ', desc: 'ກວາດ ຖູ ປັດຝຸ່ນ' },
      bathroom: { label: 'ຂັດລ້າງຫ້ອງນ້ຳ', desc: 'ລ້າງສຸຂະພັນ/ພື້ນ' },
      balcony: { label: 'ລ້າງລະບຽງ', desc: 'ຂັດພື້ນ/ຊັກລ້າງ' },
      deep: { label: 'ທຳຄວາມສະອາດໃຫຍ່', desc: 'ທຳຄວາມສະອາດລະອຽດ' },
      checkout: { label: 'ກ່ອນຍ້າຍອອກ', desc: 'ເຄຼຍຫ້ອງ' },
    },
    bed_linen: 'ປ່ຽນຜ້າປູ / ຊັກລີດ', other: 'ອື່ນໆ',
    slots: ['ເຊົ້າ (09:00 - 12:00)', 'ບ່າຍ (13:00 - 16:00)', 'ແລງ (16:00 - 18:00)', 'ສະດວກໝົດມື້'],
    appointment: 'ວັນນັດໝາຍ', assigned: 'ຜູ້ຮັບຜິດຊອບ', result: 'ຜົນການທຳຄວາມສະອາດ', photo_alt: 'ຮູບທຳຄວາມສະອາດ',
    service_type: 'ປະເພດບໍລິການທຳຄວາມສະອາດ', preferred_date: 'ວັນທີ່ຕ້ອງການ (ຖ້າມີ)', time_slot: 'ຊ່ວງເວລາ',
    details: 'ລາຍລະອຽດເພີ່ມເຕີມ / ຈຸດທີ່ເນັ້ນເປັນພິເສດ', details_placeholder: 'ເຊັ່ນ ເນັ້ນຂັດຮ່ອງກະເບື້ອງຫ້ອງນ້ຳ, ທຳຄວາມສະອາດຕູ້ເຢັນ...',
  },
  vi: {
    types: {
      general: { label: 'Dọn dẹp thông thường', desc: 'Quét, lau, phủi bụi' },
      bathroom: { label: 'Cọ rửa phòng tắm', desc: 'Thiết bị vệ sinh, sàn' },
      balcony: { label: 'Rửa ban công', desc: 'Cọ sàn, xả rửa' },
      deep: { label: 'Tổng vệ sinh', desc: 'Làm sạch kỹ' },
      checkout: { label: 'Trước khi chuyển đi', desc: 'Dọn trống phòng' },
    },
    bed_linen: 'Thay ga giường / giặt ủi', other: 'Khác',
    slots: ['Sáng (09:00 - 12:00)', 'Chiều (13:00 - 16:00)', 'Chiều tối (16:00 - 18:00)', 'Cả ngày đều được'],
    appointment: 'Ngày hẹn', assigned: 'Người phụ trách', result: 'Kết quả dọn dẹp', photo_alt: 'Ảnh dọn dẹp',
    service_type: 'Loại dịch vụ dọn dẹp', preferred_date: 'Ngày mong muốn (nếu có)', time_slot: 'Khung giờ',
    details: 'Chi tiết thêm / chỗ cần chú ý', details_placeholder: 'VD: cọ kỹ ron gạch phòng tắm, vệ sinh tủ lạnh...',
  },
};

/** A stored time slot in the tenant's language; anything else (older free text) is shown as it is. */
export function cleaningSlotLabel(stored: string | undefined, lang: BillLanguage): string {
  const i = stored ? (CLEANING_SLOTS as readonly string[]).indexOf(stored) : -1;
  return i >= 0 ? (CLEANING_TEXT[lang] ?? CLEANING_TEXT.th).slots[i] : (stored ?? '');
}

const TYPE_ALIAS: Partial<Record<CleaningServiceType, PortalCleaningType>> = {
  general_cleaning: 'general', bathroom_cleaning: 'bathroom', deep_cleaning: 'deep', move_out_cleaning: 'checkout',
};

/** The name of a kind of cleaning in the tenant's language, whichever spelling the request was saved with. */
export function cleaningTypeLabel(type: CleaningServiceType | string, lang: BillLanguage): string {
  const ct = CLEANING_TEXT[lang] ?? CLEANING_TEXT.th;
  if (type === 'bed_linen') return ct.bed_linen;
  if (type === 'other') return ct.other;
  const key = (TYPE_ALIAS[type as CleaningServiceType] ?? type) as PortalCleaningType;
  return ct.types[key]?.label ?? String(type);
}
