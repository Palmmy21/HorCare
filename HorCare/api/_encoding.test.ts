// Guard against a class of bug that already happened once: a script re-saved a file with the wrong text
// encoding and every Thai string in it turned into "เธชเธฑเธ…" (UTF-8 bytes read as Windows-874). The result
// compiles and passes every other test, then shows garbage to users. A real Thai word can never contain three
// of these "เธ?"/"เน?" pairs in a row, so finding them means a file was corrupted.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXTRA = '\\u20AC\\u2026\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u00A0';
const MOJIBAKE = new RegExp(`(?:เ[ธน][\\u0E00-\\u0E7F${EXTRA}]){3,}`);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (name !== 'node_modules') sourceFiles(path, out); }
    else if (/\.(ts|tsx|js|json|md|sql)$/.test(name)) out.push(path);
  }
  return out;
}

describe('Thai text encoding', () => {
  it('the detector recognises real mojibake and leaves real Thai alone', () => {
    expect(MOJIBAKE.test('เธชเธฑเธเธเธฒเน€เธเนเธฒ')).toBe(true);      // "สัญญาเช่า" read as Windows-874
    expect(MOJIBAKE.test('เน€เธเนเธฒเธชเธนเนเธฃเธฐเธเธ')).toBe(true);  // "เข้าสู่ระบบ"
    for (const ok of ['สัญญาเช่า', 'เข้าสู่ระบบ', 'เธอ', 'เน็ต', 'เนื้อหา', 'เธอเป็นเจ้าของ', 'ประกาศ & ตอบอัตโนมัติ']) expect(MOJIBAKE.test(ok), ok).toBe(false);
  });

  it('no source file contains mojibake', () => {
    const bad: string[] = [];
    for (const root of ['src', 'api', 'supabase']) {
      for (const file of sourceFiles(root)) {
        if (file.endsWith('_encoding.test.ts')) continue;
        const m = MOJIBAKE.exec(readFileSync(file, 'utf8'));
        if (m) bad.push(`${file}: ${m[0].slice(0, 30)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
