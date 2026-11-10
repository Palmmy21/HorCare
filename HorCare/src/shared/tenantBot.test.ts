import { describe, expect, it } from 'vitest';
import { botText, helpText, notRegisteredText, parseTenantCommand, welcomeText } from './tenantBot';

describe('parseTenantCommand', () => {
    it('keeps every command the bot already understood', () => {
        expect(parseTenantCommand('บิล')).toBe('bill');
        expect(parseTenantCommand('ดูบิล')).toBe('bill');
        expect(parseTenantCommand('Bill')).toBe('bill');
        expect(parseTenantCommand('ส่งสลิป')).toBe('slip');
        expect(parseTenantCommand('พอร์ทัล')).toBe('portal');
        expect(parseTenantCommand('PORTAL')).toBe('portal');
        expect(parseTenantCommand('ประกาศ')).toBe('announcements');
        expect(parseTenantCommand('ติดต่อแอดมิน')).toBe('contact');
        expect(parseTenantCommand('ลงทะเบียน')).toBe('register');
        expect(parseTenantCommand('Register')).toBe('register');
        expect(parseTenantCommand('ยกเลิก')).toBe('cancel');
    });

    it('reads through spacing, punctuation and polite particles', () => {
        expect(parseTenantCommand('ขอดูบิลหน่อยครับ')).toBe('bill');
        expect(parseTenantCommand(' บิล ค่ะ ')).toBe('bill');
        expect(parseTenantCommand('ขอบิลด้วยนะคะ')).toBe('bill');
        expect(parseTenantCommand('บิลเดือนนี้!')).toBe('bill');
        expect(parseTenantCommand('แจ้งซ่อมครับ')).toBe('repair');
        expect(parseTenantCommand('เมนู')).toBe('help');
        expect(parseTenantCommand('?')).toBe('help');
        expect(parseTenantCommand('ยกเลิกค่ะ')).toBe('cancel');
    });

    it('leaves real conversation for a person', () => {
        expect(parseTenantCommand('บิลเดือนที่แล้วผิดค่ะ ช่วยดูหน่อย')).toBeNull();
        expect(parseTenantCommand('ค่าเช่า')).toBeNull();
        expect(parseTenantCommand('น้ำไม่ไหลค่ะ ซ่อมให้หน่อย')).toBeNull();
        expect(parseTenantCommand('101')).toBeNull();
        expect(parseTenantCommand('HC-K7MN2P')).toBeNull();
        expect(parseTenantCommand('ครับ')).toBeNull();
        expect(parseTenantCommand('')).toBeNull();
    });
});

describe('wording', () => {
    it('speaks of a market on the vendor OA and a dorm elsewhere', () => {
        expect(notRegisteredText(true)).toContain('เจ้าของตลาด');
        expect(notRegisteredText(true)).not.toContain('หอ');
        expect(notRegisteredText(false)).toContain('เจ้าของหอ');
        expect(helpText(true, true)).toContain('ประกาศล่าสุดจากตลาด');
        expect(helpText(false, false)).toBe(notRegisteredText(false));
    });

    it('welcomes a registered follower by room, anyone else with how to register', () => {
        expect(welcomeText({ room_number: '101', dorm_name: 'Dorm A' }, false)).toContain('ห้อง 101 (Dorm A)');
        expect(welcomeText({ room_number: 'A5' }, true)).toContain('แผง A5');
        expect(welcomeText(null, false)).toBe(notRegisteredText(false));
    });

    it('adds quick replies only when there are some (LINE rejects an empty list)', () => {
        expect(botText('hi')).toEqual({ type: 'text', text: 'hi' });
        expect(botText('hi', ['บิล']).quickReply!.items[0].action).toEqual({ type: 'message', label: 'บิล', text: 'บิล' });
    });
});
