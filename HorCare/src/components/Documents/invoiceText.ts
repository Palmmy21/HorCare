/**
 * The A4 invoice's wording in every bill language. Words the old bill already had come from billTranslations, so a
 * tenant sees the same terms in LINE, the portal and on paper; the rest are the A4 document's own.
 */
import type { BillLanguage } from '../../types';
import { TRANSLATIONS } from '../../utils/i18n/billTranslations';

export interface InvoiceText {
    title: string;
    billed_to: string;
    unit: string;
    service_month: string;   // {month}
    invoice_no: string;
    issued: string;
    due: string;
    item: string;
    qty: string;
    rate: string;
    amount: string;
    rent: string;
    elec: string;
    water: string;
    water_flat: string;
    water_excess: string;
    meter: string;           // {from} {to}
    prorate: string;         // {days} {of}
    unit_label: string;
    amount_words: string;
    items_total: string;     // {n}
    grand_total: string;
    note: string;
    payment: string;
    paid_on: string;         // {date}
    paid_amount: string;     // {amount}
    ref: string;
    stamp: string;
    channel: string;
    account_no: string;
    account_name: string;
    promptpay: string;
    scan_hint: string;
    issuer_role: string;
    footer: string;
    tenant_of: string;       // {unit} {no}
    locale: string;
}

const OWN: Record<BillLanguage, Omit<InvoiceText, 'title' | 'item' | 'rate' | 'amount' | 'elec' | 'water' | 'water_flat' | 'water_excess' | 'due' | 'issued' | 'unit' | 'unit_label' | 'scan_hint'>> = {
    th: {
        billed_to: 'เรียกเก็บจาก', service_month: 'ค่าบริการประจำเดือน {month}', invoice_no: 'เลขที่', qty: 'จำนวน',
        rent: 'ค่าเช่า', meter: 'มิเตอร์ {from} → {to}', prorate: 'คิดตามจริง {days} จาก {of} วัน',
        amount_words: 'จำนวนเงิน (ตัวอักษร)', items_total: 'รวม {n} รายการ', grand_total: 'ยอดชำระทั้งสิ้น', note: 'หมายเหตุ',
        payment: 'การชำระเงิน', paid_on: 'ได้รับชำระแล้ว เมื่อ {date}', paid_amount: 'จำนวน {amount} บาท', ref: 'อ้างอิง',
        stamp: 'ชำระแล้ว', channel: 'ช่องทางชำระเงิน', account_no: 'เลขที่บัญชี', account_name: 'ชื่อบัญชี', promptpay: 'พร้อมเพย์',
        issuer_role: 'ผู้ออกเอกสาร', footer: 'เอกสารนี้ออกโดยระบบ HorCare · หากชำระแล้วโปรดเก็บหลักฐานการโอนไว้',
        tenant_of: 'ผู้เช่า{unit} {no}', locale: 'th-TH',
    },
    en: {
        billed_to: 'Bill to', service_month: 'Charges for {month}', invoice_no: 'Invoice no.', qty: 'Qty',
        rent: 'Rent', meter: 'Meter {from} → {to}', prorate: 'Prorated: {days} of {of} days',
        amount_words: 'Amount in words', items_total: '{n} item(s)', grand_total: 'Total due', note: 'Note',
        payment: 'Payment', paid_on: 'Paid on {date}', paid_amount: 'amount {amount} THB', ref: 'Ref.',
        stamp: 'PAID', channel: 'How to pay', account_no: 'Account no.', account_name: 'Account name', promptpay: 'PromptPay',
        issuer_role: 'Issued by', footer: 'Issued by HorCare · Please keep your transfer slip',
        tenant_of: 'Tenant of {unit} {no}', locale: 'en-GB',
    },
    my: {
        billed_to: 'ငွေတောင်းခံသူ', service_month: '{month} အတွက် ကျသင့်ငွေ', invoice_no: 'အမှတ်', qty: 'အရေအတွက်',
        rent: 'အခန်းခ', meter: 'မီတာ {from} → {to}', prorate: '{of} ရက်အနက် {days} ရက်',
        amount_words: 'ငွေပမာဏ (စာဖြင့်)', items_total: 'စုစုပေါင်း {n} ခု', grand_total: 'ပေးရန်စုစုပေါင်း', note: 'မှတ်ချက်',
        payment: 'ငွေပေးချေမှု', paid_on: '{date} တွင် ပေးချေပြီး', paid_amount: '{amount} ဘတ်', ref: 'ကိုးကား',
        stamp: 'ပေးချေပြီး', channel: 'ငွေပေးချေရန်', account_no: 'အကောင့်နံပါတ်', account_name: 'အကောင့်အမည်', promptpay: 'PromptPay',
        issuer_role: 'ထုတ်ပေးသူ', footer: 'HorCare မှ ထုတ်ပေးသည် · ငွေလွှဲပြေစာကို သိမ်းထားပါ',
        tenant_of: '{unit} {no} အငှားသူ', locale: 'my-MM',
    },
    zh: {
        billed_to: '付款人', service_month: '{month} 费用', invoice_no: '账单编号', qty: '数量',
        rent: '租金', meter: '读数 {from} → {to}', prorate: '按实际 {days}/{of} 天计算',
        amount_words: '金额（大写）', items_total: '共 {n} 项', grand_total: '应付总额', note: '备注',
        payment: '付款', paid_on: '已于 {date} 付款', paid_amount: '金额 {amount} 泰铢', ref: '参考号',
        stamp: '已付款', channel: '付款方式', account_no: '账号', account_name: '户名', promptpay: 'PromptPay',
        issuer_role: '开单人', footer: '本单据由 HorCare 系统开具 · 请保留转账凭证',
        tenant_of: '{unit} {no} 租户', locale: 'zh-CN',
    },
    lo: {
        billed_to: 'ເກັບເງິນຈາກ', service_month: 'ຄ່າບໍລິການປະຈຳເດືອນ {month}', invoice_no: 'ເລກທີ', qty: 'ຈຳນວນ',
        rent: 'ຄ່າເຊົ່າ', meter: 'ມິເຕີ {from} → {to}', prorate: 'ຄິດຕາມຈິງ {days} ຈາກ {of} ວັນ',
        amount_words: 'ຈຳນວນເງິນ (ຕົວໜັງສື)', items_total: 'ລວມ {n} ລາຍການ', grand_total: 'ຍອດຊຳລະທັງໝົດ', note: 'ໝາຍເຫດ',
        payment: 'ການຊຳລະເງິນ', paid_on: 'ໄດ້ຮັບຊຳລະແລ້ວ ວັນທີ {date}', paid_amount: 'ຈຳນວນ {amount} ບາດ', ref: 'ອ້າງອີງ',
        stamp: 'ຊຳລະແລ້ວ', channel: 'ຊ່ອງທາງຊຳລະເງິນ', account_no: 'ເລກບັນຊີ', account_name: 'ຊື່ບັນຊີ', promptpay: 'PromptPay',
        issuer_role: 'ຜູ້ອອກເອກະສານ', footer: 'ເອກະສານນີ້ອອກໂດຍລະບົບ HorCare · ກະລຸນາເກັບຫຼັກຖານການໂອນໄວ້',
        tenant_of: 'ຜູ້ເຊົ່າ{unit} {no}', locale: 'lo-LA',
    },
    vi: {
        billed_to: 'Người thanh toán', service_month: 'Phí tháng {month}', invoice_no: 'Số hóa đơn', qty: 'Số lượng',
        rent: 'Tiền thuê', meter: 'Chỉ số {from} → {to}', prorate: 'Tính theo thực tế {days}/{of} ngày',
        amount_words: 'Số tiền bằng chữ', items_total: '{n} khoản', grand_total: 'Tổng phải trả', note: 'Ghi chú',
        payment: 'Thanh toán', paid_on: 'Đã thanh toán ngày {date}', paid_amount: 'số tiền {amount} THB', ref: 'Mã tham chiếu',
        stamp: 'ĐÃ THANH TOÁN', channel: 'Cách thanh toán', account_no: 'Số tài khoản', account_name: 'Tên tài khoản', promptpay: 'PromptPay',
        issuer_role: 'Người lập', footer: 'Phát hành bởi HorCare · Vui lòng giữ biên lai chuyển khoản',
        tenant_of: 'Người thuê {unit} {no}', locale: 'vi-VN',
    },
};

export function invoiceText(lang: BillLanguage): InvoiceText {
    const l = OWN[lang] ? lang : 'th';
    const t = TRANSLATIONS[l];
    return {
        ...OWN[l],
        title: t.invoice_title,
        unit: t.room,
        issued: t.bill_date,
        due: t.due_date,
        item: t.item,
        rate: t.rate_per_unit,
        amount: t.amount_thb,
        elec: t.electricity,
        water: t.water,
        water_flat: t.water_flat,
        water_excess: t.water_excess,
        unit_label: t.unit_label,
        scan_hint: t.scan_promptpay,
    };
}

/** Fill {placeholders}. */
export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
