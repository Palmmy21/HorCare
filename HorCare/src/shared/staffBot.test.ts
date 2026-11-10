import { describe, expect, it } from 'vitest';
import { linkCard, menuFor, parseStaffCommand, quickLabels, staffHelpText, staffMenuName } from './staffBot';

describe('parseStaffCommand', () => {
    it('reads every word a rich-menu button sends', () => {
        expect(parseStaffCommand('งานของฉัน')).toBe('jobs');
        expect(parseStaffCommand('ส่งงาน')).toBe('submit');
        expect(parseStaffCommand('จดมิเตอร์')).toBe('meter');
        expect(parseStaffCommand('ลงทะเบียน')).toBe('register');
        expect(parseStaffCommand('คู่มือ')).toBe('guide');
        expect(parseStaffCommand(' ช่วยเหลือ ')).toBe('help');
        expect(parseStaffCommand('งานทั้งหมด')).toBe('all_jobs');
        expect(parseStaffCommand('ทีมงาน')).toBe('team');
    });

    it('leaves codes, names and registration answers alone', () => {
        for (const t of ['HCR-ABCDEFGH', 'HCS-ABCDEFGH', 'สมชาย ใจดี', '0812345678', 'ช่าง', 'แม่บ้าน', 'ใช่', '#ยอด', '']) {
            expect(parseStaffCommand(t)).toBeNull();
        }
    });
});

describe('menuFor', () => {
    it('gives the registration menu to anyone not linked', () => {
        expect(menuFor({ admin: false, roles: [] })).toBe('register');
    });
    it('gives staff the menu of their job, with meters whenever they keep house somewhere', () => {
        expect(menuFor({ admin: false, roles: ['technician'] })).toBe('technician');
        expect(menuFor({ admin: false, roles: ['housekeeping'] })).toBe('housekeeping');
        expect(menuFor({ admin: false, roles: ['technician', 'housekeeping'] })).toBe('housekeeping');
    });
    it('gives a linked HorCare account the admin menu', () => {
        expect(menuFor({ admin: true, roles: [] })).toBe('admin');
        expect(menuFor({ admin: true, roles: ['technician'] })).toBe('admin');
    });
    it('names menus the way the setup script creates them', () => {
        expect(staffMenuName('housekeeping')).toBe('horcare-staff-housekeeping');
    });
});

describe('wording', () => {
    it('offers only what each menu holds, and never the owner figures', () => {
        expect(quickLabels('technician')).not.toContain('จดมิเตอร์');
        expect(quickLabels('housekeeping')).toContain('จดมิเตอร์');
        for (const menu of ['register', 'technician', 'housekeeping', 'admin'] as const) {
            expect(quickLabels(menu).some(l => l.startsWith('#'))).toBe(false);
        }
    });
    it('mentions meters to housekeepers only', () => {
        expect(staffHelpText({ name: 'มาลี', roles: ['housekeeping'] })).toContain('จดมิเตอร์');
        expect(staffHelpText({ name: 'สมศักดิ์', roles: ['technician'] })).not.toContain('จดมิเตอร์');
    });
    it('builds a card LINE accepts: a short button label and the link as fallback text', () => {
        const card = linkCard('งาน', 'รายละเอียด', 'ป้ายปุ่มที่ยาวเกินยี่สิบตัวอักษรแน่นอน', 'https://app.example/?sp=abc');
        expect(card.contents.footer.contents[0].action.label.length).toBeLessThanOrEqual(20);
        expect(card.altText).toContain('https://app.example/?sp=abc');
    });
});
