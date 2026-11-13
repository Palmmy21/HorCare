/** Shared by the document pages (contract, invoice). */

export interface DocIssuer {
  name?: string;
  address?: string;
  phone?: string;
  logo?: string;
}

export function thaiLongDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const bahtAmount = (n?: number) =>
  `${Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
