import { describe, expect, it } from 'vitest';
import {
  cleanAnnouncementInput, cleanFaqInput, matchFaq, visibleAnnouncements, type Announcement, type FaqEntry,
} from './chatbot';

const faq = (id: string, keywords: string[], over: Partial<FaqEntry> = {}): FaqEntry => ({
  id, title: id, keywords, answer: `answer-${id}`, enabled: true, hit_count: 0,
  created_at: `2026-01-0${id.length}T00:00:00Z`, updated_at: '', ...over,
});

describe('matchFaq', () => {
  const wifi = faq('wifi', ['wifi', 'ไวไฟ', 'อินเทอร์เน็ต']);
  const door = faq('door', ['ปิดประตู', 'กุญแจ']);

  it('finds an answer by keyword, ignoring case, spaces and punctuation', () => {
    expect(matchFaq('รหัส Wi-Fi คืออะไรคะ?', [wifi, door])?.id).toBe('wifi');
    expect(matchFaq('หอปิด ประตู กี่โมง', [wifi, door])?.id).toBe('door');
  });

  it('stays quiet when nothing fits, or the message is empty or long', () => {
    expect(matchFaq('สวัสดีค่ะ', [wifi, door])).toBeNull();
    expect(matchFaq('   ', [wifi])).toBeNull();
    expect(matchFaq('wifi ' + 'ก'.repeat(300), [wifi])).toBeNull();
  });

  it('ignores disabled entries', () => {
    expect(matchFaq('wifi', [faq('wifi', ['wifi'], { enabled: false })])).toBeNull();
  });

  it('prefers the more specific match and breaks ties by oldest', () => {
    const generic = faq('a', ['เงิน']);
    const specific = faq('bb', ['ค่าเช่า', 'เงินประกัน']);
    expect(matchFaq('ขอถามเรื่องเงินประกัน', [generic, specific])?.id).toBe('bb');
    const first = faq('x', ['ซักผ้า'], { created_at: '2026-01-01T00:00:00Z' });
    const second = faq('y', ['ซักผ้า'], { created_at: '2026-02-01T00:00:00Z' });
    expect(matchFaq('ซักผ้าได้ที่ไหน', [second, first])?.id).toBe('x');
  });

  it('a one-letter keyword never triggers (too broad)', () => {
    expect(matchFaq('มีปัญหา', [faq('z', ['ม'])])).toBeNull();
  });
});

describe('cleanFaqInput', () => {
  const ok = { title: ' เวลาปิดหอ ', keywords: ['ปิดหอ', ' ปิดหอ ', 'ประตู'], answer: ' 23:00 ' };
  it('trims, dedupes keywords and defaults to enabled', () => {
    expect(cleanFaqInput(ok)).toEqual({ title: 'เวลาปิดหอ', keywords: ['ปิดหอ', 'ประตู'], answer: '23:00', enabled: true });
  });
  it('rejects bad input', () => {
    for (const bad of [
      { ...ok, title: '' }, { ...ok, title: 'x'.repeat(81) }, { ...ok, answer: '' }, { ...ok, answer: 'x'.repeat(1001) },
      { ...ok, keywords: [] }, { ...ok, keywords: [' '] }, { ...ok, keywords: ['ก'] }, { ...ok, keywords: [5] },
      { ...ok, keywords: 'wifi' }, { ...ok, keywords: Array.from({ length: 16 }, (_, i) => `คำที่${i}`) },
      { ...ok, keywords: ['x'.repeat(41)] }, { ...ok, enabled: 'yes' }, {},
    ]) expect(cleanFaqInput(bad as never)).toBeNull();
  });
});

describe('announcements', () => {
  const ann = (id: string, over: Partial<Announcement> = {}): Announcement => ({
    id, title: id, body: 'b', pinned: false, status: 'published', expires_at: null, line_sent: 0, line_failed: 0,
    created_at: `2026-10-0${id}T00:00:00Z`, created_by: 'o', updated_at: '', ...over,
  });
  it('shows published, unexpired items, pinned first then newest', () => {
    const now = new Date('2026-10-10T00:00:00Z');
    const list = [ann('1'), ann('2'), ann('3', { pinned: true }), ann('4', { status: 'archived' }), ann('5', { expires_at: '2026-10-09T00:00:00Z' }), ann('6', { expires_at: '2026-10-20T00:00:00Z' })];
    expect(visibleAnnouncements(list, now).map(a => a.id)).toEqual(['3', '6', '2', '1']);
  });
  it('validates input', () => {
    expect(cleanAnnouncementInput({ title: ' ปิดน้ำ ', body: 'พรุ่งนี้ 9-12 น.', expires_at: '2026-10-20T00:00:00Z' }))
      .toEqual({ title: 'ปิดน้ำ', body: 'พรุ่งนี้ 9-12 น.', pinned: false, expires_at: '2026-10-20T00:00:00.000Z' });
    for (const bad of [{ title: '', body: 'x' }, { title: 'x', body: '' }, { title: 'x'.repeat(101), body: 'x' }, { title: 'x', body: 'x'.repeat(1501) }, { title: 'x', body: 'x', expires_at: 'nope' }, { title: 'x', body: 'x', pinned: 'y' }])
      expect(cleanAnnouncementInput(bad as never)).toBeNull();
  });
});