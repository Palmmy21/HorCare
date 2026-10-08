import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import type { Building } from '../../types';
import { apiPost } from '../../utils/api';
import { useBuildingBilling, useBuildingPayments } from '../../hooks/useAccountingData';
import {
  aging, compare, monthlyRows, monthsBack, openItems, toCsv, topDebtors,
  type BillLike, type ChargeLike, type ChargePaymentLike, type FineLike, type FinanceInput, type MonthRow,
} from '../../shared/finance';
import { REVENUE_CATEGORIES, REVENUE_CATEGORY_LABELS_TH, thDate, type RevenueCategory } from '../../shared/accounting';
import { BarChart, Legend, RateChart } from './charts';
import { compactBaht } from './chartMath';

const COLORS = { billed: '#93C5FD', collected: '#16A34A', lastYear: '#F59E0B', cash: '#0EA5E9', transfer: '#8B5CF6', other: '#9CA3AF' };
const CATEGORY_COLORS: Record<RevenueCategory, string> = {
  rent: '#3B82F6', electric: '#F59E0B', water: '#06B6D4', common_fee: '#8B5CF6', fine: '#EF4444', stay: '#10B981', stall: '#F97316', walk_in: '#EC4899', other_income: '#9CA3AF',
};
const card: React.CSSProperties = { border: '1px solid var(--color-gray-200, #E5E7EB)', borderRadius: 12, padding: '0.9rem', background: 'var(--color-white, #fff)', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 };
const baht = (s: number) => `฿${(s / 100).toLocaleString('th-TH', { maximumFractionDigits: 0 })}`;
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00+07:00`).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
const fieldStyle: React.CSSProperties = { padding: '0.45rem 0.6rem', border: '1px solid var(--color-gray-300, #D1D5DB)', borderRadius: 8, font: 'inherit', minWidth: 0 };

function download(name: string, mime: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function Delta({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>{label}: —</span>;
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return <span style={{ fontSize: '0.75rem', color: up ? '#15803D' : '#B91C1C', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Icon size={12} /> {label} {up ? '+' : ''}{pct.toFixed(0)}%</span>;
}

/** The owner's money picture for one property: billed vs collected, where income comes from, what is overdue. */
export default function FinanceOverviewTab({ ownerUid, buildings }: { ownerUid: string; buildings: Building[] }) {
  const [buildingId, setBuildingId] = useState(buildings[0]?.id ?? '');
  const today = thDate(new Date().toISOString());
  const [month, setMonth] = useState(today.slice(0, 7));
  const { bills, fines, loading: l1 } = useBuildingBilling(ownerUid, buildingId || null);
  const { payments, loading: l2 } = useBuildingPayments(ownerUid, buildingId || null);
  const [series, setSeries] = useState<{ key: string; charges: ChargeLike[]; chargePayments: ChargePaymentLike[] } | null>(null);

  // Daily / weekly charges live in Supabase; a property that does not use them (or has no Supabase yet) simply has none.
  useEffect(() => {
    if (!buildingId) return;
    let cancelled = false;
    apiPost<{ charges: ChargeLike[]; payments: ChargePaymentLike[] }>('collections', { owner_uid: ownerUid, building_id: buildingId, action: 'finance_series', months: 24 })
      .then(r => { if (!cancelled) setSeries({ key: buildingId, charges: r.charges, chargePayments: r.payments }); })
      .catch(() => { if (!cancelled) setSeries({ key: buildingId, charges: [], chargePayments: [] }); });
    return () => { cancelled = true; };
  }, [ownerUid, buildingId]);
  const charges = series?.key === buildingId ? series : null;

  const input: FinanceInput = useMemo(() => ({
    bills: bills as unknown as BillLike[], fines: fines as unknown as FineLike[], payments, charges: charges?.charges ?? [], chargePayments: charges?.chargePayments ?? [],
  }), [bills, fines, payments, charges]);

  const view = useMemo(() => {
    const m25 = monthsBack(month, 25);
    const all = monthlyRows(input, m25);
    const rows = all.slice(12);             // the 13 months shown
    const lastYear = all.slice(0, 13);      // the same months a year earlier
    const cmp = compare(input, month);
    const open = openItems(input);
    const total = (f: (r: MonthRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    return { rows, lastYear, cmp, open, aging: aging(open, today), debtors: topDebtors(open, today), billed12: total(r => r.billed_satang), collected12: total(r => r.collected_satang), cash12: total(r => r.cash_satang), transfer12: total(r => r.transfer_satang), other12: total(r => r.other_satang) };
  }, [input, month, today]);

  if (buildings.length === 0) return <div style={card}>ยังไม่มีสถานที่</div>;
  const loading = l1 || l2 || !charges;
  const { rows, cmp } = view;
  const labels = rows.map(r => monthLabel(r.month));
  const usedCategories = REVENUE_CATEGORIES.filter(c => rows.some(r => r.by_category[c] > 0));
  const rate = cmp.now.collection_rate;
  const prevRate = cmp.prev.collection_rate;
  const channelTotal = cmp.now.cash_satang + cmp.now.transfer_satang + cmp.now.other_satang;
  const noData = view.billed12 === 0 && view.collected12 === 0;

  const insights: string[] = [];
  if (cmp.billed_vs_prev !== null) insights.push(`เดือนนี้ตั้งยอดเรียกเก็บ ${baht(cmp.now.billed_satang)} ${cmp.billed_vs_prev >= 0 ? 'เพิ่มขึ้น' : 'ลดลง'} ${Math.abs(cmp.billed_vs_prev).toFixed(0)}% จากเดือนก่อน`);
  if (rate !== null) insights.push(`เก็บเงินได้จริง ${(rate * 100).toFixed(0)}% ของยอดที่เรียกเก็บ${prevRate !== null ? ` (เดือนก่อน ${(prevRate * 100).toFixed(0)}%)` : ''}`);
  if (view.aging.total_satang > 0) {
    const late = view.aging.buckets.slice(1).reduce((s, b) => s + b.satang, 0);
    insights.push(late > 0 ? `มียอดค้างเลยกำหนดรวม ${baht(late)} ${view.debtors[0] ? `— มากสุด ${view.debtors[0].label} ${baht(view.debtors[0].satang)}` : ''}` : `ยอดค้างทั้งหมด ${baht(view.aging.total_satang)} ยังไม่ถึงกำหนด`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={fieldStyle} value={buildingId} onChange={e => setBuildingId(e.target.value)} aria-label="สถานที่">{buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <input style={fieldStyle} type="month" value={month} max={today.slice(0, 7)} onChange={e => e.target.value && setMonth(e.target.value)} aria-label="เดือน" />
        <span style={{ flex: 1 }} />
        <button className="btn btn-outline btn-sm" disabled={noData} onClick={() => download(`horcare-finance-${month}.csv`, 'text/csv', `\u{FEFF}${toCsv(rows)}`)} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={14} /> CSV</button>
        <button className="btn btn-outline btn-sm" disabled={noData} onClick={() => download(`horcare-finance-${month}.json`, 'application/json', JSON.stringify({ building_id: buildingId, generated_for: month, unit: 'satang', months: rows }, null, 2))} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}><Download size={14} /> JSON</button>
      </div>

      {loading && <Loader2 className="spin" />}

      {!loading && noData && <div style={card}>ยังไม่มีข้อมูลบิลหรือการรับเงินใน 13 เดือนที่ผ่านมา กราฟจะขึ้นเมื่อมีการออกบิลหรือรับเงินครั้งแรก</div>}

      {!loading && !noData && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            <div style={card}>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>ตั้งยอดเรียกเก็บ · {monthLabel(month)}</span>
              <strong style={{ fontSize: '1.5rem' }}>{baht(cmp.now.billed_satang)}</strong>
              <Delta pct={cmp.billed_vs_prev} label="เทียบเดือนก่อน" /><Delta pct={cmp.billed_vs_last_year} label="เทียบปีก่อน" />
            </div>
            <div style={card}>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>รับเงินจริง · {monthLabel(month)}</span>
              <strong style={{ fontSize: '1.5rem', color: '#15803D' }}>{baht(cmp.now.collected_satang)}</strong>
              <Delta pct={cmp.collected_vs_prev} label="เทียบเดือนก่อน" /><Delta pct={cmp.collected_vs_last_year} label="เทียบปีก่อน" />
            </div>
            <div style={card}>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>อัตราเก็บเงินได้</span>
              <strong style={{ fontSize: '1.5rem' }}>{rate === null ? '—' : `${(rate * 100).toFixed(0)}%`}</strong>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>รับเงิน ÷ ยอดที่ตั้งไว้ในเดือนเดียวกัน</span>
            </div>
            <div style={{ ...card, background: view.aging.total_satang > 0 ? '#FFFBEB' : undefined }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)' }}>ยอดค้างชำระทั้งหมด</span>
              <strong style={{ fontSize: '1.5rem' }}>{baht(view.aging.total_satang)}</strong>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>{view.open.length} รายการ</span>
            </div>
          </div>

          {insights.length > 0 && (
            <div style={{ ...card, background: '#F0F9FF', borderColor: '#BAE6FD' }}>
              <strong>สรุปให้อ่านง่าย</strong>
              {insights.map(t => <span key={t} style={{ fontSize: '0.88rem' }}>• {t}</span>)}
            </div>
          )}

          <div style={card}>
            <strong>ยอดเรียกเก็บ เทียบ รับเงินจริง (13 เดือน)</strong>
            <Legend items={[{ label: 'ตั้งยอดเรียกเก็บ', color: COLORS.billed }, { label: 'รับเงินจริง', color: COLORS.collected }, { label: 'ยอดเรียกเก็บเดือนเดียวกันของปีก่อน', color: COLORS.lastYear, dashed: true }]} />
            <BarChart title="ยอดเรียกเก็บเทียบรับเงินจริงรายเดือน" labels={labels} mode="grouped"
              series={[{ key: 'billed', label: 'ตั้งยอด', color: COLORS.billed }, { key: 'collected', label: 'รับเงินจริง', color: COLORS.collected }]}
              values={[rows.map(r => r.billed_satang), rows.map(r => r.collected_satang)]}
              line={{ label: 'ปีก่อน', color: COLORS.lastYear, values: view.lastYear.map(r => (r.billed_satang > 0 ? r.billed_satang : null)) }} />
          </div>

          <div style={card}>
            <strong>รายได้มาจากไหน (แยกตามประเภท)</strong>
            <Legend items={usedCategories.map(c => ({ label: REVENUE_CATEGORY_LABELS_TH[c], color: CATEGORY_COLORS[c] }))} />
            <BarChart title="รายได้แยกตามประเภทรายเดือน" labels={labels} mode="stacked"
              series={usedCategories.map(c => ({ key: c, label: REVENUE_CATEGORY_LABELS_TH[c], color: CATEGORY_COLORS[c] }))}
              values={usedCategories.map(c => rows.map(r => r.by_category[c]))} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
            <div style={card}>
              <strong>อัตราเก็บเงินได้รายเดือน</strong>
              <RateChart title="อัตราเก็บเงินได้รายเดือน" labels={labels} values={rows.map(r => r.collection_rate)} color={COLORS.collected} target={1} />
              <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>เส้นประสีเขียว = เก็บครบ 100%</span>
            </div>

            <div style={card}>
              <strong>ช่องทางรับเงิน</strong>
              <Legend items={[{ label: 'เงินสด', color: COLORS.cash }, { label: 'โอน', color: COLORS.transfer }, { label: 'อื่น ๆ', color: COLORS.other }]} />
              {([['เดือนนี้', cmp.now.cash_satang, cmp.now.transfer_satang, cmp.now.other_satang, channelTotal], ['13 เดือน', view.cash12, view.transfer12, view.other12, view.cash12 + view.transfer12 + view.other12]] as const).map(([label, cash, transfer, other, total]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: '0.8rem' }}>{label} · {baht(total)}</span>
                  {total > 0 ? (
                    <div role="img" aria-label={`${label}: เงินสด ${baht(cash)} โอน ${baht(transfer)} อื่นๆ ${baht(other)}`} style={{ display: 'flex', height: 18, borderRadius: 9, overflow: 'hidden', background: 'var(--color-gray-100, #F3F4F6)' }}>
                      {[[cash, COLORS.cash, 'เงินสด'], [transfer, COLORS.transfer, 'โอน'], [other, COLORS.other, 'อื่น ๆ']].map(([v, c, n]) => <div key={n as string} title={`${n}: ${baht(v as number)}`} style={{ width: `${((v as number) / total) * 100}%`, background: c as string }} />)}
                    </div>
                  ) : <span style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)' }}>ยังไม่มีการรับเงิน</span>}
                </div>
              ))}
            </div>
          </div>

          <div style={card}>
            <strong>ยอดค้างชำระ แยกตามอายุหนี้</strong>
            <BarChart title="ยอดค้างชำระแยกตามอายุหนี้" labels={view.aging.buckets.map(b => b.label)} mode="grouped" height={200}
              series={[{ key: 'owed', label: 'ค้างชำระ', color: '#F59E0B' }]} values={[view.aging.buckets.map(b => b.satang)]} />
            {view.debtors.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 700 }}>ลูกหนี้เลยกำหนดสูงสุด</span>
                {view.debtors.map(d => (
                  <div key={d.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.88rem' }}>
                    <span>{d.label} <small style={{ color: 'var(--color-gray-500)' }}>· ค้าง {d.oldest_days} วัน</small></span><strong>{baht(d.satang)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>
            ตัวเลขคำนวณจากบิล ค่าปรับ การรับเงิน และรายการเก็บรายวัน/สัปดาห์ของสถานที่นี้ · แสดงเป็นบาท (ย่อ {compactBaht(100000)} = 1,000 บาท) · ไฟล์ CSV/JSON เป็นข้อมูลรายเดือนสำหรับนำไปวิเคราะห์ต่อ
          </span>
        </>
      )}
    </div>
  );
}
