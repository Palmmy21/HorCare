import { useState } from 'react';
import { Check, ChevronRight, Rocket, X } from 'lucide-react';
import type { DormConfig, MonthlyBill, Room } from '../../types';
import { useBankAccounts } from '../../hooks/useBankAccounts';
import { getWorkspaceTerms } from '../../utils/workspaceTerminology';

export type QuickStartTarget = 'settings' | 'rooms' | 'tenants' | 'recording' | 'summary';

interface QuickStartProps {
    config: DormConfig;
    rooms: Room[];
    bills: MonthlyBill[];
    ownerUid: string;
    buildingId: string;
    onGo: (view: QuickStartTarget) => void;
}

interface Step { key: string; title: string; hint: string; done: boolean; go: QuickStartTarget; action: string }

const dismissKey = (buildingId: string) => `horcare:quickstart-dismissed:${buildingId}`;

function readDismissed(buildingId: string): boolean {
    try { return localStorage.getItem(dismissKey(buildingId)) === '1'; } catch { return false; }
}

/** Setup checklist for a new property: each step reads the property's own data, so it ticks itself off as the owner goes. */
export default function QuickStart({ config, rooms, bills, ownerUid, buildingId, onGo }: QuickStartProps) {
    const terms = getWorkspaceTerms(config.building_type);
    const { accounts, loading } = useBankAccounts(ownerUid, buildingId);
    const [dismissed, setDismissed] = useState(() => readDismissed(buildingId));

    const active = rooms.filter(r => r.is_active);
    const bc = config.bill_customization;
    const steps: Step[] = [
        {
            key: 'info', title: `ข้อมูล${terms.facilityType}`, hint: 'ชื่อ เบอร์โทร และวันครบกำหนดชำระ — แสดงบนบิลทุกใบ',
            done: !!bc?.dorm_name?.trim() && !!bc?.dorm_phone?.trim(), go: 'settings', action: 'ตั้งค่า',
        },
        {
            key: 'rooms', title: `เพิ่ม${terms.unitNamePlural}`, hint: `เพิ่มทีละ${terms.unitName} สร้างทีละหลาย${terms.unitName} หรือนำเข้าจาก Excel`,
            done: active.length > 0, go: 'rooms', action: `จัดการ${terms.unitName}`,
        },
        {
            key: 'rent', title: 'ใส่ค่าเช่า', hint: `ทุก${terms.unitName}ที่เปิดใช้มีค่าเช่า บิลจึงคำนวณได้ถูก`,
            done: active.length > 0 && active.every(r => r.rent_amount > 0), go: 'rooms', action: 'ใส่ค่าเช่า',
        },
        {
            key: 'bank', title: 'บัญชีรับเงิน', hint: 'บัญชีธนาคาร / พร้อมเพย์ — ผู้เช่าสแกนจ่ายจากบิลได้ และระบบตรวจสลิปให้',
            done: accounts.length > 0, go: 'settings', action: 'เพิ่มบัญชี',
        },
        {
            key: 'line', title: `เชื่อม LINE ${terms.tenantLabel}`, hint: `พิมพ์ QR ลงทะเบียนทุก${terms.unitName}ครั้งเดียว แจกแล้วให้สแกน`,
            done: rooms.some(r => !!r.line_user_id), go: 'tenants', action: 'พิมพ์ QR',
        },
        {
            key: 'bill', title: 'ออกบิลแรก', hint: terms.isMarket ? 'ออกบิลค่าเช่าทุกแผงในครั้งเดียว' : 'จดมิเตอร์ หรือออกบิลค่าเช่าอย่างเดียวสำหรับห้องที่ไม่มีมิเตอร์',
            done: bills.length > 0, go: terms.isMarket ? 'summary' : 'recording', action: 'ออกบิล',
        },
    ];
    const doneCount = steps.filter(s => s.done).length;
    if (dismissed || loading || doneCount === steps.length) return null;

    const dismiss = () => {
        try { localStorage.setItem(dismissKey(buildingId), '1'); } catch { /* still hides for this visit */ }
        setDismissed(true);
    };
    const next = steps.find(s => !s.done);

    return (
        <section className="card qs" aria-label="เริ่มต้นใช้งาน">
            <div className="qs-head">
                <div className="qs-title"><Rocket size={18} /> เริ่มต้นใช้งาน <span className="qs-count">{doneCount}/{steps.length}</span></div>
                <button className="btn-icon" onClick={dismiss} aria-label="ซ่อนขั้นตอนเริ่มต้น" title="ซ่อน"><X size={16} /></button>
            </div>
            <div className="qs-bar" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={steps.length}>
                <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
            </div>
            <ol className="qs-list">
                {steps.map(s => (
                    <li key={s.key} className={`qs-step${s.done ? ' is-done' : ''}${s === next ? ' is-next' : ''}`}>
                        <span className="qs-dot">{s.done ? <Check size={13} /> : null}</span>
                        <span className="qs-text">
                            <span className="qs-step-title">{s.title}</span>
                            {!s.done && <span className="qs-hint">{s.hint}</span>}
                        </span>
                        {!s.done && (
                            <button className={`btn btn-sm ${s === next ? 'btn-primary' : 'btn-outline'}`} onClick={() => onGo(s.go)}>
                                {s.action} <ChevronRight size={14} />
                            </button>
                        )}
                    </li>
                ))}
            </ol>
        </section>
    );
}
