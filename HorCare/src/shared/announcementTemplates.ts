// Ready-made announcement templates (power cut, water cut, maintenance, general). The owner picks one,
// fills a few fields, and gets a title and body that can still be edited before publishing.

export const TEMPLATE_IDS = ['power_outage', 'water_outage', 'maintenance', 'general'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface TemplateField {
  key: 'date' | 'from' | 'to' | 'area' | 'reason';
  label: string;
  type: 'date' | 'time' | 'text';
  placeholder?: string;
  required: boolean;
}

export interface AnnouncementTemplate {
  id: TemplateId;
  label: string;
  /** lucide-react icon name used by the picker. */
  icon: 'Zap' | 'Droplets' | 'Wrench' | 'Megaphone';
  fields: TemplateField[];
  /** Pinned by default: outages should stay on top. */
  pinned: boolean;
}

const WHEN: TemplateField[] = [
  { key: 'date', label: 'วันที่', type: 'date', required: true },
  { key: 'from', label: 'ตั้งแต่เวลา', type: 'time', required: true },
  { key: 'to', label: 'ถึงเวลา', type: 'time', required: true },
];

export const ANNOUNCEMENT_TEMPLATES: AnnouncementTemplate[] = [
  {
    id: 'power_outage', label: 'ประกาศไฟดับ', icon: 'Zap', pinned: true,
    fields: [...WHEN, { key: 'area', label: 'พื้นที่ที่ได้รับผลกระทบ', type: 'text', placeholder: 'เช่น ทั้งอาคาร / ชั้น 2', required: false }, { key: 'reason', label: 'สาเหตุ', type: 'text', placeholder: 'เช่น การไฟฟ้าตัดไฟเพื่อซ่อมบำรุง', required: false }],
  },
  {
    id: 'water_outage', label: 'ประกาศตัดน้ำ', icon: 'Droplets', pinned: true,
    fields: [...WHEN, { key: 'area', label: 'พื้นที่ที่ได้รับผลกระทบ', type: 'text', placeholder: 'เช่น ทั้งอาคาร / ชั้น 2', required: false }, { key: 'reason', label: 'สาเหตุ', type: 'text', placeholder: 'เช่น การประปาซ่อมท่อ', required: false }],
  },
  {
    id: 'maintenance', label: 'ประกาศซ่อมบำรุง', icon: 'Wrench', pinned: false,
    fields: [{ key: 'reason', label: 'งานที่จะซ่อม/บำรุง', type: 'text', placeholder: 'เช่น ซ่อมลิฟต์ / ทำความสะอาดถังน้ำ', required: true }, ...WHEN, { key: 'area', label: 'พื้นที่', type: 'text', placeholder: 'เช่น ลิฟต์ตัวที่ 1', required: false }],
  },
  { id: 'general', label: 'ประกาศทั่วไป', icon: 'Megaphone', pinned: false, fields: [] },
];

export const templateById = (id: TemplateId) => ANNOUNCEMENT_TEMPLATES.find(t => t.id === id)!;

const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "2026-10-12" → "12 ต.ค. 2569". Anything that is not a valid date comes back unchanged. */
export function thaiDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return iso;
  return `${day} ${MONTHS_TH[month - 1]} ${Number(m[1]) + 543}`;
}

export type TemplateValues = Partial<Record<TemplateField['key'], string>>;

/** Fields the template needs that are still empty (by label). */
export function missingFields(id: TemplateId, values: TemplateValues): string[] {
  return templateById(id).fields.filter(f => f.required && !(values[f.key] ?? '').trim()).map(f => f.label);
}

/**
 * Title and body for a template. Optional fields that were left empty are simply left out, so the text never
 * contains a blank like "พื้นที่: " or a placeholder the owner forgot to replace.
 */
export function buildAnnouncement(id: TemplateId, values: TemplateValues): { title: string; body: string } {
  const v = (k: TemplateField['key']) => (values[k] ?? '').trim();
  const when = [
    v('date') ? `วันที่ ${thaiDate(v('date'))}` : '',
    v('from') && v('to') ? `เวลา ${v('from')} – ${v('to')} น.` : v('from') ? `ตั้งแต่เวลา ${v('from')} น.` : '',
  ].filter(Boolean).join(' ');
  const area = v('area') ? `พื้นที่ที่ได้รับผลกระทบ: ${v('area')}\n` : '';
  const reason = v('reason') ? `สาเหตุ: ${v('reason')}\n` : '';

  switch (id) {
    case 'power_outage':
      return {
        title: `แจ้งไฟฟ้าดับ ${v('date') ? thaiDate(v('date')) : ''}`.trim(),
        body: `ขอแจ้งให้ผู้พักอาศัยทราบว่าจะมีการดับไฟฟ้า ${when}\n${area}${reason}\nกรุณาเตรียมความพร้อม เช่น ชาร์จอุปกรณ์ ปิดเครื่องใช้ไฟฟ้าที่ไม่จำเป็น และสำรองงานที่ใช้ไฟฟ้า ขออภัยในความไม่สะดวก`.trim(),
      };
    case 'water_outage':
      return {
        title: `แจ้งน้ำประปาไม่ไหล ${v('date') ? thaiDate(v('date')) : ''}`.trim(),
        body: `ขอแจ้งให้ผู้พักอาศัยทราบว่าจะมีการตัดน้ำ ${when}\n${area}${reason}\nกรุณาสำรองน้ำไว้ใช้ล่วงหน้า ขออภัยในความไม่สะดวก`.trim(),
      };
    case 'maintenance':
      return {
        title: `แจ้งซ่อมบำรุง: ${v('reason')}`.trim().slice(0, 100),
        body: `ขอแจ้งให้ผู้พักอาศัยทราบว่าจะมีการซ่อมบำรุง: ${v('reason')}\n${when ? `กำหนดการ: ${when}\n` : ''}${area}\nอาจมีเสียงดังหรือใช้งานพื้นที่ดังกล่าวไม่ได้ชั่วคราว ขออภัยในความไม่สะดวก`.trim(),
      };
    case 'general':
      return { title: '', body: '' };
  }
}
