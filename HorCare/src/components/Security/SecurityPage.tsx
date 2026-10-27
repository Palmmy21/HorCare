import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ShieldCheck, ScrollText, Users, Search, RefreshCw, Loader2, Download, UserPlus, Trash2, Link2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { Building, DormConfig } from '../../types';
import {
    AUDIT_ACTIONS, AUDIT_ACTION_LABELS_TH, type AuditAction, type AuditEntry,
} from '../../shared/audit';
import {
    ASSIGNABLE_ROLES, ROLE_LABELS_TH, type MemberDoc, type Role,
} from '../../shared/permissions';
import { apiPost, ApiError } from '../../utils/api';
import { logActivity } from '../../utils/auditLog';
import LineBindingsTab from './LineBindingsTab';
import { useSecurityAlerts } from '../../hooks/useSecurityAlerts';

import AdminAccountForm, { ResetPasswordButton, ScopeEditor } from './AdminAccountForm';

interface SecurityPageProps {
    ownerUid: string;
    buildings: Building[];
    config: DormConfig;
    onSaveConfig: (config: DormConfig) => Promise<void>;
}

type Tab = 'log' | 'members' | 'line';
const PAGE_SIZE = 300;

function formatValue(v: unknown): string {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') {
        return Object.entries(v as Record<string, unknown>)
            .map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`)
            .join(', ');
    }
    return String(v);
}

// ── Activity log tab ─────────────────────────────────────────────────────────
function ActivityLogTab({ ownerUid, buildings }: { ownerUid: string; buildings: Building[] }) {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [count, setCount] = useState(PAGE_SIZE);
    const [userFilter, setUserFilter] = useState('');
    const [actionFilter, setActionFilter] = useState<'' | AuditAction>('');
    const [propertyFilter, setPropertyFilter] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [search, setSearch] = useState('');

    const buildingName = useMemo(() => new Map(buildings.map(b => [b.id, b.name])), [buildings]);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Range + order on the same single field → no composite index needed.
            const constraints = [
                ...(from ? [where('timestamp_ms', '>=', new Date(`${from}T00:00:00`).getTime())] : []),
                ...(to ? [where('timestamp_ms', '<=', new Date(`${to}T23:59:59.999`).getTime())] : []),
                orderBy('timestamp_ms', 'desc'),
                limit(count),
            ];
            const snap = await getDocs(query(collection(db, `users/${ownerUid}/audit_logs`), ...constraints));
            setEntries(snap.docs.map(d => d.data() as AuditEntry));
        } catch (e) {
            const code = (e as { code?: string }).code;
            setError(code === 'permission-denied' ? 'คุณไม่มีสิทธิ์ดูประวัติการใช้งาน' : 'โหลดประวัติไม่สำเร็จ');
        } finally {
            setLoading(false);
        }
    }, [ownerUid, from, to, count]);

    useEffect(() => { void load(); }, [load]);

    const users = useMemo(() => {
        const m = new Map<string, string>();
        entries.forEach(e => m.set(e.user_id, e.user_name || e.user_id));
        return [...m.entries()];
    }, [entries]);

    const filtered = entries.filter(e => {
        if (userFilter && e.user_id !== userFilter) return false;
        if (actionFilter && e.action !== actionFilter) return false;
        if (propertyFilter && e.property_id !== propertyFilter) return false;
        if (search) {
            const q = search.toLowerCase();
            const hay = `${e.resource_label ?? ''} ${e.resource_type} ${e.resource_id ?? ''} ${e.user_name} ${e.note ?? ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    const exportCsv = () => {
        const rows = [
            ['เวลา', 'ผู้ใช้', 'บทบาท', 'การกระทำ', 'ประเภท', 'รายการ', 'สถานที่', 'ค่าก่อน', 'ค่าหลัง', 'IP', 'อุปกรณ์', 'หมายเหตุ'],
            ...filtered.map(e => [
                e.timestamp, e.user_name || e.user_id, e.role, AUDIT_ACTION_LABELS_TH[e.action] ?? e.action,
                e.resource_type, e.resource_label ?? e.resource_id ?? '',
                e.property_id ? (buildingName.get(e.property_id) ?? e.property_id) : '',
                formatValue(e.before), formatValue(e.after), e.ip_address ?? '', e.user_agent ?? '', e.note ?? '',
            ]),
        ];
        const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
        a.download = `activity_log_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        logActivity({ action: 'EXPORT', resourceType: 'config', resourceLabel: 'Activity log', note: `${filtered.length} rows`, propertyId: null });
    };

    const box: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 };

    return (
        <div>
            <div className="card" style={{ padding: '0.875rem 1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.625rem' }}>
                    <label style={box}>
                        <span className="form-label">ผู้ใช้</span>
                        <select className="form-input" value={userFilter} onChange={e => setUserFilter(e.target.value)}>
                            <option value="">ทั้งหมด</option>
                            {users.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                        </select>
                    </label>
                    <label style={box}>
                        <span className="form-label">การกระทำ</span>
                        <select className="form-input" value={actionFilter} onChange={e => setActionFilter(e.target.value as '' | AuditAction)}>
                            <option value="">ทั้งหมด</option>
                            {AUDIT_ACTIONS.map(a => <option key={a} value={a}>{AUDIT_ACTION_LABELS_TH[a]}</option>)}
                        </select>
                    </label>
                    <label style={box}>
                        <span className="form-label">สถานที่</span>
                        <select className="form-input" value={propertyFilter} onChange={e => setPropertyFilter(e.target.value)}>
                            <option value="">ทั้งหมด</option>
                            {buildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                        </select>
                    </label>
                    <label style={box}>
                        <span className="form-label">ตั้งแต่วันที่</span>
                        <input className="form-input" type="date" value={from} onChange={e => setFrom(e.target.value)} />
                    </label>
                    <label style={box}>
                        <span className="form-label">ถึงวันที่</span>
                        <input className="form-input" type="date" value={to} onChange={e => setTo(e.target.value)} />
                    </label>
                    <label style={box}>
                        <span className="form-label">ค้นหา</span>
                        <div style={{ position: 'relative' }}>
                            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-gray-400)' }} />
                            <input className="form-input" style={{ paddingLeft: '1.75rem', width: '100%' }} placeholder="ห้อง / รายการ" value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                    </label>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <button className="btn btn-outline btn-sm" onClick={() => void load()}><RefreshCw size={14} /> รีเฟรช</button>
                    <button className="btn btn-outline btn-sm" onClick={exportCsv} disabled={filtered.length === 0}><Download size={14} /> Export CSV</button>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)' }}>
                        แสดง {filtered.length} จาก {entries.length} รายการ
                    </span>
                </div>
            </div>

            {loading ? (
                <div style={{ padding: '3rem', textAlign: 'center' }}><Loader2 size={26} className="spin" /></div>
            ) : error ? (
                <div className="card" role="alert" style={{ padding: '2rem', textAlign: 'center', color: '#DC2626' }}>{error}</div>
            ) : filtered.length === 0 ? (
                <div className="card" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--color-gray-500)' }}>
                    <ScrollText size={36} style={{ opacity: 0.4, margin: '0 auto 0.5rem' }} />
                    <div>ยังไม่มีบันทึกที่ตรงกับตัวกรอง</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {filtered.map(e => (
                        <div key={e.event_id} className="card" style={{ padding: '0.75rem 1rem' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}>
                                <span style={{ fontWeight: 700 }}>{e.user_name || e.user_id}</span>
                                <span style={{ color: 'var(--color-gray-500)' }}>({ROLE_LABELS_TH[e.role as Role] ?? e.role})</span>
                                <span style={{ background: 'var(--color-gray-100)', borderRadius: 6, padding: '0.1rem 0.45rem', fontWeight: 700, fontSize: '0.72rem' }}>
                                    {AUDIT_ACTION_LABELS_TH[e.action] ?? e.action}
                                </span>
                                <span>{e.resource_label ?? e.resource_type}</span>
                                {e.property_id && <span style={{ color: 'var(--color-gray-500)' }}>· {buildingName.get(e.property_id) ?? e.property_id}</span>}
                                <span style={{ marginLeft: 'auto', color: 'var(--color-gray-500)' }}>
                                    {new Date(e.timestamp).toLocaleString('th-TH')}
                                </span>
                            </div>
                            {(e.before != null || e.after != null) && (
                                <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--color-gray-600)', marginTop: 4, wordBreak: 'break-word' }}>
                                    {formatValue(e.before)} <span style={{ opacity: 0.6 }}>→</span> {formatValue(e.after)}
                                </div>
                            )}
                            {(e.note || e.ip_address) && (
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-gray-500)', marginTop: 2 }}>
                                    {[e.note, e.ip_address && `IP ${e.ip_address}`].filter(Boolean).join(' · ')}
                                </div>
                            )}
                        </div>
                    ))}
                    {entries.length >= count && (
                        <button className="btn btn-outline" onClick={() => setCount(c => c + PAGE_SIZE)}>โหลดเพิ่ม</button>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Members tab ──────────────────────────────────────────────────────────────
function MembersTab({ ownerUid, buildings, config, onSaveConfig }: SecurityPageProps) {
    const [members, setMembers] = useState<MemberDoc[] | null>(null);
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<Role>('front_desk');
    const [scope, setScope] = useState<string[]>(['*']);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const { members: list } = await apiPost<{ members: MemberDoc[] }>('members', { action: 'list', owner_uid: ownerUid });
            setMembers(list);
        } catch {
            setMembers([]);
            toast.error('โหลดรายชื่อสมาชิกไม่สำเร็จ');
        }
    }, [ownerUid]);

    useEffect(() => { void load(); }, [load]);

    const act = async (body: Record<string, unknown>, okMsg: string) => {
        setBusy(true);
        try {
            await apiPost('members', { owner_uid: ownerUid, ...body });
            toast.success(okMsg);
            await load();
            return true;
        } catch (e) {
            const err = e as ApiError;
            toast.error(err.message && err.message !== err.code ? err.message : 'ดำเนินการไม่สำเร็จ');
            return false;
        } finally {
            setBusy(false);
        }
    };

    const add = async () => {
        if (!email.trim()) return;
        const who = email.trim();
        const ok = await act({ action: 'add', ...(who.includes('@') ? { email: who } : { phone: who }), role, property_ids: scope.length ? scope : ['*'] }, 'เพิ่มสมาชิกแล้ว');
        if (ok) setEmail('');
    };

    const toggleProperty = (id: string) => setScope(prev => {
        const without = prev.filter(p => p !== '*');
        return without.includes(id) ? without.filter(p => p !== id) : [...without, id];
    });

    const claimMode = config.claim_mode ?? 'invitation_only';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="card" style={{ padding: '1rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <Link2 size={16} /> การลงทะเบียนผู้เช่าผ่าน LINE
                </div>
                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.875rem' }}>
                    <input
                        type="checkbox" checked={claimMode === 'invitation_only'}
                        onChange={e => void onSaveConfig({ ...config, claim_mode: e.target.checked ? 'invitation_only' : 'legacy' })}
                    />
                    <span>
                        ต้องใช้รหัสเชิญรายห้องเท่านั้น (แนะนำ)
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>
                            ปิดตัวเลือกนี้จะกลับไปให้ผู้เช่าพิมพ์เลขห้องเองหลังใส่รหัสหอ ซึ่งเสี่ยงผูกผิดห้อง
                        </span>
                    </span>
                </label>
            </div>

            <AdminAccountForm ownerUid={ownerUid} buildings={buildings} onCreated={() => void load()} />

            <div className="card" style={{ padding: '1rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.625rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <UserPlus size={16} /> เพิ่มสมาชิกทีม (ที่มีบัญชี HorCare อยู่แล้ว)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '0.625rem' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span className="form-label">อีเมล หรือ เบอร์โทรที่สมัคร HorCare</span>
                        <input className="form-input" type="text" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="staff@example.com หรือ 0812345678" />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span className="form-label">บทบาท</span>
                        <select className="form-input" value={role} onChange={e => setRole(e.target.value as Role)}>
                            {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS_TH[r]}</option>)}
                        </select>
                    </label>
                </div>
                <div style={{ marginTop: '0.75rem' }}>
                    <div className="form-label" style={{ marginBottom: 4 }}>สถานที่ที่เข้าถึงได้</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.8125rem', display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input type="checkbox" checked={scope.includes('*')} onChange={e => setScope(e.target.checked ? ['*'] : [])} /> ทุกสถานที่
                        </label>
                        {!scope.includes('*') && buildings.map(b => (
                            <label key={b.id} style={{ fontSize: '0.8125rem', display: 'flex', gap: 4, alignItems: 'center' }}>
                                <input type="checkbox" checked={scope.includes(b.id)} onChange={() => toggleProperty(b.id)} /> {b.name}
                            </label>
                        ))}
                    </div>
                </div>
                <button className="btn btn-primary btn-sm" style={{ marginTop: '0.75rem' }} onClick={add} disabled={busy || !email.trim() || scope.length === 0}>
                    {busy ? <Loader2 size={14} className="spin" /> : <UserPlus size={14} />} เพิ่มสมาชิก
                </button>
            </div>

            <div className="card" style={{ padding: '1rem' }}>
                <div style={{ fontWeight: 700, marginBottom: '0.625rem' }}>สมาชิกทั้งหมด</div>
                {members === null ? (
                    <Loader2 size={18} className="spin" />
                ) : members.length === 0 ? (
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-gray-500)' }}>ยังไม่มีสมาชิก — คุณเป็นเจ้าของเพียงคนเดียว</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {members.map(m => (
                            <div key={m.uid} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap', fontSize: '0.8125rem' }}>
                                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                                    <div style={{ fontWeight: 700 }}>{m.display_name}</div>
                                    <div style={{ color: 'var(--color-gray-500)' }}>{m.email}</div>
                                </div>
                                <select
                                    className="form-input" style={{ width: 170 }} value={m.role} disabled={busy}
                                    onChange={e => void act({ action: 'update', member_uid: m.uid, role: e.target.value }, 'เปลี่ยนบทบาทแล้ว')}
                                >
                                    {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS_TH[r]}</option>)}
                                </select>
                                <ScopeEditor ownerUid={ownerUid} memberUid={m.uid} buildings={buildings} current={m.property_ids} onSaved={() => void load()} />
                                {m.managed && <ResetPasswordButton ownerUid={ownerUid} memberUid={m.uid} name={m.display_name} />}
                                <button
                                    className="btn btn-outline btn-sm" disabled={busy}
                                    onClick={() => void act({ action: 'update', member_uid: m.uid, status: m.status === 'active' ? 'disabled' : 'active' },
                                        m.status === 'active' ? 'ระงับสิทธิ์แล้ว' : 'เปิดสิทธิ์แล้ว')}
                                >
                                    {m.status === 'active' ? 'ระงับ' : 'เปิดใช้'}
                                </button>
                                <button
                                    className="btn btn-outline btn-sm" disabled={busy} aria-label="ลบสมาชิก"
                                    onClick={() => { if (confirm(`ลบ ${m.display_name} ออกจากทีม?`)) void act({ action: 'remove', member_uid: m.uid }, 'ลบสมาชิกแล้ว'); }}
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default function SecurityPage(props: SecurityPageProps) {
    const [tab, setTab] = useState<Tab>('log');
    const { openCount } = useSecurityAlerts(props.ownerUid, props.buildings.map(b => b.id));
    const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
        { id: 'log', label: 'ประวัติการใช้งาน', icon: ScrollText },
        { id: 'members', label: 'สมาชิกและสิทธิ์', icon: Users },
        { id: 'line', label: openCount > 0 ? `การผูก LINE (${openCount})` : 'การผูก LINE', icon: Link2 },
    ];
    return (
        <div>
            <div className="page-header">
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <ShieldCheck size={28} /> ความปลอดภัย
                    </h1>
                    <p className="page-subtitle">ตรวจสอบว่าใครทำอะไร และกำหนดสิทธิ์ของทีมงาน</p>
                </div>
            </div>
            <div style={{ display: 'inline-flex', background: 'var(--color-gray-100)', borderRadius: 'var(--radius-md)', padding: 3, gap: 3, marginBottom: '1rem' }}>
                {tabs.map(t => (
                    <button
                        key={t.id} onClick={() => setTab(t.id)} aria-pressed={tab === t.id}
                        style={{
                            border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', padding: '0.45rem 0.9rem',
                            display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8125rem', fontWeight: 600,
                            background: tab === t.id ? 'var(--color-white)' : 'transparent',
                            color: tab === t.id ? 'var(--color-gray-800)' : 'var(--color-gray-500)',
                            boxShadow: tab === t.id ? 'var(--shadow-sm)' : 'none',
                        }}
                    >
                        <t.icon size={14} /> {t.label}
                    </button>
                ))}
            </div>
            {tab === 'log' && <ActivityLogTab ownerUid={props.ownerUid} buildings={props.buildings} />}
            {tab === 'members' && <MembersTab {...props} />}
            {tab === 'line' && <LineBindingsTab ownerUid={props.ownerUid} buildings={props.buildings} />}
        </div>
    );
}
