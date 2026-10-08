// Auto-reply Q&A for tenants who message the property over LINE, plus announcements.
// Answers are written by the owner and picked by keyword — deterministic on purpose: a bot that
// invents answers about rent, deposits or house rules is worse than one that stays quiet and lets a person reply.

export const MAX_FAQS = 100;
export const FAQ_LIMITS = { title: 80, keyword: 40, keywords: 15, answer: 1000 } as const;
/** Longer messages are real conversations, not questions to look up; they always go to a person. */
export const MAX_QUESTION_CHARS = 200;
export const MIN_KEYWORD_CHARS = 2;

export interface FaqEntry {
  id: string;
  /** Owner-facing label, e.g. "เวลาปิดประตูหอ". */
  title: string;
  /** Any of these appearing in the tenant's message selects this answer. */
  keywords: string[];
  answer: string;
  enabled: boolean;
  /** How many times it was sent to a tenant. */
  hit_count: number;
  created_at: string;
  updated_at: string;
}

/** Lower-case and drop spaces/punctuation so "Wi-Fi", "wifi" and "ไวไฟ ?" compare alike (Thai has no spaces between words). */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * Pick the enabled entry whose keywords best fit the message. More specific (longer) keyword hits win;
 * a tie goes to the earliest-created entry so the choice is stable. Null = nothing fits, stay quiet.
 */
export function matchFaq(text: string, faqs: FaqEntry[]): FaqEntry | null {
  if (text.length > MAX_QUESTION_CHARS) return null;
  const msg = normalizeForMatch(text);
  if (!msg) return null;
  let best: { faq: FaqEntry; score: number } | null = null;
  for (const faq of faqs) {
    if (!faq.enabled) continue;
    let score = 0;
    for (const k of faq.keywords) {
      const nk = normalizeForMatch(k);
      if (nk.length >= MIN_KEYWORD_CHARS && msg.includes(nk)) score += nk.length;
    }
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && faq.created_at < best.faq.created_at)) best = { faq, score };
  }
  return best?.faq ?? null;
}

export interface FaqInput { title: string; keywords: string[]; answer: string; enabled: boolean }

/** Validate untrusted FAQ input; returns the cleaned value or null. */
export function cleanFaqInput(raw: { title?: unknown; keywords?: unknown; answer?: unknown; enabled?: unknown }): FaqInput | null {
  if (typeof raw.title !== 'string' || typeof raw.answer !== 'string' || !Array.isArray(raw.keywords)) return null;
  const title = raw.title.trim();
  const answer = raw.answer.trim();
  if (!title || title.length > FAQ_LIMITS.title || !answer || answer.length > FAQ_LIMITS.answer) return null;
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const k of raw.keywords) {
    if (typeof k !== 'string') return null;
    const t = k.trim();
    if (!t) continue;
    const n = normalizeForMatch(t);
    if (t.length > FAQ_LIMITS.keyword || n.length < MIN_KEYWORD_CHARS) return null;
    if (!seen.has(n)) { seen.add(n); keywords.push(t); }
  }
  if (keywords.length === 0 || keywords.length > FAQ_LIMITS.keywords) return null;
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') return null;
  return { title, keywords, answer, enabled: raw.enabled ?? true };
}

// ── Announcements ────────────────────────────────────────────────────────────

export const ANNOUNCEMENT_LIMITS = { title: 100, body: 1500 } as const;

export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  status: 'published' | 'archived';
  /** ISO; hidden from tenants after this moment. */
  expires_at: string | null;
  /** LINE delivery at publish time. */
  line_sent: number;
  line_failed: number;
  created_at: string;
  created_by: string;
  updated_at: string;
}

/** What the tenant portal receives: no author, no delivery counts. */
export interface TenantAnnouncementView {
  id: string; title: string; body: string; pinned: boolean; created_at: string;
}

export interface AnnouncementInput { title: string; body: string; pinned: boolean; expires_at: string | null }

export function cleanAnnouncementInput(raw: { title?: unknown; body?: unknown; pinned?: unknown; expires_at?: unknown }): AnnouncementInput | null {
  if (typeof raw.title !== 'string' || typeof raw.body !== 'string') return null;
  const title = raw.title.trim();
  const body = raw.body.trim();
  if (!title || title.length > ANNOUNCEMENT_LIMITS.title || !body || body.length > ANNOUNCEMENT_LIMITS.body) return null;
  if (raw.pinned !== undefined && typeof raw.pinned !== 'boolean') return null;
  let expires: string | null = null;
  if (raw.expires_at !== undefined && raw.expires_at !== null && raw.expires_at !== '') {
    if (typeof raw.expires_at !== 'string') return null;
    const d = new Date(raw.expires_at);
    if (Number.isNaN(d.getTime())) return null;
    expires = d.toISOString();
  }
  return { title, body, pinned: raw.pinned ?? false, expires_at: expires };
}

/** Published, not expired — newest first, pinned on top. */
export function visibleAnnouncements(list: Announcement[], now: Date = new Date()): Announcement[] {
  return list
    .filter(a => a.status === 'published' && (!a.expires_at || Date.parse(a.expires_at) > now.getTime()))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at));
}

export function announcementLineText(a: { title: string; body: string }, dormName: string): string {
  return `📢 ประกาศจาก${dormName}\n\n${a.title}\n\n${a.body}`.slice(0, 4900);
}
