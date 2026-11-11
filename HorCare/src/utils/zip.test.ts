import { describe, expect, it } from 'vitest';
import { crc32, safeFileNames, zipStore } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('crc32', () => {
    it('matches the standard check value', () => {
        expect(crc32(bytes('123456789'))).toBe(0xCBF43926);
        expect(crc32(new Uint8Array(0))).toBe(0);
    });
});

describe('safeFileNames', () => {
    it('replaces characters a file system refuses and never repeats a name', () => {
        expect(safeFileNames(['ห้อง A/1.jpg', 'ห้อง 101.jpg', 'ห้อง 101.jpg', '  ', 'x'])).toEqual(['ห้อง A-1.jpg', 'ห้อง 101.jpg', 'ห้อง 101 (2).jpg', 'file', 'x']);
    });
});

describe('zipStore', () => {
    /** Read the archive back the way an unzip tool does: from the end record, through the central directory. */
    function readZip(zip: Uint8Array) {
        const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
        const end = zip.length - 22;
        expect(v.getUint32(end, true)).toBe(0x06054b50);
        const count = v.getUint16(end + 10, true);
        let p = v.getUint32(end + 16, true);
        const dec = new TextDecoder();
        const out: { name: string; data: Uint8Array; crc: number }[] = [];
        for (let i = 0; i < count; i++) {
            expect(v.getUint32(p, true)).toBe(0x02014b50);
            const crc = v.getUint32(p + 16, true);
            const size = v.getUint32(p + 24, true);
            const nameLen = v.getUint16(p + 28, true);
            const local = v.getUint32(p + 42, true);
            const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
            expect(v.getUint32(local, true)).toBe(0x04034b50);
            const dataStart = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
            out.push({ name, data: zip.subarray(dataStart, dataStart + size), crc });
            p += 46 + nameLen;
        }
        return out;
    }

    it('holds every file intact, in order, with Thai names', () => {
        const files = [
            { name: 'ห้อง 101.jpg', data: bytes('first room') },
            { name: 'ห้อง 102.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x10]) },
            { name: 'empty.txt', data: new Uint8Array(0) },
        ];
        const back = readZip(zipStore(files));
        expect(back.map(f => f.name)).toEqual(['ห้อง 101.jpg', 'ห้อง 102.jpg', 'empty.txt']);
        back.forEach((f, i) => {
            expect([...f.data]).toEqual([...files[i].data]);
            expect(f.crc).toBe(crc32(files[i].data));
        });
    });

    it('makes a valid empty archive', () => {
        const zip = zipStore([]);
        expect(zip.length).toBe(22);
        expect(readZip(zip)).toEqual([]);
    });
});
