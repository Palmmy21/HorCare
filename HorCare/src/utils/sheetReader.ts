// Read the first sheet of an .xlsx file, or a .csv file, into rows of text — in the browser, with no library:
// an .xlsx file is a zip of XML parts, unpacked with DecompressionStream('deflate-raw') and read with DOMParser.

const MAX_ROWS = 2000;
const MAX_COLS = 60;

/** Rows of cell text (first row = headers). Throws Error('unsupported_file' | 'empty_file' | 'bad_file'). */
export async function readSheet(file: File): Promise<string[][]> {
    const name = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let rows: string[][];
    if (name.endsWith('.xlsx') || (bytes[0] === 0x50 && bytes[1] === 0x4b)) rows = await readXlsx(bytes);
    else if (name.endsWith('.csv') || name.endsWith('.txt') || file.type.startsWith('text/')) rows = parseCsv(decodeText(bytes));
    else throw new Error('unsupported_file');
    const trimmed = rows
        .map(r => r.slice(0, MAX_COLS).map(c => c.trim()))
        .filter(r => r.some(c => c !== ''))
        .slice(0, MAX_ROWS + 1);
    if (trimmed.length < 2) throw new Error('empty_file');
    return trimmed;
}

/** UTF-8 (with or without BOM); Thai Excel "CSV" saved as Windows-874 is detected by its replacement characters. */
function decodeText(bytes: Uint8Array): string {
    const utf8 = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
    if (!utf8.includes('\uFFFD')) return utf8;
    try { return new TextDecoder('windows-874').decode(bytes); } catch { return utf8; }
}

/** RFC 4180-style CSV: quoted fields may hold commas, quotes ("") and newlines. Also accepts tabs or semicolons. */
export function parseCsv(text: string): string[][] {
    const first = text.split(/\r?\n/, 1)[0] ?? '';
    const delim = [',', '\t', ';'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quoted) {
            if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"' && cell === '') quoted = true;
        else if (ch === delim) { row.push(cell); cell = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); rows.push(row); row = []; cell = '';
        } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

// ── xlsx ─────────────────────────────────────────────────────────────────────

async function unzipEntry(bytes: Uint8Array, wanted: (path: string) => boolean): Promise<Map<string, string>> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // End of central directory: scan back for its signature
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
        if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('bad_file');
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const out = new Map<string, string>();
    const utf8 = new TextDecoder('utf-8');
    for (let n = 0; n < count; n++) {
        if (view.getUint32(p, true) !== 0x02014b50) throw new Error('bad_file');
        const method = view.getUint16(p + 10, true);
        const size = view.getUint32(p + 20, true);
        const nameLen = view.getUint16(p + 28, true);
        const extraLen = view.getUint16(p + 30, true);
        const commentLen = view.getUint16(p + 32, true);
        const local = view.getUint32(p + 42, true);
        const path = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + commentLen;
        if (!wanted(path)) continue;
        const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const raw = bytes.subarray(dataStart, dataStart + size);
        if (method === 0) out.set(path, utf8.decode(raw));
        else if (method === 8) {
            const stream = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            out.set(path, await new Response(stream).text());
        } else throw new Error('bad_file');
    }
    return out;
}

function colIndex(ref: string): number {
    let n = 0;
    for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
    const parts = await unzipEntry(bytes, p => p === 'xl/workbook.xml' || p === 'xl/_rels/workbook.xml.rels' || p === 'xl/sharedStrings.xml' || p.startsWith('xl/worksheets/sheet'));
    const xml = (s: string | undefined) => (s ? new DOMParser().parseFromString(s, 'application/xml') : null);

    // the first sheet in the workbook's order (not always sheet1.xml)
    let sheetPath = 'xl/worksheets/sheet1.xml';
    const wb = xml(parts.get('xl/workbook.xml'));
    const rels = xml(parts.get('xl/_rels/workbook.xml.rels'));
    const firstSheet = wb?.getElementsByTagName('sheet')[0];
    const rid = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    if (rid && rels) {
        const rel = [...rels.getElementsByTagName('Relationship')].find(r => r.getAttribute('Id') === rid);
        const target = rel?.getAttribute('Target');
        if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    }
    const sheet = xml(parts.get(sheetPath));
    if (!sheet) throw new Error('bad_file');

    const shared = [...(xml(parts.get('xl/sharedStrings.xml'))?.getElementsByTagName('si') ?? [])]
        .map(si => [...si.getElementsByTagName('t')].map(t => t.textContent ?? '').join(''));

    const rows: string[][] = [];
    for (const r of [...sheet.getElementsByTagName('row')].slice(0, MAX_ROWS + 1)) {
        const row: string[] = [];
        for (const c of [...r.getElementsByTagName('c')]) {
            const i = colIndex(c.getAttribute('r') ?? '');
            if (i < 0 || i >= MAX_COLS) continue;
            const type = c.getAttribute('t');
            const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
            let value: string;
            if (type === 's') value = shared[Number(v)] ?? '';
            else if (type === 'inlineStr') value = [...c.getElementsByTagName('t')].map(t => t.textContent ?? '').join('');
            else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
            else value = v;
            while (row.length < i) row.push('');
            row[i] = value;
        }
        rows.push(row);
    }
    return rows;
}
