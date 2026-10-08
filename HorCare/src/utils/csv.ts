/**
 * Download rows as a UTF-8 CSV that Excel opens with Thai intact (BOM). Every cell is quoted, and text that
 * would start a formula in a spreadsheet (= + - @) is prefixed with an apostrophe so it stays text.
 */
export function csvText(rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v);
    const safe = typeof v === 'string' && /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return rows.map(r => r.map(esc).join(',')).join('\r\n');
}

export function downloadCsv(name: string, rows: (string | number)[][]) {
  const blob = new Blob(['\uFEFF' + csvText(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}