// Parse a bank statement CSV into incoming-money rows. Thai bank exports differ, so columns are found
// by header keywords; rows without money coming in (withdrawals, malformed lines) are skipped and counted.

export interface StatementRow { occurred_at: string; amount: number; reference: string | null; description: string | null }
export interface StatementParse { rows: StatementRow[]; skipped: number; error: 'no_header' | 'no_columns' | null }

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

const HEADERS = {
  credit: /เงินเข้า|ฝาก|รับ|credit|deposit/i,
  debit: /เงินออก|ถอน|จ่าย|debit|withdraw/i,
  amount: /จำนวนเงิน|amount/i,
  date: /วันที่|date/i,
  time: /เวลา|time/i,
  desc: /รายละเอียด|ช่องทาง|หมายเหตุ|description|detail|memo|channel/i,
  ref: /อ้างอิง|ref/i,
};

export function parseMoney(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const s = raw.replace(/[,\s฿บาท]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** dd/mm/yyyy | dd-mm-yyyy | yyyy-mm-dd (Buddhist years converted) + optional hh:mm[:ss] → ISO at +07:00. */
export function parseStatementDate(dateRaw: string, timeRaw?: string): string | null {
  const dm = dateRaw.match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})/);
  if (!dm) return null;
  let y: number; let m: number; let d: number;
  if (dm[1].length === 4) { y = +dm[1]; m = +dm[2]; d = +dm[3]; }
  else { d = +dm[1]; m = +dm[2]; y = +dm[3]; }
  if (y > 2400) y -= 543;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const tm = (timeRaw ?? dateRaw.slice(dm[0].length)).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hh = tm ? +tm[1] : 0; const mm = tm ? +tm[2] : 0; const ss = tm?.[3] ? +tm[3] : 0;
  if (hh > 23 || mm > 59 || ss > 59) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  const dt = new Date(`${y}-${p(m)}-${p(d)}T${p(hh)}:${p(mm)}:${p(ss)}+07:00`);
  // reject overflow such as 31/02 (a valid Date would silently roll over to March)
  const noon = new Date(`${y}-${p(m)}-${p(d)}T12:00:00+07:00`);
  if (Number.isNaN(dt.getTime()) || noon.toISOString().slice(0, 10) !== `${y}-${p(m)}-${p(d)}`) return null;
  return dt.toISOString();
}

export function parseStatementCsv(text: string): StatementParse {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows: [], skipped: 0, error: 'no_header' };
  const delim = [',', ';', '\t'].map(d => [d, lines[0].split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitLine(lines[0], delim);
  const find = (re: RegExp, not?: number[]) => head.findIndex((h, i) => re.test(h) && !not?.includes(i));
  const debit = find(HEADERS.debit);
  const credit = find(HEADERS.credit, debit >= 0 ? [debit] : undefined);
  const amount = credit >= 0 ? -1 : find(HEADERS.amount, debit >= 0 ? [debit] : undefined);
  const date = find(HEADERS.date);
  const time = find(HEADERS.time, date >= 0 ? [date] : undefined);
  const desc = find(HEADERS.desc);
  const ref = find(HEADERS.ref);
  const moneyCol = credit >= 0 ? credit : amount;
  if (date < 0 || moneyCol < 0) return { rows: [], skipped: 0, error: 'no_columns' };

  const rows: StatementRow[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const c = splitLine(line, delim);
    const money = parseMoney(c[moneyCol]);
    const when = parseStatementDate(c[date] ?? '', time >= 0 ? c[time] : undefined);
    const isDebitRow = debit >= 0 && (parseMoney(c[debit]) ?? 0) > 0 && !(money && money > 0);
    if (money === null || money <= 0 || !when || isDebitRow) { skipped++; continue; }
    rows.push({
      occurred_at: when, amount: Math.round(money * 100) / 100,
      reference: ref >= 0 && c[ref] ? c[ref].slice(0, 80) : null,
      description: desc >= 0 && c[desc] ? c[desc].slice(0, 200) : null,
    });
  }
  return { rows, skipped, error: null };
}