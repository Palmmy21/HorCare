/** Sign-up is asked one short step at a time; each step is checked before the next one opens. */

export const SIGNUP_STEPS = [
  { id: 'account', title: 'สร้างบัญชี', hint: 'อีเมลและรหัสผ่านสำหรับเข้าสู่ระบบ' },
  { id: 'about', title: 'เกี่ยวกับคุณ', hint: 'ไว้ติดต่อและแสดงบนบิล' },
  { id: 'place', title: 'สถานที่ของคุณ', hint: 'ตั้งชื่อและเลือกประเภท' },
  { id: 'rates', title: 'ค่าเช่าและค่าน้ำไฟ', hint: 'ใส่ค่าที่ใช้บ่อย แก้ภายหลังได้เสมอ' },
] as const;

export type SignupStepId = (typeof SIGNUP_STEPS)[number]['id'];

export interface SignupData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  dormName: string;
  elecRate: number;
  waterRate: number;
  roomRent: number;
  dueDay: number;
}

export const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What still blocks this step (null = ready to go on). */
export function signupStepIssue(step: SignupStepId, d: SignupData): string | null {
  switch (step) {
    case 'account':
      if (!EMAIL_RE.test(d.email.trim())) return 'กรอกอีเมลให้ถูกต้อง';
      if (d.password.length < MIN_PASSWORD) return `รหัสผ่านต้องมีอย่างน้อย ${MIN_PASSWORD} ตัวอักษร`;
      return null;
    case 'about': {
      if (!d.firstName.trim() || !d.lastName.trim()) return 'กรอกชื่อและนามสกุล';
      const digits = d.phone.replace(/\D/g, '');
      if (digits.length < 9 || digits.length > 10) return 'กรอกเบอร์โทรศัพท์ 9–10 หลัก';
      return null;
    }
    case 'place':
      return d.dormName.trim() ? null : 'ตั้งชื่อสถานที่ของคุณ';
    case 'rates':
      if ([d.elecRate, d.waterRate, d.roomRent].some(n => !Number.isFinite(n) || n < 0)) return 'ค่าเช่าและค่าน้ำไฟต้องไม่ติดลบ';
      if (!Number.isInteger(d.dueDay) || d.dueDay < 1 || d.dueDay > 31) return 'วันครบกำหนดชำระต้องอยู่ระหว่าง 1–31';
      return null;
  }
}

/** The first step that still has a problem, or null when everything can be sent. */
export function firstIncompleteStep(d: SignupData): SignupStepId | null {
  return SIGNUP_STEPS.find(s => signupStepIssue(s.id, d) !== null)?.id ?? null;
}
