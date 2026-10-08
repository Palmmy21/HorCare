// Thai banks: Bank of Thailand code (also the code inside slip QR payloads), logo key and brand colour.
// Shared by the API (slip verification) and the UI (bank pickers, logos).

export interface Bank {
  /** 3-digit BOT code, as used in transfer slip QR codes. */
  code: string;
  /** Short code; also the logo file name. */
  short: string;
  name_th: string;
  color: string;
}

export const BANKS: Bank[] = [
  { code: '004', short: 'KBANK', name_th: 'ธนาคารกสิกรไทย', color: '#138F2D' },
  { code: '014', short: 'SCB', name_th: 'ธนาคารไทยพาณิชย์', color: '#4E2E7F' },
  { code: '002', short: 'BBL', name_th: 'ธนาคารกรุงเทพ', color: '#1E4598' },
  { code: '006', short: 'KTB', name_th: 'ธนาคารกรุงไทย', color: '#1BA5E0' },
  { code: '011', short: 'TTB', name_th: 'ธนาคารทหารไทยธนชาต', color: '#EE6D1F' },
  { code: '025', short: 'BAY', name_th: 'ธนาคารกรุงศรีอยุธยา', color: '#FEC43B' },
  { code: '030', short: 'GSB', name_th: 'ธนาคารออมสิน', color: '#EB198D' },
  { code: '033', short: 'GHB', name_th: 'ธนาคารอาคารสงเคราะห์', color: '#F57D23' },
  { code: '034', short: 'BAAC', name_th: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร', color: '#4B9B1D' },
  { code: '069', short: 'KKP', name_th: 'ธนาคารเกียรตินาคินภัทร', color: '#199CC5' },
  { code: '067', short: 'TISCO', name_th: 'ธนาคารทิสโก้', color: '#12549F' },
  { code: '024', short: 'UOB', name_th: 'ธนาคารยูโอบี', color: '#0B3979' },
  { code: '022', short: 'CIMB', name_th: 'ธนาคารซีไอเอ็มบี ไทย', color: '#7E2F36' },
  { code: '066', short: 'IBANK', name_th: 'ธนาคารอิสลามแห่งประเทศไทย', color: '#184615' },
  { code: '071', short: 'TCRB', name_th: 'ธนาคารไทยเครดิต', color: '#0F4C81' },
  { code: '073', short: 'LHB', name_th: 'ธนาคารแลนด์ แอนด์ เฮ้าส์', color: '#6D6E71' },
  { code: '070', short: 'ICBC', name_th: 'ธนาคารไอซีบีซี (ไทย)', color: '#C50F1F' },
  { code: '031', short: 'HSBC', name_th: 'ธนาคารเอชเอสบีซี', color: '#DB0011' },
  { code: '017', short: 'CITI', name_th: 'ธนาคารซิตี้แบงก์', color: '#1F70C1' },
];

const BY_CODE = new Map(BANKS.map(b => [b.code, b]));
const BY_SHORT = new Map(BANKS.map(b => [b.short, b]));

export const bankByCode = (code: string | null | undefined): Bank | undefined => (code ? BY_CODE.get(code) : undefined);
export const bankByShort = (short: string | null | undefined): Bank | undefined => (short ? BY_SHORT.get(short) : undefined);

/** Logos are loaded from a public CDN; callers must fall back to a coloured badge on error. */
export const bankLogoUrl = (short: string) => `https://cdn.jsdelivr.net/gh/casperstack/thai-banks-logo/icons/${encodeURIComponent(short)}.png`;

export const digitsOnly = (s: string) => s.replace(/\D/g, '');

/** Account numbers are 10–15 digits (savings/current: 10 or 12; some products up to 15). */
export function isValidAccountNumber(raw: string): boolean {
  const d = digitsOnly(raw);
  return /^[\d\s-]+$/.test(raw.trim()) && d.length >= 10 && d.length <= 15;
}

/** "1234567890" → "••••••7890" (last four visible). */
export function maskAccountNumber(raw: string): string {
  const d = digitsOnly(raw);
  if (d.length <= 4) return d;
  return '•'.repeat(d.length - 4) + d.slice(-4);
}

/** Bank accounts a property receives money into: users/{owner}/buildings/{b}/bank_accounts/{id}. */
export interface BankAccount {
  id: string;
  bank_code: string;
  bank_short: string;
  account_name: string;
  /** Digits only. Shown masked in the UI except to people who manage accounts. */
  account_number: string;
  nickname: string | null;
  status: 'active' | 'inactive';
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** Short label used on payments, e.g. "KBANK ••••7890". */
export function bankAccountLabel(a: Pick<BankAccount, 'bank_short' | 'account_number'>): string {
  return `${a.bank_short} ${maskAccountNumber(a.account_number).slice(-8)}`;
}

/** Full account number grouped the way Thai banks print it (10 digits → xxx-x-xxxxx-x); other lengths unchanged. */
export function formatAccountNumber(raw: string): string {
    const d = digitsOnly(raw);
    return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 4)}-${d.slice(4, 9)}-${d.slice(9)}` : d;
}
