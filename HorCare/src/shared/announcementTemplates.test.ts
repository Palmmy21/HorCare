import { describe, expect, it } from 'vitest';
import { ANNOUNCEMENT_TEMPLATES, TEMPLATE_IDS, buildAnnouncement, missingFields, templateById, thaiDate } from './announcementTemplates';
import { ANNOUNCEMENT_LIMITS } from './chatbot';

describe('thaiDate', () => {
  it('formats a Buddhist-era date', () => {
    expect(thaiDate('2026-10-12')).toBe('12 ต.ค. 2569');
    expect(thaiDate('2026-01-05')).toBe('5 ม.ค. 2569');
  });
  it('leaves anything that is not a date untouched', () => {
    expect(thaiDate('')).toBe('');
    expect(thaiDate('soon')).toBe('soon');
    expect(thaiDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('templates', () => {
  it('has the four templates in the picker order', () => {
    expect(ANNOUNCEMENT_TEMPLATES.map(t => t.label)).toEqual(['ประกาศไฟดับ', 'ประกาศตัดน้ำ', 'ประกาศซ่อมบำรุง', 'ประกาศทั่วไป']);
    expect(ANNOUNCEMENT_TEMPLATES.map(t => t.id)).toEqual([...TEMPLATE_IDS]);
  });
  it('outages are pinned by default; the rest are not', () => {
    expect(ANNOUNCEMENT_TEMPLATES.filter(t => t.pinned).map(t => t.id)).toEqual(['power_outage', 'water_outage']);
  });
});

describe('buildAnnouncement', () => {
  const when = { date: '2026-10-12', from: '09:00', to: '12:00' };
  it('fills a power-cut notice with the date, time and optional details', () => {
    const a = buildAnnouncement('power_outage', { ...when, area: 'ทั้งอาคาร', reason: 'ซ่อมหม้อแปลง' });
    expect(a.title).toBe('แจ้งไฟฟ้าดับ 12 ต.ค. 2569');
    expect(a.body).toContain('วันที่ 12 ต.ค. 2569 เวลา 09:00 – 12:00 น.');
    expect(a.body).toContain('พื้นที่ที่ได้รับผลกระทบ: ทั้งอาคาร');
    expect(a.body).toContain('สาเหตุ: ซ่อมหม้อแปลง');
  });
  it('leaves out optional lines that were not filled in — no blanks or placeholders', () => {
    const a = buildAnnouncement('water_outage', when);
    expect(a.body).not.toContain('พื้นที่ที่ได้รับผลกระทบ');
    expect(a.body).not.toContain('สาเหตุ');
    expect(a.body).not.toMatch(/\[|\{|undefined/);
    expect(a.body).toContain('กรุณาสำรองน้ำ');
  });
  it('maintenance names the job and fits the announcement limits', () => {
    const a = buildAnnouncement('maintenance', { ...when, reason: 'ซ่อมลิฟต์ตัวที่ 1', area: 'ลิฟต์' });
    expect(a.title).toBe('แจ้งซ่อมบำรุง: ซ่อมลิฟต์ตัวที่ 1');
    expect(a.body).toContain('กำหนดการ: วันที่ 12 ต.ค. 2569');
    for (const t of ['power_outage', 'water_outage', 'maintenance'] as const) {
      const x = buildAnnouncement(t, { ...when, area: 'x'.repeat(100), reason: 'y'.repeat(100) });
      expect(x.title.length).toBeLessThanOrEqual(ANNOUNCEMENT_LIMITS.title);
      expect(x.body.length).toBeLessThanOrEqual(ANNOUNCEMENT_LIMITS.body);
    }
  });
  it('a title is cut at the limit even for very long job names', () => {
    expect(buildAnnouncement('maintenance', { ...when, reason: 'ก'.repeat(300) }).title.length).toBeLessThanOrEqual(ANNOUNCEMENT_LIMITS.title);
  });
  it('the general template starts empty for free writing', () => {
    expect(buildAnnouncement('general', {})).toEqual({ title: '', body: '' });
  });
  it('only a start time still reads naturally', () => {
    expect(buildAnnouncement('power_outage', { date: '2026-10-12', from: '09:00' }).body).toContain('ตั้งแต่เวลา 09:00 น.');
  });
});

describe('missingFields', () => {
  it('lists required fields still empty, by label', () => {
    expect(missingFields('power_outage', {})).toEqual(['วันที่', 'ตั้งแต่เวลา', 'ถึงเวลา']);
    expect(missingFields('power_outage', { date: '2026-10-12', from: '09:00', to: ' ' })).toEqual(['ถึงเวลา']);
    expect(missingFields('maintenance', { date: '2026-10-12', from: '09:00', to: '10:00' })).toEqual(['งานที่จะซ่อม/บำรุง']);
    expect(missingFields('general', {})).toEqual([]);
    expect(templateById('water_outage').fields.some(f => f.key === 'reason' && !f.required)).toBe(true);
  });
});