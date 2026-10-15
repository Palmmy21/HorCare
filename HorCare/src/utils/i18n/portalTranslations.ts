import type { BillLanguage, MaintenanceCategory } from '../../types';
import { LANGUAGE_OPTIONS } from './billTranslations';

export { LANGUAGE_OPTIONS };

export interface PortalTranslations {
  // Hero & General
  tenant: string;
  room: string;
  rent: string;
  this_month: string;
  status: string;
  paid: string;
  pending: string;
  unpaid: string;
  change_language: string;

  // Section Headers
  personal_info: string;
  monthly_bill: string;
  payment_channel: string;
  unpaid_fines: string;
  history: string;
  contact_dorm: string;
  maintenance: string;
  cleaning: string;
  request_cleaning: string;
  cleaning_success_toast: string;

  // Profile
  add_info: string;
  edit: string;
  save: string;
  saving: string;
  cancel: string;
  no_profile_msg: string;
  full_name: string;
  nickname: string;
  phone: string;
  occupation: string;
  emergency_contact: string;
  emergency_name: string;
  emergency_phone: string;
  emergency_relation: string;
  profile_saved_toast: string;
  profile_error_toast: string;

  // Bill & Breakdown
  no_bill_yet: string;
  total_with_amount: string;
  room_rent: string;
  elec_bill: string;
  water_bill: string;
  water_flat: string;
  water_excess: string;
  grand_total: string;
  meter_readings: string;
  elec_meter: string;
  water_meter: string;
  unit: string;

  // Payment & QR
  scan_qr: string;
  scan_qr_fine: string;
  attach_slip: string;
  uploading_slip: string;
  slip_success_auto: string;
  slip_success_wait: string;
  slip_mismatch: string;
  slip_fail: string;

  // Fines
  fine_reason: string;
  fine_date: string;
  fine_note: string;
  fine_wait_verify: string;
  fine_paid_on: string;
  auto_verified: string;

  // Contact
  call: string;

  // Maintenance
  report_repair: string;
  category: string;
  description: string;
  desc_placeholder: string;
  urgency: string;
  urgent: string;
  normal: string;
  attach_photo: string;
  optional: string;
  take_photo: string;
  sending: string;
  send_request: string;
  repair_success_toast: string;
  status_open: string;
  status_in_progress: string;
  status_resolved: string;
  status_cancelled: string;

  // PIN Gate & Common
  verify_pin_title: string;
  verify_pin_desc: string;
  enter_portal: string;
  pin_incorrect: string;
  loading: string;
  error_title: string;
  contact_owner_hint: string;
  invalid_link: string;
  use_direct_link: string;
  powered_by: string;
}

export const PORTAL_TRANSLATIONS: Record<BillLanguage, PortalTranslations> = {
  th: {
    tenant: 'ผู้เช่า',
    room: 'ห้อง',
    rent: 'ค่าเช่า',
    this_month: 'เดือนนี้',
    status: 'สถานะ',
    paid: 'ชำระแล้ว',
    pending: 'รอตรวจสอบ',
    unpaid: 'ค้างชำระ',
    change_language: 'เปลี่ยนภาษา',

    personal_info: 'ข้อมูลส่วนตัว',
    monthly_bill: 'บิลเดือน',
    payment_channel: 'ช่องทางชำระเงิน',
    unpaid_fines: 'ค่าปรับค้างชำระ',
    history: 'ประวัติย้อนหลัง',
    contact_dorm: 'ติดต่อหอพัก',
    maintenance: 'แจ้งซ่อม',
    cleaning: 'งานแม่บ้าน',
    request_cleaning: 'แจ้งทำความสะอาด',
    cleaning_success_toast: 'ส่งคำขอทำความสะอาดเรียบร้อยแล้ว',

    add_info: 'เพิ่มข้อมูล',
    edit: 'แก้ไข',
    save: 'บันทึก',
    saving: 'กำลังบันทึก...',
    cancel: 'ยกเลิก',
    no_profile_msg: 'ยังไม่มีข้อมูลส่วนตัว กดปุ่ม "เพิ่มข้อมูล" เพื่อเริ่มต้น',
    full_name: 'ชื่อ-นามสกุล',
    nickname: 'ชื่อเล่น',
    phone: 'เบอร์โทร',
    occupation: 'อาชีพ',
    emergency_contact: 'ผู้ติดต่อฉุกเฉิน',
    emergency_name: 'ชื่อผู้ติดต่อฉุกเฉิน',
    emergency_phone: 'เบอร์โทรฉุกเฉิน',
    emergency_relation: 'ความสัมพันธ์',
    profile_saved_toast: 'บันทึกข้อมูลเรียบร้อยแล้ว',
    profile_error_toast: 'บันทึกไม่สำเร็จ กรุณาลองใหม่',

    no_bill_yet: 'ยังไม่มีบิลสำหรับ',
    total_with_amount: 'รวม',
    room_rent: 'ค่าเช่าห้อง',
    elec_bill: 'ค่าไฟ',
    water_bill: 'ค่าน้ำ',
    water_flat: 'ค่าน้ำเหมา',
    water_excess: 'ค่าน้ำส่วนเกิน',
    grand_total: 'รวมทั้งหมด',
    meter_readings: 'ค่ามิเตอร์',
    elec_meter: 'มิเตอร์ไฟ',
    water_meter: 'มิเตอร์น้ำ',
    unit: 'หน่วย',

    scan_qr: 'สแกน QR ชำระเงิน',
    scan_qr_fine: 'สแกน QR ชำระค่าปรับ',
    attach_slip: 'แนบสลิปโอนเงิน',
    uploading_slip: 'กำลังส่งสลิป...',
    slip_success_auto: 'ชำระเงินเรียบร้อยแล้ว (ตรวจสอบอัตโนมัติ)',
    slip_success_wait: 'ส่งสลิปเรียบร้อย รอเจ้าของหอตรวจสอบ',
    slip_mismatch: 'สลิปไม่ตรงกับบิล — ยังไม่ได้รับยอด',
    slip_fail: 'อัปโหลดไม่สำเร็จ',

    fine_reason: 'ค่าปรับ',
    fine_date: 'วันที่',
    fine_note: 'หมายเหตุ',
    fine_wait_verify: 'รอเจ้าของหอพักตรวจสอบสลิป',
    fine_paid_on: 'ชำระแล้วเมื่อ',
    auto_verified: '(อัตโนมัติ)',

    call: 'โทร',

    report_repair: 'แจ้งซ่อม',
    category: 'หมวดหมู่',
    description: 'รายละเอียดปัญหา',
    desc_placeholder: 'เช่น แอร์ไม่เย็น, ก๊อกน้ำรั่ว...',
    urgency: 'ความเร่งด่วน',
    urgent: 'ด่วน',
    normal: 'ปกติ',
    attach_photo: 'รูปประกอบ',
    optional: 'ไม่บังคับ',
    take_photo: 'ถ่ายรูป / เลือกรูป',
    sending: 'กำลังส่ง...',
    send_request: 'ส่งคำขอ',
    repair_success_toast: 'ส่งคำขอแจ้งซ่อมเรียบร้อยแล้ว',
    status_open: 'รอดำเนินการ',
    status_in_progress: 'กำลังดำเนินการ',
    status_resolved: 'เสร็จสิ้น',
    status_cancelled: 'ยกเลิก',

    verify_pin_title: 'ยืนยันตัวตน',
    verify_pin_desc: 'กรอก PIN 4 หลักที่ได้รับจากเจ้าของหอพัก',
    enter_portal: 'เข้าสู่พอร์ทัล',
    pin_incorrect: 'PIN ไม่ถูกต้อง กรุณาลองใหม่',
    loading: 'กำลังโหลด...',
    error_title: 'ไม่พบข้อมูล',
    contact_owner_hint: 'กรุณาติดต่อเจ้าของหอพัก',
    invalid_link: 'ลิงก์ไม่ถูกต้อง',
    use_direct_link: 'กรุณาใช้ลิงก์ที่ได้รับจากเจ้าของหอพักโดยตรง',
    powered_by: 'Powered by HorCare',
  },

  en: {
    tenant: 'Tenant',
    room: 'Room',
    rent: 'Rent',
    this_month: 'This Month',
    status: 'Status',
    paid: 'Paid',
    pending: 'Pending',
    unpaid: 'Unpaid',
    change_language: 'Language',

    personal_info: 'Personal Info',
    monthly_bill: 'Bill for',
    payment_channel: 'Payment Method',
    unpaid_fines: 'Pending Fines',
    history: 'History',
    contact_dorm: 'Contact Dorm',
    maintenance: 'Maintenance',
    cleaning: 'Housekeeping',
    request_cleaning: 'Request Cleaning',
    cleaning_success_toast: 'Cleaning request submitted successfully',

    add_info: 'Add Info',
    edit: 'Edit',
    save: 'Save',
    saving: 'Saving...',
    cancel: 'Cancel',
    no_profile_msg: 'No personal info yet. Click "Add Info" to begin.',
    full_name: 'Full Name',
    nickname: 'Nickname',
    phone: 'Phone',
    occupation: 'Occupation',
    emergency_contact: 'Emergency Contact',
    emergency_name: 'Contact Name',
    emergency_phone: 'Contact Phone',
    emergency_relation: 'Relationship',
    profile_saved_toast: 'Information saved successfully',
    profile_error_toast: 'Failed to save. Please try again.',

    no_bill_yet: 'No bill yet for',
    total_with_amount: 'Total',
    room_rent: 'Room Rent',
    elec_bill: 'Electricity',
    water_bill: 'Water',
    water_flat: 'Water (Flat)',
    water_excess: 'Excess Water',
    grand_total: 'Total Amount',
    meter_readings: 'Meter Readings',
    elec_meter: 'Elec Meter',
    water_meter: 'Water Meter',
    unit: 'units',

    scan_qr: 'Scan QR to Pay',
    scan_qr_fine: 'Scan QR to Pay Fine',
    attach_slip: 'Attach Transfer Slip',
    uploading_slip: 'Uploading slip...',
    slip_success_auto: 'Payment verified automatically',
    slip_success_wait: 'Slip uploaded. Waiting for owner verification.',
    slip_mismatch: 'Slip does not match the bill — payment not accepted',
    slip_fail: 'Upload failed',

    fine_reason: 'Fine',
    fine_date: 'Date',
    fine_note: 'Note',
    fine_wait_verify: 'Waiting for owner verification',
    fine_paid_on: 'Paid on',
    auto_verified: '(Auto)',

    call: 'Call',

    report_repair: 'Request Repair',
    category: 'Category',
    description: 'Description',
    desc_placeholder: 'e.g. AC not cooling, pipe leaking...',
    urgency: 'Urgency',
    urgent: 'Urgent',
    normal: 'Normal',
    attach_photo: 'Photo',
    optional: 'Optional',
    take_photo: 'Take photo / Choose file',
    sending: 'Sending...',
    send_request: 'Submit Request',
    repair_success_toast: 'Repair request submitted successfully',
    status_open: 'Pending',
    status_in_progress: 'In Progress',
    status_resolved: 'Resolved',
    status_cancelled: 'Cancelled',

    verify_pin_title: 'Verification',
    verify_pin_desc: 'Enter the 4-digit PIN provided by the owner',
    enter_portal: 'Enter Portal',
    pin_incorrect: 'Incorrect PIN. Please try again.',
    loading: 'Loading...',
    error_title: 'Not Found',
    contact_owner_hint: 'Please contact dormitory owner',
    invalid_link: 'Invalid Link',
    use_direct_link: 'Please use the direct link provided by the owner',
    powered_by: 'Powered by HorCare',
  },

  zh: {
    tenant: '租客',
    room: '房间',
    rent: '租金',
    this_month: '本月费用',
    status: '缴费状态',
    paid: '已缴清',
    pending: '审核中',
    unpaid: '待缴费',
    change_language: '切换语言',

    personal_info: '个人信息',
    monthly_bill: '账单月份',
    payment_channel: '付款方式',
    unpaid_fines: '待缴罚款',
    history: '历史记录',
    contact_dorm: '联系房东',
    maintenance: '报修服务',
    cleaning: '保洁服务',
    request_cleaning: '预约保洁',
    cleaning_success_toast: '保洁预约已提交',

    add_info: '填写信息',
    edit: '修改',
    save: '保存',
    saving: '正在保存...',
    cancel: '取消',
    no_profile_msg: '暂无个人信息，点击“填写信息”开始',
    full_name: '姓名',
    nickname: '昵称',
    phone: '联系电话',
    occupation: '职业',
    emergency_contact: '紧急联系人',
    emergency_name: '紧急联系人姓名',
    emergency_phone: '紧急联系电话',
    emergency_relation: '关系',
    profile_saved_toast: '信息保存成功',
    profile_error_toast: '保存失败，请重试',

    no_bill_yet: '暂无账单：',
    total_with_amount: '合计',
    room_rent: '房屋租金',
    elec_bill: '电费',
    water_bill: '水费',
    water_flat: '包月水费',
    water_excess: '超额水费',
    grand_total: '应付总额',
    meter_readings: '水电表读数',
    elec_meter: '电表',
    water_meter: '水表',
    unit: '度',

    scan_qr: '扫码支付',
    scan_qr_fine: '扫码缴纳罚款',
    attach_slip: '上传转账凭证',
    uploading_slip: '正在上传凭证...',
    slip_success_auto: '已完成缴费（自动识别通过）',
    slip_success_wait: '凭证已上传，等待房东确认',
    slip_mismatch: '凭证与账单不符 — 未确认收款',
    slip_fail: '上传失败',

    fine_reason: '罚款项目',
    fine_date: '开单日期',
    fine_note: '备注说明',
    fine_wait_verify: '等待房东确认转账',
    fine_paid_on: '缴款时间',
    auto_verified: '(自动确认)',

    call: '拨号',

    report_repair: '提交报修',
    category: '故障分类',
    description: '问题描述',
    desc_placeholder: '例如 空调不制冷、水管漏水...',
    urgency: '紧急程度',
    urgent: '紧急',
    normal: '普通',
    attach_photo: '现场照片',
    optional: '选填',
    take_photo: '拍照 / 选择相片',
    sending: '正在提交...',
    send_request: '提交报修申请',
    repair_success_toast: '报修申请已提交',
    status_open: '待处理',
    status_in_progress: '维修中',
    status_resolved: '已修复',
    status_cancelled: '已取消',

    verify_pin_title: '身份验证',
    verify_pin_desc: '请输入房东提供的4位数PIN码',
    enter_portal: '进入系统',
    pin_incorrect: 'PIN码错误，请重新输入',
    loading: '加载中...',
    error_title: '未找到信息',
    contact_owner_hint: '请与房东联系',
    invalid_link: '链接无效',
    use_direct_link: '请使用房东发送的专属链接',
    powered_by: 'Powered by HorCare',
  },

  my: {
    tenant: 'အငှားနေသူ',
    room: 'အခန်း',
    rent: 'အခန်းခ',
    this_month: 'ယခုလ',
    status: 'အခြေအနေ',
    paid: 'ပေးချေပြီး',
    pending: 'စစ်ဆေးဆဲ',
    unpaid: 'မပေးချေသေးပါ',
    change_language: 'ဘာသာစကား',

    personal_info: 'ကိုယ်ရေးအချက်အလက်',
    monthly_bill: 'ဘေလ်လ',
    payment_channel: 'ငွေပေးချေနည်း',
    unpaid_fines: 'ဒဏ်ကြေးများ',
    history: 'ယခင်မှတ်တမ်း',
    contact_dorm: 'အဆောင်သို့ဆက်သွယ်ရန်',
    maintenance: 'ပြင်ဆင်ရန်တောင်းဆိုချက်',
    cleaning: 'သန့်ရှင်းရေးဝန်ဆောင်မှု',
    request_cleaning: 'သန့်ရှင်းရေးတောင်းဆိုရန်',
    cleaning_success_toast: 'သန့်ရှင်းရေးတောင်းဆိုချက် ပို့ပြီးပါပြီ',

    add_info: 'အချက်အလက်ထည့်ရန်',
    edit: 'ပြင်ဆင်ရန်',
    save: 'သိမ်းမည်',
    saving: 'သိမ်းနေသည်...',
    cancel: 'မလုပ်တော့ပါ',
    no_profile_msg: 'အချက်အလက်မရှိသေးပါ။ "အချက်အလက်ထည့်ရန်" ကိုနှိပ်ပါ',
    full_name: 'အမည်အပြည့်အစုံ',
    nickname: 'အမည်ပြောင်',
    phone: 'ဖုန်းနံပါတ်',
    occupation: 'အလုပ်အကိုင်',
    emergency_contact: 'အရေးပေါ်ဆက်သွယ်ရန်',
    emergency_name: 'ဆက်သွယ်ရန်အမည်',
    emergency_phone: 'ဆက်သွယ်ရန်ဖုန်း',
    emergency_relation: 'တော်စပ်ပုံ',
    profile_saved_toast: 'သိမ်းဆည်းပြီးပါပြီ',
    profile_error_toast: 'မအောင်မြင်ပါ ထပ်ကြိုးစားပါ',

    no_bill_yet: 'ဘေလ်မရှိသေးပါ',
    total_with_amount: 'စုစုပေါင်း',
    room_rent: 'အခန်းခ',
    elec_bill: 'မီးဖိုး',
    water_bill: 'ရေဖိုး',
    water_flat: 'ရေဖိုး (အလုံးစုံ)',
    water_excess: 'ရေဖိုး (ပိုယူ)',
    grand_total: 'စုစုပေါင်းကျသင့်ငွေ',
    meter_readings: 'မီတာဖတ်ချက်',
    elec_meter: 'မီးမီတာ',
    water_meter: 'ရေမီတာ',
    unit: 'ယူနစ်',

    scan_qr: 'QR ဖြင့်ငွေပေးချေရန်',
    scan_qr_fine: 'ဒဏ်ကြေးပေးချေရန် QR',
    attach_slip: 'ငွေလွှဲစလစ်ထည့်ရန်',
    uploading_slip: 'စလစ်တင်နေသည်...',
    slip_success_auto: 'ငွေပေးချေမှုအောင်မြင်ပါသည် (အလိုအလျောက်စစ်ဆေးပြီး)',
    slip_success_wait: 'စလစ်တင်ပြီးပါပြီ အဆောင်မှစစ်ဆေးနေပါသည်',
    slip_mismatch: 'စလစ်သည် ငွေတောင်းခံလွှာနှင့် မကိုက်ညီပါ — ငွေလက်မခံရသေးပါ',
    slip_fail: 'မအောင်မြင်ပါ',

    fine_reason: 'ဒဏ်ကြေးအကြောင်းအရာ',
    fine_date: 'ရက်စွဲ',
    fine_note: 'မှတ်ချက်',
    fine_wait_verify: 'စလစ်စစ်ဆေးနေဆဲဖြစ်သည်',
    fine_paid_on: 'ပေးချေသည့်ရက်စွဲ',
    auto_verified: '(အလိုအလျောက်)',

    call: 'ဖုန်းခေါ်မည်',

    report_repair: 'ပြင်ဆင်ရန်တိုင်ကြားချက်',
    category: 'အမျိုးအစား',
    description: 'အသေးစိတ်အချက်အလက်',
    desc_placeholder: 'ဥပမာ အဲယားကွန်းမအေးပါ၊ ရေပိုက်ယိုစိမ့်ပါသည်...',
    urgency: 'အရေးကြီးမှုအဆင့်',
    urgent: 'အရေးကြီးသည်',
    normal: 'ပုံမှန်',
    attach_photo: 'ဓာတ်ပုံ',
    optional: 'မထည့်လည်းရသည်',
    take_photo: 'ဓာတ်ပုံရိုက်မည် / ရွေးမည်',
    sending: 'ပို့နေသည်...',
    send_request: 'တောင်းဆိုချက်ပို့မည်',
    repair_success_toast: 'ပြင်ဆင်ရန်တောင်းဆိုချက် ပို့ပြီးပါပြီ',
    status_open: 'စောင့်ဆိုင်းဆဲ',
    status_in_progress: 'ဆောင်ရွက်ဆဲ',
    status_resolved: 'ပြီးစီးပါပြီ',
    status_cancelled: 'ပယ်ဖျက်ပြီး',

    verify_pin_title: 'အတည်ပြုခြင်း',
    verify_pin_desc: 'အဆောင်ပိုင်ရှင်ထံမှရရှိသော PIN ၄ လုံးကိုရိုက်ထည့်ပါ',
    enter_portal: 'ဝင်ရောက်မည်',
    pin_incorrect: 'PIN မမှန်ကန်ပါ ထပ်မံကြိုးစားပါ',
    loading: 'ခေတ္တစောင့်ပါ...',
    error_title: 'အချက်အလက်မတွေ့ပါ',
    contact_owner_hint: 'အဆောင်ပိုင်ရှင်ထံ ဆက်သွယ်ပါ',
    invalid_link: 'လင့်ခ်မမှန်ကန်ပါ',
    use_direct_link: 'အဆောင်မှပေးသော လင့်ခ်ကိုသုံးပါ',
    powered_by: 'Powered by HorCare',
  },

  lo: {
    tenant: 'ຜູ້ເຊົ່າ',
    room: 'ຫ້ອງ',
    rent: 'ຄ່າເຊົ່າ',
    this_month: 'ເດືອນນີ້',
    status: 'ສະຖານະ',
    paid: 'ຊຳລະແລ້ວ',
    pending: 'ລໍຖ້າກວດສອບ',
    unpaid: 'ຄ້າງຊຳລະ',
    change_language: 'ປ່ຽນພາສາ',

    personal_info: 'ຂໍ້ມູນສ່ວນຕົວ',
    monthly_bill: 'ບິນເດືອນ',
    payment_channel: 'ຊ່ອງທາງຊຳລະເງິນ',
    unpaid_fines: 'ຄ່າປັບຄ້າງຊຳລະ',
    history: 'ປະຫວັດຍ້ອນຫຼັງ',
    contact_dorm: 'ຕິດຕໍ່ຫໍພັກ',
    maintenance: 'ແຈ້ງສ້ອມ',
    cleaning: 'ວຽກແມ່ບ້ານ',
    request_cleaning: 'ແຈ້ງທຳຄວາມສະອາດ',
    cleaning_success_toast: 'ສົ່ງຄຳຂໍທຳຄວາມສະອາດຮຽບຮ້ອຍແລ້ວ',

    add_info: 'ເພີ່ມຂໍ້ມູນ',
    edit: 'ແກ້ໄຂ',
    save: 'ບັນທຶກ',
    saving: 'ກຳລັງບັນທຶກ...',
    cancel: 'ຍົກເລີກ',
    no_profile_msg: 'ຍັງບໍ່ມີຂໍ້ມູນສ່ວນຕົວ ກົດປຸ່ມ "ເພີ່ມຂໍ້ມູນ" ເພື່ອເລີ່ມຕົ້ນ',
    full_name: 'ຊື່ ແລະ ນາມສະກຸນ',
    nickname: 'ຊື່ຫຼິ້ນ',
    phone: 'ເບີໂທ',
    occupation: 'ອາຊີບ',
    emergency_contact: 'ຜູ້ຕິດຕໍ່ສຸກເສີນ',
    emergency_name: 'ຊື່ຜູ້ຕິດຕໍ່ສຸກເສີນ',
    emergency_phone: 'ເບີໂທສຸກເສີນ',
    emergency_relation: 'ຄວາມສຳພັນ',
    profile_saved_toast: 'ບັນທຶກຂໍ້ມູນຮຽບຮ້ອຍແລ້ວ',
    profile_error_toast: 'ບັນທຶກບໍ່ສຳເລັດ ກະລຸນາລອງໃໝ່',

    no_bill_yet: 'ຍັງບໍ່ມີບິນສຳລັບ',
    total_with_amount: 'ລວມ',
    room_rent: 'ຄ່າເຊົ່າຫ້ອງ',
    elec_bill: 'ຄ່າໄຟ',
    water_bill: 'ຄ່ານ້ຳ',
    water_flat: 'ຄ່ານ້ຳເໝົາ',
    water_excess: 'ຄ່ານ້ຳສ່ວນເກີນ',
    grand_total: 'ລວມທັງໝົດ',
    meter_readings: 'ຄ່າມິເຕີ',
    elec_meter: 'ມິເຕີໄຟ',
    water_meter: 'ມິເຕີນ້ຳ',
    unit: 'ໜ່ວຍ',

    scan_qr: 'ສະແກນ QR ຊຳລະເງິນ',
    scan_qr_fine: 'ສະແກນ QR ຊຳລະຄ່າປັບ',
    attach_slip: 'ແນບສະລິບໂອນເງິນ',
    uploading_slip: 'ກຳລັງສົ່ງສະລິບ...',
    slip_success_auto: 'ຊຳລະເງິນຮຽບຮ້ອຍແລ້ວ (ກວດສອບອັດຕະໂນມັດ)',
    slip_success_wait: 'ສົ່ງສະລິບຮຽບຮ້ອຍ ລໍຖ້າເຈົ້າຂອງຫໍກວດສອບ',
    slip_mismatch: 'ສະລິບບໍ່ກົງກັບບິນ — ຍັງບໍ່ໄດ້ຮັບຍອດ',
    slip_fail: 'ອັບໂຫຼດບໍ່ສຳເລັດ',

    fine_reason: 'ຄ່າປັບ',
    fine_date: 'ວັນທີ',
        fine_note: 'ໝາຍເຫດ',
    fine_wait_verify: 'ລໍຖ້າເຈົ້າຂອງຫໍພັກກວດສອບສະລິບ',
    fine_paid_on: 'ຊຳລະແລ້ວເມື່ອ',
    auto_verified: '(ອັດຕະໂນມັດ)',

    call: 'ໂທ',

    report_repair: 'ແຈ້ງສ້ອມ',
    category: 'ໝວດໝູ່',
    description: 'ລາຍລະອຽດບັນຫາ',
    desc_placeholder: 'ເຊັ່ນ: ແອບໍ່ເຢັນ, ກ໊ອກນ້ຳຮົ່ວ...',
    urgency: 'ຄວາມຮີບດ່ວນ',
    urgent: 'ດ່ວນ',
    normal: 'ປົກກະຕິ',
    attach_photo: 'ຮູບປະກອບ',
    optional: 'ບໍ່ບັງຄັບ',
    take_photo: 'ຖ່າຍຮູບ / ເລືອກຮູບ',
    sending: 'ກຳລັງສົ່ງ...',
    send_request: 'ສົ່ງຄຳຂໍ',
    repair_success_toast: 'ສົ່ງຄຳຂໍແຈ້ງສ້ອມຮຽບຮ້ອຍແລ້ວ',
    status_open: 'ລໍດຳເນີນການ',
    status_in_progress: 'ກຳລັງດຳເນີນການ',
    status_resolved: 'ສຳເລັດ',
    status_cancelled: 'ຍົກເລີກ',

    verify_pin_title: 'ຢືນຢັນຕົວຕົນ',
    verify_pin_desc: 'ປ້ອນ PIN 4 ຫຼັກທີ່ໄດ້ຮັບຈາກເຈົ້າຂອງຫໍພັກ',
    enter_portal: 'ເຂົ້າສູ່ພໍທັລ',
    pin_incorrect: 'PIN ບໍ່ຖືກຕ້ອງ ກະລຸນາລອງໃໝ່',
    loading: 'ກຳລັງໂຫຼດ...',
    error_title: 'ບໍ່ພົບຂໍ້ມູນ',
    contact_owner_hint: 'ກະລຸນາຕິດຕໍ່ເຈົ້າຂອງຫໍພັກ',
    invalid_link: 'ລິ້ງບໍ່ຖືກຕ້ອງ',
    use_direct_link: 'ກະລຸນາໃຊ້ລິ້ງທີ່ໄດ້ຮັບຈາກເຈົ້າຂອງຫໍພັກໂດຍກົງ',
    powered_by: 'Powered by HorCare',
  },

  vi: {
    tenant: 'Người thuê',
    room: 'Phòng',
    rent: 'Tiền phòng',
    this_month: 'Tháng này',
    status: 'Trạng thái',
    paid: 'Đã thanh toán',
    pending: 'Đang xác minh',
    unpaid: 'Chưa thanh toán',
    change_language: 'Đổi ngôn ngữ',

    personal_info: 'Thông tin cá nhân',
    monthly_bill: 'Hóa đơn tháng',
    payment_channel: 'Phương thức thanh toán',
    unpaid_fines: 'Tiền phạt chưa đóng',
    history: 'Lịch sử',
    contact_dorm: 'Liên hệ chủ trọ',
    maintenance: 'Báo sửa chữa',
    cleaning: 'Dịch vụ dọn dẹp',
    request_cleaning: 'Yêu cầu dọn dẹp',
    cleaning_success_toast: 'Đã gửi yêu cầu dọn dẹp thành công',

    add_info: 'Thêm thông tin',
    edit: 'Chỉnh sửa',
    save: 'Lưu',
    saving: 'Đang lưu...',
    cancel: 'Hủy',
    no_profile_msg: 'Chưa có thông tin cá nhân. Nhấn "Thêm thông tin" để bắt đầu.',
    full_name: 'Họ và tên',
    nickname: 'Biệt danh',
    phone: 'Số điện thoại',
    occupation: 'Nghề nghiệp',
    emergency_contact: 'Người liên hệ khẩn cấp',
    emergency_name: 'Tên người liên hệ',
    emergency_phone: 'SĐT khẩn cấp',
    emergency_relation: 'Mối quan hệ',
    profile_saved_toast: 'Đã lưu thông tin thành công',
    profile_error_toast: 'Lưu thất bại. Vui lòng thử lại.',

    no_bill_yet: 'Chưa có hóa đơn cho',
    total_with_amount: 'Tổng',
    room_rent: 'Tiền phòng',
    elec_bill: 'Tiền điện',
    water_bill: 'Tiền nước',
    water_flat: 'Nước khoán',
    water_excess: 'Nước vượt mức',
    grand_total: 'Tổng cộng',
    meter_readings: 'Số chỉ số đồng hồ',
    elec_meter: 'Đồng hồ điện',
    water_meter: 'Đồng hồ nước',
    unit: 'số/khối',

    scan_qr: 'Quét mã QR thanh toán',
    scan_qr_fine: 'Quét mã QR đóng phạt',
    attach_slip: 'Đính kèm biên lai chuyển khoản',
    uploading_slip: 'Đang tải hóa đơn...',
    slip_success_auto: 'Thanh toán thành công (Xác minh tự động)',
    slip_success_wait: 'Đã gửi biên lai, chờ chủ trọ xác nhận',
    slip_mismatch: 'Biên lai không khớp hóa đơn — chưa ghi nhận thanh toán',
    slip_fail: 'Tải lên thất bại',

    fine_reason: 'Khoản phạt',
    fine_date: 'Ngày',
    fine_note: 'Ghi chú',
    fine_wait_verify: 'Đang chờ xác minh biên lai',
    fine_paid_on: 'Đã đóng ngày',
    auto_verified: '(Tự động)',

    call: 'Gọi điện',

    report_repair: 'Báo sửa chữa',
    category: 'Danh mục',
    description: 'Chi tiết sự cố',
    desc_placeholder: 'Ví dụ: Điều hòa không mát, vòi nước rò rỉ...',
    urgency: 'Mức độ khẩn cấp',
    urgent: 'Khẩn cấp',
    normal: 'Bình thường',
    attach_photo: 'Hình ảnh đính kèm',
    optional: 'Không bắt buộc',
    take_photo: 'Chụp ảnh / Chọn tệp',
    sending: 'Đang gửi...',
    send_request: 'Gửi yêu cầu',
    repair_success_toast: 'Đã gửi yêu cầu sửa chữa thành công',
    status_open: 'Chờ xử lý',
    status_in_progress: 'Đang thực hiện',
    status_resolved: 'Hoàn thành',
    status_cancelled: 'Đã hủy',

    verify_pin_title: 'Xác thực bảo mật',
    verify_pin_desc: 'Nhập mã PIN 4 số nhận từ chủ trọ',
    enter_portal: 'Vào cổng thông tin',
    pin_incorrect: 'Mã PIN không đúng, vui lòng thử lại',
    loading: 'Đang tải...',
    error_title: 'Không tìm thấy dữ liệu',
    contact_owner_hint: 'Vui lòng liên hệ chủ trọ',
    invalid_link: 'Liên kết không hợp lệ',
    use_direct_link: 'Vui lòng sử dụng liên kết do chủ trọ cung cấp',
    powered_by: 'Powered by HorCare',
  },
};

export function formatPortalMonth(yearMonth: string, lang: BillLanguage): string {
  if (!yearMonth) return '';
  const [yearStr, monthStr] = yearMonth.split('-');
  const y = parseInt(yearStr, 10);
  const m = parseInt(monthStr, 10);
  if (isNaN(y) || isNaN(m)) return yearMonth;

  if (lang === 'th') {
    const thMonths = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    return `${thMonths[m - 1] ?? monthStr} ${y + 543}`;
  }

  if (lang === 'en') {
    const enMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${enMonths[m - 1] ?? monthStr} ${y}`;
  }

  if (lang === 'zh') {
    return `${y}年${m}月`;
  }

  if (lang === 'my') {
    const myMonths = ['ဇန်နဝါရီ', 'ဖေဖော်ဝါရီ', 'မတ်', 'ဧပြီ', 'မေ', 'ဇွန်', 'ဇူလိုင်', 'ဩဂုတ်', 'စက်တင်ဘာ', 'အောက်တိုဘာ', 'နိုဝင်ဘာ', 'ဒီဇင်ဘာ'];
    return `${myMonths[m - 1] ?? monthStr} ${y}`;
  }

  if (lang === 'lo') {
    const loMonths = ['ມ.ກ.', 'ກ.ພ.', 'ມ.ນ.', 'ເມ.ສ.', 'ພ.ພ.', 'ມິ.ຖ.', 'ກ.ລ.', 'ສ.ຫ.', 'ກ.ຍ.', 'ຕ.ລ.', 'ພ.ຈ.', 'ທ.ວ.'];
    return `${loMonths[m - 1] ?? monthStr} ${y}`;
  }

  if (lang === 'vi') {
    return `T${m} ${y}`;
  }

  return `${monthStr}/${y}`;
}

export function translateCategory(cat: MaintenanceCategory, lang: BillLanguage): string {
  const map: Record<MaintenanceCategory, Record<BillLanguage, string>> = {
    electric: { th: 'ไฟฟ้า', en: 'Electrical', zh: '电路', my: 'လျှပ်စစ်', lo: 'ໄຟຟ້າ', vi: 'Điện' },
    plumbing: { th: 'ประปา', en: 'Plumbing', zh: '水管', my: 'ရေပိုက်', lo: 'ປະປາ', vi: 'Ống nước' },
    appliance: { th: 'เครื่องใช้ไฟฟ้า', en: 'Appliances', zh: '家用电器', my: 'လျှပ်စစ်ပစ္စည်း', lo: 'ເຄື່ອງໃຊ້ໄຟຟ້າ', vi: 'Thiết bị điện' },
    ac: { th: 'แอร์', en: 'Air Conditioner', zh: '空调', my: 'အဲယားကွန်း', lo: 'ແອ', vi: 'Điều hòa' },
    door_window: { th: 'ประตู / หน้าต่าง', en: 'Doors / Windows', zh: '门窗', my: 'တံခါး/ပြတင်းပေါက်', lo: 'ປະຕູ/ປ່ອງຢ້ຽມ', vi: 'Cửa / Cửa sổ' },
    bathroom: { th: 'ห้องน้ำ', en: 'Bathroom', zh: '卫生间', my: 'အိမ်သာ', lo: 'ຫ້ອງນ້ຳ', vi: 'Phòng tắm' },
    furniture: { th: 'เฟอร์นิเจอร์', en: 'Furniture', zh: '家具', my: 'ပရိဘောဂ', lo: 'ເຟີນີເຈີ', vi: 'Nội thất' },
    other: { th: 'อื่นๆ', en: 'Other', zh: '其他', my: 'အခြား', lo: 'ອື່ນໆ', vi: 'Khác' },
  };

  return map[cat]?.[lang] ?? cat;
}

export function translateMaintenanceStatus(status: string, lang: BillLanguage): string {
  const t = PORTAL_TRANSLATIONS[lang] ?? PORTAL_TRANSLATIONS.th;
  switch (status) {
    case 'open':
      return t.status_open;
    case 'in_progress':
      return t.status_in_progress;
    case 'done':
    case 'resolved':
      return t.status_resolved;
    case 'rejected':
    case 'cancelled':
      return t.status_cancelled;
    default:
      return status;
  }
}

export function formatPortalDate(dateStr?: string, lang: BillLanguage = 'th'): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;

    if (lang === 'th') {
      return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (lang === 'en') {
      return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    if (lang === 'zh') {
      return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    if (lang === 'my') {
      return `${d.getDate()} ${d.getMonth() + 1}, ${d.getFullYear()}`;
    }
    if (lang === 'lo') {
      return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543}`;
    }
    if (lang === 'vi') {
      return `${d.getDate()} thg ${d.getMonth() + 1}, ${d.getFullYear()}`;
    }
    return d.toLocaleDateString();
  } catch {
    return dateStr;
  }
}
