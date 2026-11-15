import { describe, expect, it } from 'vitest';
import { autoDueDate, billIssuedOn, dueNoteMode, dueNoteTemplate, fillDueNote, resolveDueDate, thaiDayOf } from './billDue';

describe('autoDueDate', () => {
  it('is this month when the bill goes out on or before the due day', () => {
    expect(autoDueDate('2026-11-01', 5)).toBe('2026-11-05');
    expect(autoDueDate('2026-11-05', 5)).toBe('2026-11-05');
  });
  it('is next month when the bill goes out after the due day', () => {
    expect(autoDueDate('2026-11-06', 5)).toBe('2026-12-05');
    expect(autoDueDate('2026-12-28', 5)).toBe('2027-01-05');
  });
  it('clamps to short months', () => {
    expect(autoDueDate('2026-02-10', 31)).toBe('2026-02-28');
    expect(autoDueDate('2026-01-31', 30)).toBe('2026-02-28');
  });
});

describe('billIssuedOn', () => {
  it('is the Thai day the bill was created', () => {
    expect(thaiDayOf('2026-11-25T18:30:00.000Z')).toBe('2026-11-26');
    expect(billIssuedOn({ month: '2026-11', created_at: '2026-11-25T03:00:00.000Z' })).toBe('2026-11-25');
  });
  it('is never before the bill month starts, and falls back to it without a creation time', () => {
    expect(billIssuedOn({ month: '2026-12', created_at: '2026-11-20T03:00:00.000Z' })).toBe('2026-12-01');
    expect(billIssuedOn({ month: '2026-11' })).toBe('2026-11-01');
  });
});

describe('resolveDueDate', () => {
  const late = { month: '2026-11', created_at: '2026-11-25T03:00:00.000Z' };
  const early = { month: '2026-11', created_at: '2026-11-02T03:00:00.000Z' };
  it('counts from the issue date', () => {
    expect(resolveDueDate(late, { due_day: 5 })).toBe('2026-12-05');
    expect(resolveDueDate(early, { due_day: 5 })).toBe('2026-11-05');
    expect(resolveDueDate({ month: '2026-11', created_at: '2026-12-02T03:00:00.000Z' }, { due_day: 5 })).toBe('2026-12-05');
  });
  it('uses the fixed date while the bill was issued by then', () => {
    const fixed = { due_day: 5, due_note_mode: 'fixed' as const, due_fixed_date: '2026-12-10' };
    expect(resolveDueDate(late, fixed)).toBe('2026-12-10');
    expect(resolveDueDate({ month: '2026-12', created_at: '2026-12-26T03:00:00.000Z' }, fixed)).toBe('2027-01-05');
  });
  it('lets the room, then the bill, override', () => {
    expect(resolveDueDate(late, { due_day: 5 }, { due_day: 10 })).toBe('2026-12-10');
    expect(resolveDueDate({ ...late, due_date: '2026-12-15' }, { due_day: 5 }, { due_day: 10 })).toBe('2026-12-15');
  });
});

describe('the note', () => {
  it('replaces the stock notes with the automatic one and keeps the owner’s own', () => {
    expect(dueNoteMode({ footer_text: 'กรุณาชำระภายในวันที่ 5 ของทุกเดือน' })).toBe('auto');
    expect(dueNoteMode({ footer_text: 'กรุณาชำระภายในวันที่กำหนด ขอบคุณครับ' })).toBe('auto');
    expect(dueNoteMode({ footer_text: '' })).toBe('auto');
    expect(dueNoteMode({ footer_text: 'โอนแล้วส่งสลิปทาง LINE' })).toBe('manual');
    expect(dueNoteMode({ footer_text: 'โอนแล้วส่งสลิป', due_note_mode: 'auto' })).toBe('auto');
  });
  it('takes the room’s note first and fills in the date', () => {
    expect(dueNoteTemplate({ footer_text: 'ของสาขา', due_note_mode: 'manual' }, { bill_footer: ' ของห้อง ' })).toBe('ของห้อง');
    expect(dueNoteTemplate({ footer_text: 'ของสาขา', due_note_mode: 'auto' })).toBe('');
    expect(fillDueNote('ชำระภายใน {วันครบกำหนด} / by {due_date}', '5 ธ.ค.')).toBe('ชำระภายใน 5 ธ.ค. / by 5 ธ.ค.');
  });
});
