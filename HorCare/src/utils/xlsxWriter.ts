// Write an .xlsx workbook in the browser with no library: an .xlsx file is a zip of XML parts. The parts are stored
// uncompressed (zip method 0), which every spreadsheet program reads; the files are small reports, so size is no issue.

export type Cell = string | number | null;
export interface SheetSpec {
    name: string;
    rows: Cell[][];
    /** Character widths per column. */
    widths?: number[];
    /** Rows (0-based) shown bold — headings and totals. */
    boldRows?: number[];
}

const xmlEsc = (s: string) => s
    // characters XML 1.0 cannot hold at all
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // eslint-disable-line no-control-regex
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Excel sheet names: at most 31 characters, none of []:*?/\ and unique in the workbook. */
export function sheetName(name: string, taken: Set<string>): string {
    const base = (name.replace(/[[\]:*?/\\]/g, ' ').trim() || 'Sheet').slice(0, 31);
    let out = base;
    for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
    taken.add(out.toLowerCase());
    return out;
}

/** Column letters: 0 → A, 25 → Z, 26 → AA. */
export function colName(i: number): string {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
}

function sheetXml(sheet: SheetSpec): string {
    const bold = new Set(sheet.boldRows ?? []);
    const cols = sheet.widths?.length
        ? `<cols>${sheet.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
        : '';
    const rows = sheet.rows.map((row, r) => {
        const b = bold.has(r);
        const cells = row.map((v, c) => {
            if (v === null || v === '') return '';
            const ref = `${colName(c)}${r + 1}`;
            if (typeof v === 'number' && Number.isFinite(v)) {
                // whole numbers plain; money with two decimals
                const style = Number.isInteger(v) ? (b ? 2 : 0) : (b ? 3 : 1);
                return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"${b ? ' s="2"' : ''}><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
        }).join('');
        return `<row r="${r + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>'
    + '<fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><name val="Tahoma"/></font></fonts>'
    + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="4">'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
    + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    + '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>'
    + '</cellXfs></styleSheet>';

/** The files inside the .xlsx zip, by path. */
export function workbookParts(sheets: SheetSpec[]): Record<string, string> {
    const taken = new Set<string>();
    const named = sheets.map(s => ({ ...s, name: sheetName(s.name, taken) }));
    const parts: Record<string, string> = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            + '<Default Extension="xml" ContentType="application/xml"/>'
            + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
            + named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
            + '</Types>',
        '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            + '</Relationships>',
        'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
            + named.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
            + '</sheets></workbook>',
        'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
            + `<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
            + '</Relationships>',
        'xl/styles.xml': STYLES,
    };
    named.forEach((s, i) => { parts[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });
    return parts;
}

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

export function crc32(bytes: Uint8Array): number {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

/** A zip archive with every file stored (no compression). */
export function storedZip(files: Record<string, string>): Uint8Array {
    const enc = new TextEncoder();
    const local: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const [path, text] of Object.entries(files)) {
        const name = enc.encode(path);
        const data = enc.encode(text);
        const crc = crc32(data);
        const head = new DataView(new ArrayBuffer(30));
        head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(6, 0x0800, true); // UTF-8 names
        head.setUint16(8, 0, true); head.setUint32(14, crc, true);
        head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, name.length, true);
        local.push(new Uint8Array(head.buffer), name, data);

        const dir = new DataView(new ArrayBuffer(46));
        dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true);
        dir.setUint32(16, crc, true); dir.setUint32(20, data.length, true); dir.setUint32(24, data.length, true);
        dir.setUint16(28, name.length, true); dir.setUint32(42, offset, true);
        central.push(new Uint8Array(dir.buffer), name);
        offset += 30 + name.length + data.length;
    }
    const dirSize = central.reduce((s, b) => s + b.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    const count = Object.keys(files).length;
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, count, true); end.setUint16(10, count, true);
    end.setUint32(12, dirSize, true); end.setUint32(16, offset, true);
    const all = [...local, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((s, b) => s + b.length, 0));
    let p = 0;
    for (const b of all) { out.set(b, p); p += b.length; }
    return out;
}

export function xlsxBytes(sheets: SheetSpec[]): Uint8Array {
    return storedZip(workbookParts(sheets));
}

export function downloadXlsx(fileName: string, sheets: SheetSpec[]) {
    const blob = new Blob([xlsxBytes(sheets).slice()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
}
