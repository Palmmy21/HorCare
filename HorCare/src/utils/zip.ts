// A minimal ZIP writer: files stored as they are (no compression), which is all JPEGs need — they are already
// compressed. Enough to hand someone one download holding a QR card per room, with Thai file names (UTF-8 flag).

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(data: Uint8Array): number {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array }

/** Characters no file system accepts in a name become "-"; a name used twice gets "(2)", "(3)", … before its extension. */
export function safeFileNames(names: string[]): string[] {
    const seen = new Map<string, number>();
    return names.map(raw => {
        const clean = [...raw].map(ch => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '-' : ch)).join('').trim() || 'file';
        const n = (seen.get(clean) ?? 0) + 1;
        seen.set(clean, n);
        if (n === 1) return clean;
        const dot = clean.lastIndexOf('.');
        return dot > 0 ? `${clean.slice(0, dot)} (${n})${clean.slice(dot)}` : `${clean} (${n})`;
    });
}

/** Build a ZIP archive holding `files`, in order. */
export function zipStore(files: ZipEntry[]): Uint8Array {
    const enc = new TextEncoder();
    const names = safeFileNames(files.map(f => f.name)).map(n => enc.encode(n));
    const localSize = files.reduce((n, f, i) => n + 30 + names[i].length + f.data.length, 0);
    const centralSize = files.reduce((n, _f, i) => n + 46 + names[i].length, 0);
    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    const offsets: number[] = [];
    const crcs: number[] = [];
    // 1980-01-01 00:00: the format's zero date; the files' own times do not matter here
    const DOS_TIME = 0, DOS_DATE = 0x21;
    let p = 0;

    files.forEach((f, i) => {
        offsets.push(p);
        crcs.push(crc32(f.data));
        view.setUint32(p, 0x04034b50, true);          // local file header
        view.setUint16(p + 4, 20, true);              // version needed
        view.setUint16(p + 6, 0x0800, true);          // UTF-8 names
        view.setUint16(p + 8, 0, true);               // stored
        view.setUint16(p + 10, DOS_TIME, true);
        view.setUint16(p + 12, DOS_DATE, true);
        view.setUint32(p + 14, crcs[i], true);
        view.setUint32(p + 18, f.data.length, true);
        view.setUint32(p + 22, f.data.length, true);
        view.setUint16(p + 26, names[i].length, true);
        view.setUint16(p + 28, 0, true);
        out.set(names[i], p + 30);
        out.set(f.data, p + 30 + names[i].length);
        p += 30 + names[i].length + f.data.length;
    });

    const centralStart = p;
    files.forEach((f, i) => {
        view.setUint32(p, 0x02014b50, true);          // central directory header
        view.setUint16(p + 4, 20, true);
        view.setUint16(p + 6, 20, true);
        view.setUint16(p + 8, 0x0800, true);
        view.setUint16(p + 10, 0, true);
        view.setUint16(p + 12, DOS_TIME, true);
        view.setUint16(p + 14, DOS_DATE, true);
        view.setUint32(p + 16, crcs[i], true);
        view.setUint32(p + 20, f.data.length, true);
        view.setUint32(p + 24, f.data.length, true);
        view.setUint16(p + 28, names[i].length, true);
        view.setUint32(p + 42, offsets[i], true);
        out.set(names[i], p + 46);
        p += 46 + names[i].length;
    });

    view.setUint32(p, 0x06054b50, true);              // end of central directory
    view.setUint16(p + 8, files.length, true);
    view.setUint16(p + 10, files.length, true);
    view.setUint32(p + 12, p - centralStart, true);
    view.setUint32(p + 16, centralStart, true);
    return out;
}
