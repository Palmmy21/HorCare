export type BillLanguage = 'th' | 'en' | 'my' | 'zh' | 'lo' | 'vi';

export type TranslationKey =
    | 'invoice_title'
    | 'receipt_title'
    | 'invoice_or_receipt'
    | 'room'
    | 'month'
    | 'bill_date'
    | 'tenant_count'
    | 'person_unit'
    | 'item'
    | 'units_used'
    | 'rate_per_unit'
    | 'amount_thb'
    | 'room_rent'
    | 'semester_rent'
    | 'electricity'
    | 'water'
    | 'water_flat'
    | 'water_excess'
    | 'water_excess_detail'
    | 'common_fee'
    | 'total_amount'
    | 'due_date'
    | 'scan_promptpay'
    | 'prev_reading'
    | 'curr_reading'
    | 'unit_label'
    | 'baht_label'
    | 'due_notice_prefix'
    | 'due_notice_suffix'
    | 'flex_service_bill'
    | 'flex_open_portal'
    | 'flex_split_pay'
    | 'flex_send_slip';

export const TRANSLATIONS: Record<BillLanguage, Record<TranslationKey, string>> = {
    th: {
        invoice_title: 'ใบแจ้งหนี้',
        receipt_title: 'ใบเสร็จรับเงิน',
        invoice_or_receipt: 'ใบแจ้งหนี้ / ใบเสร็จรับเงิน',
        room: 'ห้องพัก',
        month: 'ประจำเดือน',
        bill_date: 'วันที่ออกบิล',
        tenant_count: 'จำนวนผู้เช่า',
        person_unit: 'คน',
        item: 'รายการ',
        units_used: 'หน่วยที่ใช้',
        rate_per_unit: 'ค่าต่อหน่วย',
        amount_thb: 'จำนวนเงิน (บาท)',
        room_rent: 'ค่าเช่าห้องพัก',
        semester_rent: 'รายเทอม (ไม่คิดค่าเช่ารายเดือน)',
        electricity: 'ค่าไฟฟ้า',
        water: 'ค่าน้ำประปา',
        water_flat: 'ค่าน้ำประปา (เหมาจ่าย)',
        water_excess: 'ค่าน้ำส่วนเกิน',
        water_excess_detail: 'ใช้เกินจากเหมา',
        common_fee: 'ค่าส่วนกลาง',
        total_amount: 'รวมทั้งสิ้น',
        due_date: 'กำหนดชำระ',
        scan_promptpay: 'สแกนจ่ายผ่านแอปธนาคาร',
        prev_reading: 'เลขเดือนก่อน',
        curr_reading: 'เดือนนี้',
        unit_label: 'หน่วย',
        baht_label: 'บาท',
        due_notice_prefix: 'กรุณาชำระภายในวันที่',
        due_notice_suffix: 'ของทุกเดือน',
        flex_service_bill: '📋 ใบแจ้งค่าบริการ',
        flex_open_portal: '🔗 เปิดพอร์ทัล / ดูบิล',
        flex_split_pay: '💸 แบ่งจ่าย',
        flex_send_slip: '📎 กรุณาส่งสลิปยืนยันการโอนเงินมาในแชทนี้ด้วยนะคะ 🙏',
    },
    en: {
        invoice_title: 'INVOICE',
        receipt_title: 'RECEIPT',
        invoice_or_receipt: 'INVOICE / RECEIPT',
        room: 'Room',
        month: 'Billing Month',
        bill_date: 'Issue Date',
        tenant_count: 'Tenants',
        person_unit: 'person(s)',
        item: 'Item Description',
        units_used: 'Units Used',
        rate_per_unit: 'Rate / Unit',
        amount_thb: 'Amount (THB)',
        room_rent: 'Room Rent',
        semester_rent: 'Semester Rent (No monthly charge)',
        electricity: 'Electricity Fee',
        water: 'Water Supply',
        water_flat: 'Water Supply (Flat Rate)',
        water_excess: 'Excess Water Fee',
        water_excess_detail: 'Exceeded over flat quota',
        common_fee: 'Common Area Fee',
        total_amount: 'Total Amount',
        due_date: 'Due Date',
        scan_promptpay: 'Scan to pay with your banking app',
        prev_reading: 'Previous meter',
        curr_reading: 'Current meter',
        unit_label: 'unit(s)',
        baht_label: 'THB',
        due_notice_prefix: 'Please make payment before the',
        due_notice_suffix: 'of each month',
        flex_service_bill: '📋 Service Invoice',
        flex_open_portal: '🔗 View Bill / Portal',
        flex_split_pay: '💸 Pay in parts',
        flex_send_slip: '📎 Please attach transfer slip in this chat. Thank you! 🙏',
    },
    my: {
        invoice_title: 'ငွေတောင်းခံလွှာ',
        receipt_title: 'ငွေပြေစာ',
        invoice_or_receipt: 'ငွေတောင်းခံလွှာ / ငွေပြေစာ',
        room: 'အခန်း',
        month: 'လအတွက်',
        bill_date: 'ရက်စွဲ',
        tenant_count: 'အငှားနေသူဦးရေ',
        person_unit: 'ယောက်',
        item: 'အကြောင်းအရာ',
        units_used: 'သုံးစွဲယူနစ်',
        rate_per_unit: 'တစ်ယူနစ်နှုန်း',
        amount_thb: 'ကျသင့်ငွေ (ဘတ်)',
        room_rent: 'အခန်းခ',
        semester_rent: 'စာသင်နှစ်အလိုက် (လစဉ်အခန်းခမရှိပါ)',
        electricity: 'မီးဖိုး',
        water: 'ရေဖိုး',
        water_flat: 'ရေဖိုး (အလုံးစုံ)',
        water_excess: 'ရေဖိုး (ပိုယူ)',
        water_excess_detail: 'အလုံးစုံထက် ပိုသုံးယူနစ်',
        common_fee: 'အများသုံးခ',
        total_amount: 'စုစုပေါင်း',
        due_date: 'ပေးချေရန်နောက်ဆုံးရက်',
        scan_promptpay: 'ဘဏ်အက်ပ်ဖြင့် စကင်ဖတ်၍ ပေးချေရန်',
        prev_reading: 'ယခင်လမီတာ',
        curr_reading: 'ယခုလမီတာ',
        unit_label: 'ယူနစ်',
        baht_label: 'ဘတ်',
        due_notice_prefix: 'လစဉ်',
        due_notice_suffix: 'ရက်မတိုင်မီ ငွေပေးချေပါရန်',
        flex_service_bill: '📋 ဝန်ဆောင်ခတောင်းခံလွှာ',
        flex_open_portal: '🔗 ဘေလ်ကြည့်ရန် / ပေါ်တယ်',
        flex_split_pay: '💸 အရစ်ကျပေးမည်',
        flex_send_slip: '📎 ငွေလွှဲစလစ်ကို ဤချက်ထဲသို့ ပို့ပေးပါ ကျေးဇူးတင်ပါသည် 🙏',
    },
    zh: {
        invoice_title: '账单明细',
        receipt_title: '收据',
        invoice_or_receipt: '账单 / 收据',
        room: '房间号',
        month: '账单月份',
        bill_date: '开单日期',
        tenant_count: '入住人数',
        person_unit: '人',
        item: '费用项目',
        units_used: '使用度数',
        rate_per_unit: '单价',
        amount_thb: '金额 (泰铢)',
        room_rent: '房屋租金',
        semester_rent: '按学期收费（免月租）',
        electricity: '电费',
        water: '水费',
        water_flat: '水费（包月）',
        water_excess: '超额水费',
        water_excess_detail: '超出包月用量',
        common_fee: '物业管理费',
        total_amount: '应付总额',
        due_date: '截止付款日',
        scan_promptpay: '使用银行App扫码支付',
        prev_reading: '上月读数',
        curr_reading: '本月读数',
        unit_label: '度',
        baht_label: '泰铢',
        due_notice_prefix: '请在每月',
        due_notice_suffix: '日前完成缴费',
        flex_service_bill: '📋 账单服务通知',
        flex_open_portal: '🔗 查看账单详情',
        flex_split_pay: '💸 分期付款',
        flex_send_slip: '📎 转账后请在此聊天发送付款水单凭证，谢谢！🙏',
    },
    lo: {
        invoice_title: 'ໃບແຈ້ງໜີ້',
        receipt_title: 'ໃບຮັບເງິນ',
        invoice_or_receipt: 'ໃບແຈ້ງໜີ້ / ໃບຮັບເງິນ',
        room: 'ຫ້ອງພັກ',
        month: 'ປະຈຳເດືອນ',
        bill_date: 'ວັນທີອອກບິນ',
        tenant_count: 'ຈຳນວນຜູ້ເຊົ່າ',
        person_unit: 'ຄົນ',
        item: 'ລາຍການ',
        units_used: 'ໜ່ວຍທີ່ໃຊ້',
        rate_per_unit: 'ຄ່າຕໍ່ໜ່ວຍ',
        amount_thb: 'ຈຳນວນເງິນ (ບາດ)',
        room_rent: 'ຄ່າເຊົ່າຫ້ອງພັກ',
        semester_rent: 'ລາຍພາກຮຽນ (ບໍ່ຄິດຄ່າເຊົ່າລາຍເດືອນ)',
        electricity: 'ຄ່າໄຟຟ້າ',
        water: 'ຄ່ານ້ຳປະປາ',
        water_flat: 'ຄ່ານ້ຳປະປາ (ເໝົາຈ່າຍ)',
        water_excess: 'ຄ່ານ້ຳສ່ວນເກີນ',
        water_excess_detail: 'ໃຊ້ເກີນຈາກເໝົາ',
        common_fee: 'ຄ່າສ່ວນກາງ',
        total_amount: 'ລວມທັງໝົດ',
        due_date: 'ກຳນົດຊຳລະ',
        scan_promptpay: 'ສະແກນຈ່າຍຜ່ານແອັບທະນາຄານ',
        prev_reading: 'ເລກເດືອນກ່ອນ',
        curr_reading: 'ເດືອນນີ້',
        unit_label: 'ໜ່ວຍ',
        baht_label: 'ບາດ',
        due_notice_prefix: 'ກະລຸນາຊຳລະພາຍໃນວັນທີ',
        due_notice_suffix: 'ຂອງທຸກເດືອນ',
        flex_service_bill: '📋 ໃບແຈ້ງຄ່າບໍລິການ',
        flex_open_portal: '🔗 ເປີດພໍທັລ / ເບິ່ງບິນ',
        flex_split_pay: '💸 ແບ່ງຈ່າຍ',
        flex_send_slip: '📎 ກະລຸນາສົ່ງສະລິບຢືນຢັນການໂອນເງິນມາໃນແຊັດນີ້ດ້ວຍ ຂອບໃຈ 🙏',
    },
    vi: {
        invoice_title: 'HÓA ĐƠN',
        receipt_title: 'BIÊN LAI',
        invoice_or_receipt: 'HÓA ĐƠN / BIÊN LAI',
        room: 'Phòng',
        month: 'Kỳ tháng',
        bill_date: 'Ngày lập',
        tenant_count: 'Số người ở',
        person_unit: 'người',
        item: 'Khoản mục',
        units_used: 'Số lượng dùng',
        rate_per_unit: 'Đơn giá',
        amount_thb: 'Thành tiền (THB)',
        room_rent: 'Tiền thuê phòng',
        semester_rent: 'Theo kỳ học (Không thu theo tháng)',
        electricity: 'Tiền điện',
        water: 'Tiền nước',
        water_flat: 'Tiền nước (Khoán)',
        water_excess: 'Tiền nước vượt khoán',
        water_excess_detail: 'Vượt mức khoán định mức',
        common_fee: 'Phí dịch vụ chung',
        total_amount: 'Tổng cộng',
        due_date: 'Hạn thanh toán',
        scan_promptpay: 'Quét mã thanh toán bằng ứng dụng ngân hàng',
        prev_reading: 'Chỉ số trước',
        curr_reading: 'Chỉ số này',
        unit_label: 'số',
        baht_label: 'THB',
        due_notice_prefix: 'Vui lòng thanh toán trước ngày',
        due_notice_suffix: 'hàng tháng',
        flex_service_bill: '📋 Thông báo hoá đơn dịch vụ',
        flex_open_portal: '🔗 Xem hoá đơn / Cổng thông tin',
        flex_split_pay: '💸 Trả một phần',
        flex_send_slip: '📎 Vui lòng gửi ảnh biên lai chuyển khoản vào đoạn chat này 🙏',
    },
};

const MONTH_NAMES_SHORT: Record<BillLanguage, string[]> = {
    th: ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
    en: ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    my: ['', 'ဇန်', 'ဖေ', 'မတ်', 'ဧပြီ', 'မေ', 'ဇွန်', 'ဇူ', 'ဩ', 'စက်', 'အောက်', 'နို', 'ဒီ'],
    zh: ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    lo: ['', 'ມ.ກ.', 'ກ.ພ.', 'ມ.ນ.', 'ມ.ສ.', 'ພ.ພ.', 'ມິ.ຖ.', 'ກ.ລ.', 'ສ.ຫ.', 'ກ.ຍ.', 'ຕ.ລ.', 'ພ.ຈ.', 'ທ.ວ.'],
    vi: ['', 'Thg 1', 'Thg 2', 'Thg 3', 'Thg 4', 'Thg 5', 'Thg 6', 'Thg 7', 'Thg 8', 'Thg 9', 'Thg 10', 'Thg 11', 'Thg 12'],
};

export function t(key: TranslationKey, lang: BillLanguage = 'th'): string {
    const dict = TRANSLATIONS[lang] || TRANSLATIONS.th;
    return dict[key] || TRANSLATIONS.th[key] || key;
}

export function tBilingual(
    key: TranslationKey,
    primaryLang: BillLanguage = 'th',
    bilingual: boolean = false,
    secondaryLang: BillLanguage = 'en'
): string {
    const primary = t(key, primaryLang);
    if (!bilingual || primaryLang === secondaryLang) {
        return primary;
    }
    const secondary = t(key, secondaryLang);
    return `${primary} / ${secondary}`;
}

export function formatMonthLabel(month: string, lang: BillLanguage = 'th'): string {
    const [year, mon] = (month || '').split('-');
    if (!year || !mon) return month || '';
    const m = parseInt(mon, 10);
    const y = parseInt(year, 10);
    const months = MONTH_NAMES_SHORT[lang] || MONTH_NAMES_SHORT.th;
    const monthName = months[m] || `${m}`;
    if (lang === 'th') {
        return `${monthName} ${y + 543}`;
    }
    return `${monthName} ${y}`;
}
