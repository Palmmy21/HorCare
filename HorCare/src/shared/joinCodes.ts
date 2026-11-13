// One QR for every LINE registration: /j/<code> opens the LIFF app, which proves who is scanning and links them —
// nobody types or sends a code. Pure; shared by the API (api/_liff-join.ts), the LIFF page and the screens that print QRs.
//
// Each kind of code belongs to one Official Account; the HorCare OAs share one LINE provider (so one LIFF app knows the
// same LINE user id for all of them), and a team's own OA has its own LIFF app on its own provider.

/** Which registration a code starts. */
export type JoinKind =
  | 'room'        // HCR-XXXXXXXXXX  a room's permanent door QR → the property's tenant OA (shared, vendor or team)
  | 'staff_reg'   // HCR-XXXXXXXX    a property's staff sign-up code → HorCare Maintenance, then a manager approves
  | 'staff_link'  // HCS-XXXXXXXX    one staff member's link code from the manager → HorCare Maintenance
  | 'owner_link'  // HCO-XXXXXXXX    an admin's own HorCare account → HorCare Maintenance (admin menu)
  | 'pos_link'    // HCP-XXXXXXXX    a cashier's HorCare account → HorCare Staff (POS Care)
  | 'walkin';     // HCW-XXXXXXXX    a walk-in vendor's request → the vendor OA

const PATTERNS: [JoinKind, RegExp][] = [
  ['room', /^HCR-[A-HJ-NP-Z2-9]{10}$/],
  ['staff_reg', /^HCR-[A-HJ-NP-Z2-9]{8}$/],
  ['staff_link', /^HCS-[A-HJ-NP-Z2-9]{8}$/],
  ['owner_link', /^HCO-[A-HJ-NP-Z2-9]{8}$/],
  ['pos_link', /^HCP-[A-HJ-NP-Z2-9]{8}$/],
  ['walkin', /^HCW-[A-Z0-9]{8}$/],
];

export function normalizeJoinCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

export function joinKind(raw: unknown): JoinKind | null {
  const code = normalizeJoinCode(raw);
  return PATTERNS.find(([, re]) => re.test(code))?.[0] ?? null;
}

/** The address printed in a registration QR. Goes through HorCare so the OA or LIFF app behind it can change. */
export function joinUrl(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/j/${encodeURIComponent(normalizeJoinCode(code))}`;
}

/** What the LIFF page says it is doing, per kind. */
export const JOIN_TITLES_TH: Record<JoinKind, string> = {
  room: 'ลงทะเบียนห้องพัก',
  staff_reg: 'สมัครเป็นทีมงาน',
  staff_link: 'เชื่อม LINE ทีมงาน',
  owner_link: 'เชื่อม LINE ผู้ดูแล',
  pos_link: 'เชื่อม LINE เก็บเงิน (POS Care)',
  walkin: 'เชื่อม LINE คำขอเข้าขาย',
};

/** A LIFF id is "<LINE Login channel id>-<suffix>". */
export const isLiffId = (v: unknown): v is string => typeof v === 'string' && v.length <= 64 && /^\d+-[A-Za-z0-9]+$/.test(v);
export const liffChannelOf = (liffId: string): string => liffId.split('-')[0];
