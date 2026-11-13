import { describe, expect, it } from 'vitest';
import { importTemplateSheets, TEMPLATE_HEADERS } from './importTemplate';
import { IMPORT_FIELDS, guessMapping, toImportRecords } from './importMapping';

describe('import template', () => {
    it('has a column for every import field, each recognised without the AI', () => {
        const mapping = guessMapping([...TEMPLATE_HEADERS]);
        expect(mapping.every(f => f !== null)).toBe(true);
        expect(new Set(mapping)).toEqual(new Set(IMPORT_FIELDS));
    });

    it('leaves the sheet the import reads empty, and its examples import cleanly', () => {
        const [fill, examples] = importTemplateSheets();
        expect(fill.rows).toHaveLength(1);
        const rows = examples.rows.map(r => r.map(c => (c === null ? '' : String(c))));
        const { records, problems } = toImportRecords(rows, guessMapping(rows[0]));
        expect(problems).toEqual([]);
        expect(records.map(r => r.unit_category)).toEqual(['room', 'room', 'condo', 'house', 'land']);
        expect(records[0].tenant).toMatchObject({ full_name: 'สมชาย ใจดี', phone: '0812345678', move_in_date: '2026-06-01' });
        expect(records[4].current_meter_elec).toBeUndefined();
    });

    it("fills in the branch's units so the file can be edited and imported back", () => {
        const [fill] = importTemplateSheets([
            { room_number: '101', category: 'ห้องพัก', rent_amount: 3500, current_meter_elec: 120, current_meter_water: 30 },
            { room_number: 'แปลง 1', category: 'ที่ดิน', rent_amount: 8000, current_meter_elec: null, current_meter_water: null },
        ]);
        const rows = fill.rows.map(r => r.map(c => (c === null ? '' : String(c))));
        const { records, problems } = toImportRecords(rows, guessMapping(rows[0]));
        expect(problems).toEqual([]);
        expect(records.map(r => [r.room_number, r.unit_category, r.rent_amount])).toEqual([['101', 'room', 3500], ['แปลง 1', 'land', 8000]]);
        expect(records[1].current_meter_elec).toBeUndefined();
    });
});
