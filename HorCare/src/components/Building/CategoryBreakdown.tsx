import { Tags } from 'lucide-react';
import type { DormConfig, MonthlyBill, Room } from '../../types';
import { UNIT_CATEGORY_LABELS, categoryTotals, type UnitCategory } from '../../shared/unitCategory';

const baht = (n: number) => `฿${Math.round(n).toLocaleString('th-TH')}`;

/**
 * This month by kind of property (บ้านเช่า / คอนโด / ที่ดิน …) for a branch that holds several — tap one to work on it
 * alone (the same choice as the หมวดหมู่ bar above every page).
 */
export default function CategoryBreakdown({ rooms, bills, month, buildingType, onPick }: {
    rooms: Room[];
    bills: MonthlyBill[];
    month: string;
    buildingType?: DormConfig['building_type'];
    onPick: (category: UnitCategory) => void;
}) {
    const totals = categoryTotals(rooms, bills, month, buildingType);
    if (totals.length < 2) return null;
    const all = totals.reduce((s, t) => s + t.amount, 0);
    return (
        <section className="card cat-breakdown" aria-label="สรุปตามหมวดหมู่">
            <div className="cat-breakdown-head">
                <span className="card-title"><Tags size={17} aria-hidden /> สรุปตามหมวดหมู่ เดือนนี้</span>
                <span className="cat-breakdown-total">รวม {baht(all)}</span>
            </div>
            <div className="cat-breakdown-grid">
                {totals.map(t => (
                    <button key={t.category} type="button" className="cat-tile" onClick={() => onPick(t.category)} title={`ดูเฉพาะ${UNIT_CATEGORY_LABELS[t.category]}`}>
                        <span className="cat-tile-name">{UNIT_CATEGORY_LABELS[t.category]}</span>
                        <span className="cat-tile-amount">{baht(t.amount)}</span>
                        <span className="cat-tile-meta">{t.units} ยูนิต · ออกบิล {t.billed} · เก็บแล้ว {baht(t.paid)}</span>
                        <span className="cat-tile-bar" aria-hidden><span style={{ width: `${t.amount > 0 ? Math.round((t.paid / t.amount) * 100) : 0}%` }} /></span>
                    </button>
                ))}
            </div>
        </section>
    );
}
