import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { fromSatang } from '../../shared/accounting';
import type { JournalEntry, Ledger } from '../../shared/ledger';
import { bahtText, cashAccounts, VOUCHER_TITLES, voucherKind } from '../../shared/voucher';

const baht = (s: number) => fromSatang(s).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One journal entry on an A4 voucher (รับ / จ่าย / ทั่วไป) with the amount in words and signature boxes; prints, then closes. */
export default function VoucherPrint({ ledger, entry, onDone }: { ledger: Ledger; entry: JournalEntry; onDone: () => void }) {
    useEffect(() => {
        const after = () => onDone();
        window.addEventListener('afterprint', after);
        const t = window.setTimeout(() => window.print(), 50); // let the portal paint first
        return () => { window.clearTimeout(t); window.removeEventListener('afterprint', after); };
    }, [onDone]);

    const kind = voucherKind(entry, cashAccounts(ledger));
    const names = new Map(ledger.accounts.map(a => [a.code, a.name]));
    const dr = entry.lines.reduce((s, l) => s + l.dr_satang, 0);
    const cr = entry.lines.reduce((s, l) => s + l.cr_satang, 0);
    const signers = kind === 'receipt' ? ['ผู้รับเงิน', 'ผู้บันทึกบัญชี', 'ผู้ตรวจสอบ']
        : kind === 'payment' ? ['ผู้รับเงิน', 'ผู้จ่ายเงิน', 'ผู้บันทึกบัญชี', 'ผู้อนุมัติ']
            : ['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'];

    return createPortal(
        <div className="voucher-print">
            <div className="vp-head">
                <div>
                    <div className="vp-entity">{ledger.legal_entity_name || ledger.name}</div>
                    {ledger.legal_entity_name && ledger.name && <div className="vp-sub">{ledger.name}</div>}
                </div>
                <div className="vp-title">{VOUCHER_TITLES[kind]}</div>
            </div>
            <div className="vp-meta">
                <span>เลขที่ <b>{entry.doc_ref}</b></span>
                <span>วันที่ <b>{new Date(`${entry.date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}</b></span>
            </div>
            <div className="vp-memo">คำอธิบาย: {entry.memo}</div>
            <table className="vp-table">
                <thead><tr><th>รหัสบัญชี</th><th>ชื่อบัญชี</th><th>รายละเอียด</th><th className="num">เดบิต</th><th className="num">เครดิต</th></tr></thead>
                <tbody>
                    {entry.lines.map((l, i) => (
                        <tr key={i}>
                            <td>{l.account}</td><td>{names.get(l.account) ?? ''}</td><td>{l.description}</td>
                            <td className="num">{l.dr_satang ? baht(l.dr_satang) : ''}</td><td className="num">{l.cr_satang ? baht(l.cr_satang) : ''}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot><tr><td colSpan={3}>({bahtText(dr)})</td><td className="num">{baht(dr)}</td><td className="num">{baht(cr)}</td></tr></tfoot>
            </table>
            {entry.reason && <div className="vp-memo">เหตุผล: {entry.reason}</div>}
            <div className="vp-signs">
                {signers.map(s => (
                    <div key={s} className="vp-sign">
                        <div className="vp-line" />
                        <div>{s}</div>
                        <div className="vp-date">วันที่ ____/____/______</div>
                    </div>
                ))}
            </div>
            <div className="vp-foot">บันทึกในระบบโดย {entry.posted_by_name} · {new Date(entry.posted_at).toLocaleString('th-TH')}</div>
        </div>,
        document.body,
    );
}
