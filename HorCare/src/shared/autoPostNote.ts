/** What the server says about posting money to the ledger right after it was taken (api/_ledger-auto.ts AutoPostResult). */
export interface AutoPostOutcome { posted: number; reason?: 'no_ledger' | 'off' | 'ledger_incomplete' | 'blocked' | 'error'; problem?: string }

/**
 * Words for the person who just took or confirmed money, when it did not (all) reach the ledger — null when there is
 * nothing to say. A property with no ledger, or with automatic posting switched off, chose that: no warning.
 */
export function autoPostNote(p: AutoPostOutcome | null | undefined): string | null {
  if (!p?.reason || p.reason === 'no_ledger' || p.reason === 'off') return null;
  if (p.reason === 'ledger_incomplete') return `ยังไม่ลงสมุดบัญชี: ตั้งค่าสมุดบัญชีไม่ครบ${p.problem ? ` (${p.problem})` : ''}`;
  if (p.reason === 'blocked') return `บางรายการยังไม่ลงสมุดบัญชี${p.problem ? `: ${p.problem}` : ''}`;
  return 'ยังไม่ลงสมุดบัญชี กรุณาตรวจที่หน้าสมุดบัญชี';
}
