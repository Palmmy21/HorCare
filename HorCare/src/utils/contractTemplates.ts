import type { DormConfig, Room, TenantProfile, ContractTemplate } from '../types';
import { getWorkspaceTerms } from './workspaceTerminology';

export interface ContractFormState {
  contract_number: string;
  contract_type: 'market_stall' | 'residential' | 'commercial';
  title: string;
  template_id?: string;
  
  // Lessor (ผู้ให้เช่า)
  lessor_name: string;
  lessor_phone: string;
  lessor_id_card: string;
  lessor_address: string;
  lessor_signature?: string;
  lessor_signed_at?: string;

  // Lessee (ผู้เช่า / ผู้ค้า)
  lessee_name: string;
  lessee_phone: string;
  lessee_id_card: string;
  lessee_address: string;
  lessee_business_type?: string;
  lessee_signature?: string;
  lessee_signed_at?: string;

  // Unit
  unit_number: string;
  zone_or_floor: string;
  stall_or_room_size: string;
  rent_amount: number;
  rent_cycle: 'daily' | 'weekly' | 'monthly' | 'yearly';
  deposit_amount: number;
  start_date: string;
  end_date: string;

  // Utilities
  electricity_rate_desc: string;
  water_rate_desc: string;
  waste_fee_desc: string;

  // Terms & Conditions
  clauses: string[];
  custom_terms: string;
}

export function generateContractNumber(type: string, unitNumber: string): string {
  const prefix = type === 'market' ? 'HC-MK' : type === 'commercial' ? 'HC-CM' : 'HC-DM';
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  const cleanUnit = unitNumber.replace(/[^a-zA-Z0-9]/g, '') || '01';
  return `${prefix}-${yearMonth}-${cleanUnit}-${randomSuffix}`;
}

export function generateVerificationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'HC-SIGN-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function getDefaultContractClauses(buildingType?: DormConfig['building_type']): string[] {
  const terms = getWorkspaceTerms(buildingType);

  if (terms.isMarket) {
    return [
      '1. วัตถุประสงค์การเช่า: ผู้เช่ายินยอมใช้แผงค้า/ล็อกนี้เพื่อจำหน่ายสินค้าตามประเภทที่ระบุไว้เท่านั้น ห้ามเปลี่ยนประเภทสินค้าหรือให้เช่าช่วงโดยไม่ได้รับความยินยอมเป็นลายลักษณ์อักษรจากผู้ให้เช่า',
      '2. การชำระค่าเช่า: ผู้เช่าตกลงชำระค่าเช่าแผงตามรอบเวลาที่กำหนด หากผิดนัดชำระเกินกว่าระยะเวลาที่ตกลง ผู้ให้เช่ามีสิทธิ์ระงับการเข้าใช้พื้นที่และนำแผงออกให้ผู้อื่นเช่าทันที',
      '3. การรักษาความสะอาดและสุขาภิบาล: ผู้เช่าต้องดูแลความสะอาดบริเวณแผงค้าของตน เก็บเศษขยะลงในถังขยะที่ตลาดจัดเตรียมไว้ และทำความสะอาดพื้นที่แผงทุกครั้งหลังปิดการขาย ห้ามเทเศษอาหารหรือน้ำมันลงท่อระบายน้ำโดยเด็ดขาด',
      '4. ระเบียบการใช้พื้นที่และทางเดิน: ห้ามวางสินค้า โต๊ะ เก้าอี้ หรือป้ายล้ำแนวทางเดินของตลาด เพื่อความปลอดภัยและความสะดวกของผู้มาจับจ่ายใช้สอย',
      '5. การใช้กระแสไฟฟ้าและเปลวไฟ: การใช้เครื่องใช้ไฟฟ้าหรือแก๊สหุงต้ม ต้องได้รับการตรวจสอบความปลอดภัยจากผู้ดูแลตลาด ห้ามพ่วงสายไฟโดยพลการ และต้องมีถังดับเพลิงประจำแผงตามมาตรฐานความปลอดภัย',
      '6. เงินมัดจำ/ประกันความเสียหาย: เงินมัดจำแผงจะได้รับคืนเต็มจำนวนเมื่อสิ้นสุดสัญญา หลังจากหักค่าเสียหาย ค่าสาธารณูปโภคค้างชำระ หรือค่าทำความสะอาดแผง (ถ้ามี)',
      '7. การบอกเลิกสัญญา: หากฝ่ายใดฝ่ายหนึ่งประสงค์จะยกเลิกสัญญา จะต้องแจ้งให้อีกฝ่ายทราบล่วงหน้าไม่น้อยกว่า 15 วัน',
    ];
  }

  if (terms.isCommercial) {
    return [
      '1. วัตถุประสงค์: ผู้เช่าจะใช้อาคาร/คูหานี้เพื่อประกอบธุรกิจการค้าตามที่ระบุในสัญญาเท่านั้น ห้ามนำไปใช้ในทางที่ผิดกฎหมายหรือขัดต่อศีลธรรมอันดี',
      '2. การชำระค่าเช่าและค่าส่วนกลาง: ผู้เช่าตกลงชำระค่าเช่าและค่าบริการส่วนกลางภายในวันที่กำหนดของทุกเดือน หากล่าช้าจะมีค่าปรับตามระเบียบ',
      '3. การดัดแปลงต่อเติม: ห้ามดัดแปลง ต่อเติม เจาะ ทุบ โครงสร้างอาคาร เว้นแต่จะได้รับความยินยอมเป็นลายลักษณ์อักษรจากผู้ให้เช่า',
      '4. ค่าน้ำประปาและค่าไฟฟ้า: ผู้เช่าเป็นผู้รับผิดชอบชำระค่าน้ำ ค่าไฟฟ้า ตามอัตราหน่วยที่กำหนดในสัญญา หรือตามบิลเรียกเก็บของหน่วยงานราชการ',
      '5. การคืนพื้นที่: เมื่อสิ้นสุดสัญญา ผู้เช่าต้องส่งมอบพื้นที่คืนในสภาพเรียบร้อย สมบูรณ์ พร้อมใช้งานเหมือนวันเริ่มสัญญา',
    ];
  }

  // Default: Residential (หอพัก / อพาร์ตเมนต์)
  return [
    '1. วัตถุประสงค์: ผู้เช่าตกลงใช้ห้องพักนี้เพื่อการอยู่อาศัยตามปกติเท่านั้น ห้ามประกอบธุรกิจผิดกฎหมาย ห้ามส่งเสียงดังรบกวนผู้อื่น และห้ามนำสารเสพติดหรือวัตถุอันตรายเข้ามาในอาคาร',
    '2. การชำระค่าเช่าและสาธารณูปโภค: ผู้เช่าตกลงชำระค่าเช่าห้อง ค่าน้ำประปา ค่าไฟฟ้า และค่าบริการตามใบแจ้งหนี้ภายในวันที่ 5 ของทุกเดือน',
    '3. เงินประกันห้องพัก: เงินประกันสัญญาจะได้รับคืนเมื่อสิ้นสุดสัญญาและส่งมอบห้องพักเรียบร้อย หลังจากหักค่าเสียหาย ค่าสาธารณูปโภคค้างชำระ และค่าทำความสะอาดห้องพักตามจริง',
    '4. การดูแลรักษาทรัพย์สิน: ผู้เช่าต้องช่วยดูแลรักษาทรัพย์สิน อุปกรณ์ และเฟอร์นิเจอร์ภายในห้องพักให้อยู่ในสภาพดี หากเกิดความเสียหายจากความประมาทเลินเล่อ ผู้เช่าต้องเป็นผู้รับผิดชอบค่าซ่อมแซม',
    '5. การย้ายออกและการแจ้งล่วงหน้า: ผู้เช่าต้องแจ้งการย้ายออกล่วงหน้าเป็นลายลักษณ์อักษรไม่น้อยกว่า 30 วันก่อนวันสิ้นสุดสัญญา จึงจะมีสิทธิ์ได้รับเงินประกันคืนตามเงื่อนไข',
  ];
}

export function buildInitialContractForm(
  room: Room,
  config: DormConfig,
  profile?: TenantProfile | null
): ContractFormState {
  const terms = getWorkspaceTerms(config.building_type);
  const today = new Date().toISOString().slice(0, 10);
  
  // Calculate default 1-year or 6-month end date
  const defaultEndDate = new Date();
  defaultEndDate.setFullYear(defaultEndDate.getFullYear() + 1);
  const endIso = defaultEndDate.toISOString().slice(0, 10);

  // If stall has specific rent cycle
  const rentCycle = room.rent_type === 'daily' ? 'daily'
    : room.rent_type === 'weekly' ? 'weekly'
    : room.rent_type === 'yearly' ? 'yearly'
    : (config.market_config?.default_rent_cycle || 'monthly');

  // Descriptions for rates
  const elecDesc = terms.isMarket && config.market_config?.electricity_flat_fee
    ? `ค่าไฟเหมา ฿${config.market_config.electricity_flat_fee} บาท/วัน (หรือ ฿${config.electricity_rate} บาท/หน่วย)`
    : `หน่วยละ ฿${room.custom_electricity_rate ?? config.electricity_rate} บาท`;

  const waterDesc = config.water_config.type === 'normal'
    ? `หน่วยละ ฿${config.water_config.unit_rate || 20} บาท`
    : `เหมาจ่าย ฿${config.water_config.flat_price || 200} บาท (${config.water_config.flat_limit_unit || 10} หน่วยแรก)`;

  const wasteDesc = terms.isMarket && config.market_config?.waste_fee_per_stall
    ? `ค่าขยะและทำความสะอาดแผง ฿${config.market_config.waste_fee_per_stall} บาท/${config.market_config.waste_fee_cycle === 'monthly' ? 'เดือน' : 'วัน'}`
    : 'รวมในค่าส่วนกลางเรียบร้อยแล้ว';

  return {
    contract_number: generateContractNumber(config.building_type || 'dormitory', room.room_number),
    contract_type: terms.isMarket ? 'market_stall' : terms.isCommercial ? 'commercial' : 'residential',
    title: terms.contractTitle,

    // Lessor
    lessor_name: config.bill_customization?.dorm_name || 'ผู้จัดการ/เจ้าของโครงการ',
    lessor_phone: config.bill_customization?.dorm_phone || '',
    lessor_id_card: '',
    lessor_address: config.bill_customization?.dorm_address || '',

    // Lessee
    lessee_name: profile?.full_name || '',
    lessee_phone: profile?.phone || '',
    lessee_id_card: profile?.id_card_number || '',
    lessee_address: '',
    lessee_business_type: room.business_type || profile?.occupation || '',

    // Unit
    unit_number: room.room_number,
    zone_or_floor: room.zone || (terms.isMarket ? 'โซน A' : 'ชั้น 1'),
    stall_or_room_size: room.stall_size || (terms.isMarket ? (config.market_config?.default_stall_size || '2x2 ม.') : '24 ตร.ม.'),
    rent_amount: room.rent_amount || config.room_rent,
    rent_cycle: rentCycle,
    deposit_amount: profile?.deposit_amount ?? (terms.isMarket ? (room.rent_amount * 2 || 1000) : (config.room_rent || 3000)),
    start_date: profile?.move_in_date || today,
    end_date: profile?.contract_end_date || endIso,

    electricity_rate_desc: elecDesc,
    water_rate_desc: waterDesc,
    waste_fee_desc: wasteDesc,

    clauses: getDefaultContractClauses(config.building_type),
    custom_terms: '',
  };
}

export const DEFAULT_CONTRACT_TEMPLATES: ContractTemplate[] = [
  {
    id: 'tpl-residential-std',
    name: 'สัญญาเช่าห้องพักมาตรฐาน (หอพัก / อพาร์ตเมนต์)',
    contract_type: 'residential',
    title: 'สัญญาเช่าห้องพักและทรัพย์สิน',
    default_rent_cycle: 'monthly',
    is_default: true,
    clauses: [
      '1. วัตถุประสงค์: ผู้เช่าตกลงใช้ห้องพักนี้เพื่อการอยู่อาศัยตามปกติเท่านั้น ห้ามประกอบธุรกิจผิดกฎหมาย ห้ามส่งเสียงดังรบกวนผู้อื่น และห้ามนำสารเสพติดหรือวัตถุอันตรายเข้ามาในอาคาร',
      '2. การชำระค่าเช่าและสาธารณูปโภค: ผู้เช่าตกลงชำระค่าเช่าห้อง ค่าน้ำประปา ค่าไฟฟ้า และค่าบริการตามใบแจ้งหนี้ภายในวันที่ 5 ของทุกเดือน',
      '3. เงินประกันห้องพัก: เงินประกันสัญญาจะได้รับคืนเมื่อสิ้นสุดสัญญาและส่งมอบห้องพักเรียบร้อย หลังจากหักค่าเสียหาย ค่าสาธารณูปโภคค้างชำระ และค่าทำความสะอาดห้องพักตามจริง',
      '4. การดูแลรักษาทรัพย์สิน: ผู้เช่าต้องช่วยดูแลรักษาทรัพย์สิน อุปกรณ์ และเฟอร์นิเจอร์ภายในห้องพักให้อยู่ในสภาพดี หากเกิดความเสียหายจากความประมาทเลินเล่อ ผู้เช่าต้องเป็นผู้รับผิดชอบค่าซ่อมแซม',
      '5. การย้ายออกและการแจ้งล่วงหน้า: ผู้เช่าต้องแจ้งการย้ายออกล่วงหน้าเป็นลายลักษณ์อักษรไม่น้อยกว่า 30 วันก่อนวันสิ้นสุดสัญญา จึงจะมีสิทธิ์ได้รับเงินประกันคืนตามเงื่อนไข',
    ],
    custom_terms: 'ห้ามสูบบุหรี่ภายในห้องพัก และห้ามเลี้ยงสัตว์เลี้ยงทุกชนิดโดยไม่ได้รับอนุญาต',
  },
  {
    id: 'tpl-market-std',
    name: 'สัญญาเช่าแผงค้าและล็อกตลาด (Market Stall)',
    contract_type: 'market_stall',
    title: 'สัญญาเช่าแผงค้าและล็อกจำหน่ายสินค้า',
    default_rent_cycle: 'monthly',
    is_default: true,
    clauses: [
      '1. วัตถุประสงค์การเช่า: ผู้เช่ายินยอมใช้แผงค้า/ล็อกนี้เพื่อจำหน่ายสินค้าตามประเภทที่ระบุไว้เท่านั้น ห้ามเปลี่ยนประเภทสินค้าหรือให้เช่าช่วงโดยไม่ได้รับความยินยอมเป็นลายลักษณ์อักษรจากผู้ให้เช่า',
      '2. การชำระค่าเช่า: ผู้เช่าตกลงชำระค่าเช่าแผงตามรอบเวลาที่กำหนด หากผิดนัดชำระเกินกว่าระยะเวลาที่ตกลง ผู้ให้เช่ามีสิทธิ์ระงับการเข้าใช้พื้นที่และนำแผงออกให้ผู้อื่นเช่าทันที',
      '3. การรักษาความสะอาดและสุขาภิบาล: ผู้เช่าต้องดูแลความสะอาดบริเวณแผงค้าของตน เก็บเศษขยะลงในถังขยะที่ตลาดจัดเตรียมไว้ และทำความสะอาดพื้นที่แผงทุกครั้งหลังปิดการขาย ห้ามเทเศษอาหารหรือน้ำมันลงท่อระบายน้ำโดยเด็ดขาด',
      '4. ระเบียบการใช้พื้นที่และทางเดิน: ห้ามวางสินค้า โต๊ะ เก้าอี้ หรือป้ายล้ำแนวทางเดินของตลาด เพื่อความปลอดภัยและความสะดวกของผู้มาจับจ่ายใช้สอย',
      '5. การใช้กระแสไฟฟ้าและเปลวไฟ: การใช้เครื่องใช้ไฟฟ้าหรือแก๊สหุงต้ม ต้องได้รับการตรวจสอบความปลอดภัยจากผู้ดูแลตลาด ห้ามพ่วงสายไฟโดยพลการ และต้องมีถังดับเพลิงประจำแผงตามมาตรฐานความปลอดภัย',
      '6. เงินมัดจำ/ประกันความเสียหาย: เงินมัดจำแผงจะได้รับคืนเต็มจำนวนเมื่อสิ้นสุดสัญญา หลังจากหักค่าเสียหาย ค่าสาธารณูปโภคค้างชำระ หรือค่าทำความสะอาดแผง (ถ้ามี)',
      '7. การบอกเลิกสัญญา: หากฝ่ายใดฝ่ายหนึ่งประสงค์จะยกเลิกสัญญา จะต้องแจ้งให้อีกฝ่ายทราบล่วงหน้าไม่น้อยกว่า 15 วัน',
    ],
    custom_terms: 'ต้องเปิดร้านจำหน่ายสินค้าไม่น้อยกว่า 24 วันต่อเดือน และปฏิบัติตามเวลาเปิด-ปิดของตลาดอย่างเคร่งครัด',
  },
  {
    id: 'tpl-commercial-std',
    name: 'สัญญาเช่าพื้นที่เชิงพาณิชย์และอาคาร (Commercial Space)',
    contract_type: 'commercial',
    title: 'สัญญาเช่าพื้นที่และอาคารพาณิชย์',
    default_rent_cycle: 'monthly',
    is_default: true,
    clauses: [
      '1. วัตถุประสงค์: ผู้เช่าจะใช้อาคาร/คูหานี้เพื่อประกอบธุรกิจการค้าตามที่ระบุในสัญญาเท่านั้น ห้ามนำไปใช้ในทางที่ผิดกฎหมายหรือขัดต่อศีลธรรมอันดี',
      '2. การชำระค่าเช่าและค่าส่วนกลาง: ผู้เช่าตกลงชำระค่าเช่าและค่าบริการส่วนกลางภายในวันที่กำหนดของทุกเดือน หากล่าช้าจะมีค่าปรับตามระเบียบ',
      '3. การดัดแปลงต่อเติม: ห้ามดัดแปลง ต่อเติม เจาะ ทุบ โครงสร้างอาคาร เว้นแต่จะได้รับความยินยอมเป็นลายลักษณ์อักษรจากผู้ให้เช่า',
      '4. ค่าน้ำประปาและค่าไฟฟ้า: ผู้เช่าเป็นผู้รับผิดชอบชำระค่าน้ำ ค่าไฟฟ้า ตามอัตราหน่วยที่กำหนดในสัญญา หรือตามบิลเรียกเก็บของหน่วยงานราชการ',
      '5. การคืนพื้นที่: เมื่อสิ้นสุดสัญญา ผู้เช่าต้องส่งมอบพื้นที่คืนในสภาพเรียบร้อย สมบูรณ์ พร้อมใช้งานเหมือนวันเริ่มสัญญา',
    ],
    custom_terms: 'ผู้เช่าต้องทำประกันวินาศภัยทรัพย์สินภายในอาคาร และรับผิดชอบค่าภาษีที่ดินและสิ่งปลูกสร้างตามสัดส่วนการใช้พื้นที่',
  },
  {
    id: 'tpl-short-term',
    name: 'สัญญาเช่าระยะสั้น / หมุนเวียน (รายวัน - รายสัปดาห์)',
    contract_type: 'market_stall',
    title: 'สัญญาเช่าพื้นที่ระยะสั้นและแผงชั่วคราว',
    default_rent_cycle: 'daily',
    is_default: true,
    clauses: [
      '1. ผู้เช่าตกลงเช่าพื้นที่ชั่วคราวตามวันที่และเวลาที่กำหนดไว้ และต้องชำระค่าเช่าล่วงหน้าก่อนเข้าใช้พื้นที่',
      '2. ผู้เช่าต้องเคลียร์สินค้าและทำความสะอาดพื้นที่ให้เสร็จสิ้นภายใน 1 ชั่วโมงหลังเวลาปิดตลาดของแต่ละวัน',
      '3. ห้ามวางสิ่งของทิ้งค้างคืนในพื้นที่ตลาดโดยไม่ได้รับอนุญาต มิฉะนั้นทางตลาดขอสงวนสิทธิ์ในการจัดเก็บและคิดค่าบริการ',
      '4. กรณีฝนตกหรือเกิดเหตุสุดวิสัย ทางตลาดไม่มีนโยบายคืนค่าเช่ารายวัน แต่สามารถพิจารณาชดเชยวันขายตามความเหมาะสม',
    ],
    custom_terms: 'ชำระค่าเช่าสดหรือโอนทันทีในวันเข้าใช้พื้นที่',
  },
];

export function getAllContractTemplates(config?: DormConfig): ContractTemplate[] {
  const customTemplates = config?.contract_templates || [];
  return [...DEFAULT_CONTRACT_TEMPLATES, ...customTemplates];
}

export function getDefaultTemplateForBuilding(
  buildingType?: DormConfig['building_type'],
  config?: DormConfig
): ContractTemplate {
  const all = getAllContractTemplates(config);
  const terms = getWorkspaceTerms(buildingType);
  if (terms.isMarket) {
    return all.find(t => t.id === 'tpl-market-std') || all[0];
  }
  if (terms.isCommercial) {
    return all.find(t => t.id === 'tpl-commercial-std') || all[0];
  }
  return all.find(t => t.id === 'tpl-residential-std') || all[0];
}

export function applyTemplateToForm(
  template: ContractTemplate,
  prev: ContractFormState
): ContractFormState {
  return {
    ...prev,
    template_id: template.id,
    title: template.title || prev.title,
    contract_type: template.contract_type || prev.contract_type,
    rent_cycle: template.default_rent_cycle || prev.rent_cycle,
    clauses: [...template.clauses],
    custom_terms: template.custom_terms ?? prev.custom_terms,
    electricity_rate_desc: template.electricity_rate_desc || prev.electricity_rate_desc,
    water_rate_desc: template.water_rate_desc || prev.water_rate_desc,
    waste_fee_desc: template.waste_fee_desc || prev.waste_fee_desc,
  };
}

