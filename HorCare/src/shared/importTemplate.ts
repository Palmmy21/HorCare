/**
 * The Excel template owners fill in before importing (ห้อง/บ้าน/คอนโด/ที่ดิน and their tenants).
 *
 * Sheet 1 is the one the import reads: headers only, so nothing from the examples can be imported by mistake.
 * Its headers are worded so the import recognises every column on its own (importTemplate.test.ts checks this).
 */
import { UNIT_CATEGORIES, UNIT_CATEGORY_LABELS } from './unitCategory.js';

type Cell = string | number | null;
export interface TemplateSheet { name: string; rows: Cell[][]; widths?: number[]; boldRows?: number[] }

export const TEMPLATE_HEADERS = [
    'เลขที่ยูนิต', 'หมวดหมู่', 'ตึก/อาคาร/โซน', 'ชั้น', 'ค่าเช่า', 'เงินมัดจำ', 'พื้นที่ (ตร.ม.)',
    'มิเตอร์ไฟล่าสุด', 'มิเตอร์น้ำล่าสุด', 'ชื่อผู้เช่า', 'เบอร์โทร', 'วันเข้าอยู่', 'วันสิ้นสุดสัญญา',
] as const;

const WIDTHS = [14, 16, 16, 8, 12, 12, 14, 16, 16, 26, 16, 14, 16];

const EXAMPLES: Cell[][] = [
    ['101', 'ห้องพัก', 'อาคาร A', '1', 3500, 7000, 24, 1520, 220, 'สมชาย ใจดี', '0812345678', '01/06/2569', '31/05/2570'],
    ['102', 'ห้องพัก', 'อาคาร A', '1', 3500, 7000, 24, 980, 154, '', '', '', ''],
    ['C-1205', 'คอนโด', 'ลุมพินี พาร์ค', '12', 12000, 24000, 35, 3410, 512, 'กนกวรรณ ศรีสุข', '0898765432', '15/03/2569', '14/03/2570'],
    ['99/1', 'บ้านเช่า', 'หมู่บ้านสวนสน', '', 15000, 30000, 120, 8820, 1301, 'วิชัย มั่นคง', '0861112222', '01/01/2569', ''],
    ['แปลง 3', 'ที่ดิน', 'ถนนบางนา-ตราด', '', 8000, 16000, 1600, '', '', 'บริษัท ตัวอย่าง จำกัด', '021234567', '01/10/2568', '30/09/2571'],
];

const GUIDE: [string, string, string][] = [
    ['เลขที่ยูนิต', 'จำเป็น', 'เลขห้อง บ้านเลขที่ หรือชื่อแปลง ห้ามซ้ำกันในสาขาเดียวกัน (ถ้าซ้ำกับที่มีอยู่ ระบบจะอัปเดตข้อมูลยูนิตนั้น)'],
    ['หมวดหมู่', 'ไม่บังคับ', `ประเภททรัพย์ของยูนิตนี้: ${UNIT_CATEGORIES.map(c => UNIT_CATEGORY_LABELS[c]).join(' / ')} — เว้นว่าง = ตามประเภทของสาขา`],
    ['ตึก/อาคาร/โซน', 'ไม่บังคับ', 'ชื่ออาคาร โครงการ หรือโซน ใช้จัดกลุ่ม'],
    ['ชั้น', 'ไม่บังคับ', 'เช่น 1, 2, 12'],
    ['ค่าเช่า', 'แนะนำ', 'ตัวเลขต่อรอบบิล (บาท) เช่น 3500 — ใส่ลูกน้ำหรือ "บาท" ได้'],
    ['เงินมัดจำ', 'ไม่บังคับ', 'ตัวเลข (บาท)'],
    ['พื้นที่ (ตร.ม.)', 'ไม่บังคับ', 'ตัวเลข ตารางเมตร (ที่ดิน 1 ไร่ = 1,600 ตร.ม.)'],
    ['มิเตอร์ไฟล่าสุด', 'ไม่บังคับ', 'เลขบนมิเตอร์ไฟครั้งล่าสุด ใช้เป็นจุดเริ่มคิดค่าไฟเดือนแรก — ที่ดินหรือยูนิตไม่มีมิเตอร์ให้เว้นว่าง'],
    ['มิเตอร์น้ำล่าสุด', 'ไม่บังคับ', 'เลขบนมิเตอร์น้ำครั้งล่าสุด'],
    ['ชื่อผู้เช่า', 'ไม่บังคับ', 'ชื่อ-นามสกุล หรือชื่อบริษัท — เว้นว่าง = ยูนิตว่าง'],
    ['เบอร์โทร', 'ไม่บังคับ', 'เช่น 0812345678 หรือ 081-234-5678'],
    ['วันเข้าอยู่', 'ไม่บังคับ', 'วัน/เดือน/ปี เช่น 01/06/2569 (ปี พ.ศ. หรือ ค.ศ. ก็ได้)'],
    ['วันสิ้นสุดสัญญา', 'ไม่บังคับ', 'วัน/เดือน/ปี — เว้นว่าง = ไม่มีกำหนด'],
];

/** The units a branch already has, as rows of the template — edit and import back to update them. */
export interface TemplateUnit {
    room_number: string; category?: string; building_name?: string; floor?: string;
    rent_amount?: number; deposit_amount?: number; area_sqm?: number | null;
    current_meter_elec?: number | null; current_meter_water?: number | null;
}

export function importTemplateSheets(units: TemplateUnit[] = []): TemplateSheet[] {
    const filled: Cell[][] = units.map(u => [
        u.room_number, u.category ?? '', u.building_name ?? '', u.floor ?? '', u.rent_amount ?? null, u.deposit_amount ?? null,
        u.area_sqm ?? null, u.current_meter_elec ?? null, u.current_meter_water ?? null, '', '', '', '',
    ]);
    return [
        { name: 'กรอกข้อมูล', rows: [[...TEMPLATE_HEADERS], ...filled], widths: WIDTHS, boldRows: [0] },
        { name: 'ตัวอย่าง', rows: [[...TEMPLATE_HEADERS], ...EXAMPLES], widths: WIDTHS, boldRows: [0] },
        {
            name: 'คำอธิบาย',
            rows: [
                ['วิธีใช้'],
                ['1. กรอกข้อมูลในชีต "กรอกข้อมูล" 1 แถวต่อ 1 ยูนิต (ดูแบบในชีต "ตัวอย่าง")'],
                ['2. ใส่ห้องพัก คอนโด บ้านเช่า และที่ดินรวมในไฟล์เดียวได้ แยกด้วยคอลัมน์ "หมวดหมู่"'],
                ['3. บันทึกไฟล์ แล้วไปที่ จัดการห้อง → นำเข้าจาก Excel → เลือกไฟล์นี้ ตรวจการจับคู่คอลัมน์ แล้วกดนำเข้า'],
                ['4. ที่ดินจะไม่ต้องจดมิเตอร์ ออกบิลเฉพาะค่าเช่าที่หน้า สรุปบิล → ออกบิลค่าเช่า'],
                [],
                ['คอลัมน์', 'จำเป็น?', 'วิธีกรอก'],
                ...GUIDE,
            ],
            widths: [20, 12, 100],
            boldRows: [0, 6],
        },
    ];
}
