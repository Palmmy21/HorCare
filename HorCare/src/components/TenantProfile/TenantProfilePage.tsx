import { useState, useEffect, useCallback } from 'react';

function useMobile(breakpoint = 640): boolean {
  const [mobile, setMobile] = useState(() => window.innerWidth <= breakpoint);
  const update = useCallback(() => setMobile(window.innerWidth <= breakpoint), [breakpoint]);
  useEffect(() => {
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [update]);
  return mobile;
}
import {
  User, Calendar, Banknote,
  Plus, Trash2, Edit2, Check, X, CheckCircle2,
  Clock, LogIn, LogOut, RefreshCw, FileText, Lock, Zap,
  Heart, GraduationCap, ClipboardList, AlertTriangle, Users,
} from 'lucide-react';
import type { Room, TenantProfile, TenantEvent } from '../../types';
import { useTenantProfile } from '../../hooks/useTenantProfiles';

interface TenantProfilePageProps {
  room: Room;
  uid: string;
  buildingId: string;
  isPaid: boolean;          // paid plan = access extended fields
  onUpgrade?: () => void;
  onClose: () => void;
}

type TabId = 'info' | 'contract' | 'history';

const EVENT_LABELS: Record<TenantEvent['type'], { label: string; color: string; icon: React.ReactNode }> = {
  move_in:           { label: 'เข้าอยู่',          color: '#059669', icon: <LogIn size={14} /> },
  move_out:          { label: 'ย้ายออก',            color: '#DC2626', icon: <LogOut size={14} /> },
  contract_renewed:  { label: 'ต่อสัญญา',           color: '#2563EB', icon: <RefreshCw size={14} /> },
  deposit_returned:  { label: 'คืนมัดจำ',           color: '#7C3AED', icon: <Banknote size={14} /> },
  note:              { label: 'บันทึก',             color: '#D97706', icon: <FileText size={14} /> },
};

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return iso; }
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ─── Empty form state ─────────────────────────────────────────────────────────
function emptyForm(): Omit<TenantProfile, 'id' | 'room_id' | 'building_id' | 'created_at' | 'updated_at'> {
  return {
    full_name: '', nickname: '', phone: '', line_display_name: '',
    tenant_count: 1,
    move_in_date: '', contract_end_date: '', expected_move_out: '',
    deposit_amount: undefined, deposit_status: 'held', deposit_note: '',
    birthdate: '', id_card_number: '', occupation: '', university: '',
    year_of_study: undefined,
    emergency_name: '', emergency_phone: '', emergency_relation: '',
  };
}

export default function TenantProfilePage({
  room, uid, buildingId, isPaid, onUpgrade, onClose,
}: TenantProfilePageProps) {
  const { profile, events, loading, saveProfile, addEvent, deleteEvent } =
    useTenantProfile(uid, buildingId, room.id);

  const isMobile = useMobile();
  const [activeTab, setActiveTab] = useState<TabId>('info');
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm());

  // ── New event form ──
  const [showEventForm, setShowEventForm] = useState(false);
  const [newEvent, setNewEvent] = useState<{ type: TenantEvent['type']; date: string; note: string }>({
    type: 'note', date: new Date().toISOString().slice(0, 10), note: '',
  });

  // Sync form with profile when loaded
  useEffect(() => {
    if (profile) {
      setForm({
        full_name: profile.full_name ?? '',
        nickname: profile.nickname ?? '',
        phone: profile.phone ?? '',
        line_display_name: profile.line_display_name ?? '',
        tenant_count: profile.tenant_count ?? room.tenant_count ?? 1,
        move_in_date: profile.move_in_date ?? '',
        contract_end_date: profile.contract_end_date ?? '',
        expected_move_out: profile.expected_move_out ?? '',
        deposit_amount: profile.deposit_amount,
        deposit_status: profile.deposit_status ?? 'held',
        deposit_note: profile.deposit_note ?? '',
        birthdate: profile.birthdate ?? '',
        id_card_number: profile.id_card_number ?? '',
        occupation: profile.occupation ?? '',
        university: profile.university ?? '',
        year_of_study: profile.year_of_study,
        emergency_name: profile.emergency_name ?? '',
        emergency_phone: profile.emergency_phone ?? '',
        emergency_relation: profile.emergency_relation ?? '',
      });
    } else {
      setForm(f => ({ ...f, tenant_count: room.tenant_count ?? 1 }));
    }
  }, [profile, room.tenant_count]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveProfile({ ...form, room_id: room.id, building_id: buildingId });
      setIsEditing(false);
    } catch (e) {
      console.error(e);
      alert('บันทึกไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setSaving(false);
    }
  };

  const handleAddEvent = async () => {
    if (!newEvent.date) return;
    await addEvent(newEvent);
    setShowEventForm(false);
    setNewEvent({ type: 'note', date: new Date().toISOString().slice(0, 10), note: '' });
  };

  const moveOutDays = daysUntil(profile?.expected_move_out ?? form.expected_move_out);
  const contractDays = daysUntil(profile?.contract_end_date ?? form.contract_end_date);

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'info',     label: isMobile ? 'ข้อมูล'  : 'ข้อมูลผู้เช่า',      icon: <User size={15} /> },
    { id: 'contract', label: isMobile ? 'สัญญา'   : 'สัญญา / มัดจำ',       icon: <FileText size={15} /> },
    { id: 'history',  label: isMobile ? 'ประวัติ' : 'ประวัติการเข้า-ออก', icon: <Clock size={15} /> },
  ];

  return (
    <div
      className="tenant-profile-overlay"
      style={{
        position: 'fixed', inset: 0, zIndex: 800,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: isMobile ? 'flex-end' : 'center',
        justifyContent: 'center',
        padding: isMobile ? '0' : '1rem',
      }}
      onClick={onClose}
    >
      <div
        className="tenant-profile-modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: isMobile ? '100%' : '640px',
          maxHeight: isMobile ? '92vh' : '90vh',
          display: 'flex', flexDirection: 'column',
          background: 'var(--color-surface, #fff)',
          borderRadius: isMobile ? '20px 20px 0 0' : '20px',
          overflow: 'hidden',
          boxShadow: '0 32px 80px rgba(0,0,0,0.4)',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          background: 'linear-gradient(135deg, #1e2535 0%, #2d3748 100%)',
          padding: isMobile ? '0.875rem 1rem' : '1.25rem 1.5rem',
          display: 'flex', alignItems: 'center', gap: '1rem',
          flexShrink: 0,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <User size={22} color="#fff" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: '1.0625rem', lineHeight: 1.2 }}>
              {profile?.full_name || 'ยังไม่มีข้อมูลผู้เช่า'}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.8rem', marginTop: '0.125rem' }}>
              ห้อง {room.room_number}
              {profile?.phone && ` • ${profile.phone}`}
            </div>
          </div>
          {/* Alert badges — hidden on mobile (visible on the card in the list) */}
          <div className="tenant-modal-alert-badges" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'flex-end' }}>
            {moveOutDays !== null && moveOutDays <= 60 && moveOutDays >= 0 && (
              <span style={{
                background: moveOutDays <= 14 ? 'rgba(220,38,38,0.25)' : 'rgba(245,158,11,0.25)',
                border: `1px solid ${moveOutDays <= 14 ? 'rgba(220,38,38,0.5)' : 'rgba(245,158,11,0.5)'}`,
                color: moveOutDays <= 14 ? '#FCA5A5' : '#FCD34D',
                borderRadius: '8px', padding: '0.2rem 0.5rem',
                fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><AlertTriangle size={12} /> ย้ายออกใน {moveOutDays} วัน</span>
              </span>
            )}
            {contractDays !== null && contractDays <= 30 && contractDays >= 0 && (
              <span style={{
                background: 'rgba(37,99,235,0.2)', border: '1px solid rgba(37,99,235,0.4)',
                color: '#93C5FD', borderRadius: '8px', padding: '0.2rem 0.5rem',
                fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap',
              }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}><ClipboardList size={12} /> สัญญาหมดใน {contractDays} วัน</span>
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)', border: 'none',
              borderRadius: '50%', width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: 'rgba(255,255,255,0.7)', flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div style={{
          display: 'flex', borderBottom: '1px solid var(--color-border, #E5E7EB)',
          background: 'var(--color-surface, #fff)', flexShrink: 0,
        }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: '0.75rem 0.5rem',
                background: 'none', border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                fontSize: '0.8125rem', fontWeight: activeTab === tab.id ? 700 : 500,
                color: activeTab === tab.id ? 'var(--color-primary, #8B5CF6)' : 'var(--color-text-muted, #6B7280)',
                borderBottom: activeTab === tab.id ? '2px solid var(--color-primary, #8B5CF6)' : '2px solid transparent',
                marginBottom: '-1px', transition: 'all 0.15s',
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '1rem' : '1.25rem 1.5rem' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
              <div className="loading-spinner" style={{ width: 32, height: 32 }} />
            </div>
          ) : (
            <>
              {/* ══ TAB: ข้อมูลผู้เช่า ══ */}
              {activeTab === 'info' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                  {/* Basic info section */}
                  <SectionCard title="ข้อมูลพื้นฐาน" icon={<User size={15} />}>
                    <FormGrid>
                      <Field label="ชื่อ-สกุล *" required>
                        {isEditing
                          ? <input className="form-input" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="ชื่อ นามสกุล" />
                          : <Value>{profile?.full_name || '—'}</Value>}
                      </Field>
                      <Field label="ชื่อเล่น">
                        {isEditing
                          ? <input className="form-input" value={form.nickname ?? ''} onChange={e => setForm(f => ({ ...f, nickname: e.target.value }))} placeholder="ชื่อเล่น" />
                          : <Value>{profile?.nickname || '—'}</Value>}
                      </Field>
                      <Field label="เบอร์โทรศัพท์ *">
                        {isEditing
                          ? <input className="form-input" type="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="08X-XXX-XXXX" />
                          : <Value>{profile?.phone || '—'}</Value>}
                      </Field>
                      <Field label="ชื่อ LINE">
                        {isEditing
                          ? <input className="form-input" value={form.line_display_name ?? ''} onChange={e => setForm(f => ({ ...f, line_display_name: e.target.value }))} placeholder="ชื่อที่แสดงใน LINE" />
                          : <Value>{profile?.line_display_name || room.line_user_id ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#10B981', fontWeight: 600 }}><CheckCircle2 size={13} /> เชื่อมต่อแล้ว</span> : '—'}</Value>}
                      </Field>
                      <Field label="อาชีพ / สถานศึกษา">
                        {isEditing
                          ? <input className="form-input" value={form.occupation ?? ''} onChange={e => setForm(f => ({ ...f, occupation: e.target.value }))} placeholder="นักศึกษา / บริษัท XYZ" />
                          : <Value>{profile?.occupation || '—'}</Value>}
                      </Field>
                      <Field label="จำนวนผู้พักอาศัย (คน)">
                        {isEditing ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input
                              className="form-input mono"
                              type="number"
                              min={1}
                              max={20}
                              value={form.tenant_count ?? room.tenant_count ?? 1}
                              onChange={e => setForm(f => ({ ...f, tenant_count: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                              style={{ width: '100px' }}
                            />
                            <span style={{ fontSize: '0.875rem', color: 'var(--color-gray-500)' }}>คน</span>
                          </div>
                        ) : (
                          <Value>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              background: 'rgba(14, 165, 233, 0.1)',
                              color: '#0284C7',
                              fontWeight: 700,
                              padding: '0.2rem 0.65rem',
                              borderRadius: '999px',
                              fontSize: '0.85rem'
                            }}>
                              <Users size={13} />
                              {(profile?.tenant_count ?? room.tenant_count ?? 1)} คน
                            </span>
                          </Value>
                        )}
                      </Field>
                    </FormGrid>
                  </SectionCard>

                  {/* Extended (Paid-only) */}
                  <SectionCard
                    title="ข้อมูลเพิ่มเติม"
                    icon={<GraduationCap size={15} />}
                    locked={!isPaid}
                    onUnlock={onUpgrade}
                  >
                    {isPaid ? (
                      <FormGrid>
                        <Field label="วันเกิด">
                          {isEditing
                            ? <input className="form-input" type="date" value={form.birthdate ?? ''} onChange={e => setForm(f => ({ ...f, birthdate: e.target.value }))} />
                            : <Value>{formatDate(profile?.birthdate)}</Value>}
                        </Field>
                        <Field label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>เลขบัตรประชาชน <AlertTriangle size={12} /></span>}>
                          {isEditing
                            ? <input className="form-input mono" value={form.id_card_number ?? ''} onChange={e => setForm(f => ({ ...f, id_card_number: e.target.value }))} placeholder="X-XXXX-XXXXX-XX-X" maxLength={17} />
                            : <Value>{profile?.id_card_number ? `${profile.id_card_number.slice(0,1)}-XXXX-XXXXX-XX-${profile.id_card_number.slice(-1)}` : '—'}</Value>}
                        </Field>
                        <Field label="มหาวิทยาลัย">
                          {isEditing
                            ? <input className="form-input" value={form.university ?? ''} onChange={e => setForm(f => ({ ...f, university: e.target.value }))} placeholder="ชื่อมหาวิทยาลัย" />
                            : <Value>{profile?.university || '—'}</Value>}
                        </Field>
                        <Field label="ปีการศึกษา">
                          {isEditing
                            ? <select className="form-input" value={form.year_of_study ?? ''} onChange={e => setForm(f => ({ ...f, year_of_study: e.target.value ? Number(e.target.value) : undefined }))}>
                                <option value="">—</option>
                                {[1,2,3,4,5,6].map(y => <option key={y} value={y}>ปี {y}</option>)}
                              </select>
                            : <Value>{profile?.year_of_study ? `ปี ${profile.year_of_study}` : '—'}</Value>}
                        </Field>
                      </FormGrid>
                    ) : (
                      <LockedPlaceholder onUpgrade={onUpgrade} />
                    )}
                  </SectionCard>

                  {/* Emergency contact */}
                  <SectionCard
                    title="ผู้ติดต่อฉุกเฉิน"
                    icon={<Heart size={15} />}
                    locked={!isPaid}
                    onUnlock={onUpgrade}
                  >
                    {isPaid ? (
                      <FormGrid>
                        <Field label="ชื่อผู้ติดต่อ">
                          {isEditing
                            ? <input className="form-input" value={form.emergency_name ?? ''} onChange={e => setForm(f => ({ ...f, emergency_name: e.target.value }))} placeholder="ชื่อ นามสกุล" />
                            : <Value>{profile?.emergency_name || '—'}</Value>}
                        </Field>
                        <Field label="ความสัมพันธ์">
                          {isEditing
                            ? <input className="form-input" value={form.emergency_relation ?? ''} onChange={e => setForm(f => ({ ...f, emergency_relation: e.target.value }))} placeholder="พ่อ / แม่ / พี่" />
                            : <Value>{profile?.emergency_relation || '—'}</Value>}
                        </Field>
                        <Field label="เบอร์โทร">
                          {isEditing
                            ? <input className="form-input" type="tel" value={form.emergency_phone ?? ''} onChange={e => setForm(f => ({ ...f, emergency_phone: e.target.value }))} placeholder="08X-XXX-XXXX" />
                            : <Value>{profile?.emergency_phone || '—'}</Value>}
                        </Field>
                      </FormGrid>
                    ) : (
                      <LockedPlaceholder onUpgrade={onUpgrade} />
                    )}
                  </SectionCard>
                </div>
              )}

              {/* ══ TAB: สัญญา / มัดจำ ══ */}
              {activeTab === 'contract' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <SectionCard title="วันที่สัญญา" icon={<Calendar size={15} />}>
                    <FormGrid>
                      <Field label="วันที่เข้าอยู่">
                        {isEditing
                          ? <input className="form-input" type="date" value={form.move_in_date ?? ''} onChange={e => setForm(f => ({ ...f, move_in_date: e.target.value }))} />
                          : <Value>{formatDate(profile?.move_in_date)}</Value>}
                      </Field>
                      <Field label="วันสิ้นสุดสัญญา">
                        {isEditing
                          ? <input className="form-input" type="date" value={form.contract_end_date ?? ''} onChange={e => setForm(f => ({ ...f, contract_end_date: e.target.value }))} />
                          : <Value>
                              {formatDate(profile?.contract_end_date)}
                              {contractDays !== null && contractDays <= 30 && contractDays >= 0 && (
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#F59E0B', fontWeight: 700 }}>
                                  เหลือ {contractDays} วัน
                                </span>
                              )}
                            </Value>}
                      </Field>
                      <Field label="วันที่คาดว่าจะย้ายออก">
                        {isEditing
                          ? <input className="form-input" type="date" value={form.expected_move_out ?? ''} onChange={e => setForm(f => ({ ...f, expected_move_out: e.target.value }))} />
                          : <Value>
                              {formatDate(profile?.expected_move_out)}
                              {moveOutDays !== null && moveOutDays <= 60 && moveOutDays >= 0 && (
                                <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: moveOutDays <= 14 ? '#F87171' : '#FCD34D', fontWeight: 700 }}>
                                  เหลือ {moveOutDays} วัน
                                </span>
                              )}
                            </Value>}
                      </Field>
                    </FormGrid>
                  </SectionCard>

                  <SectionCard title="มัดจำ" icon={<Banknote size={15} />}>
                    <FormGrid>
                      <Field label="จำนวนมัดจำ (บาท)">
                        {isEditing
                          ? <input className="form-input mono" type="number" value={form.deposit_amount ?? ''} onChange={e => setForm(f => ({ ...f, deposit_amount: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0" />
                          : <Value>{profile?.deposit_amount ? `฿${profile.deposit_amount.toLocaleString()}` : '—'}</Value>}
                      </Field>
                      <Field label="สถานะมัดจำ">
                        {isEditing
                          ? <select className="form-input" value={form.deposit_status} onChange={e => setForm(f => ({ ...f, deposit_status: e.target.value as TenantProfile['deposit_status'] }))}>
                              <option value="held">ถือไว้</option>
                              <option value="returned">คืนแล้ว</option>
                              <option value="deducted">หักแล้ว</option>
                            </select>
                          : <DepositBadge status={profile?.deposit_status} />}
                      </Field>
                      <Field label="หมายเหตุมัดจำ">
                        {isEditing
                          ? <input className="form-input" value={form.deposit_note ?? ''} onChange={e => setForm(f => ({ ...f, deposit_note: e.target.value }))} placeholder="หมายเหตุ..." />
                          : <Value>{profile?.deposit_note || '—'}</Value>}
                      </Field>
                    </FormGrid>
                  </SectionCard>
                </div>
              )}

              {/* ══ TAB: ประวัติ ══ */}
              {activeTab === 'history' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Add event button */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setShowEventForm(v => !v)}
                    >
                      <Plus size={15} /> เพิ่มรายการ
                    </button>
                  </div>

                  {/* Add event form */}
                  {showEventForm && (
                    <div style={{
                      background: 'var(--color-gray-50, #F9FAFB)',
                      border: '1px solid var(--color-border, #E5E7EB)',
                      borderRadius: '12px', padding: '1rem',
                      display: 'flex', flexDirection: 'column', gap: '0.75rem',
                    }}>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <select
                          className="form-input"
                          style={{ flex: 1, minWidth: '140px' }}
                          value={newEvent.type}
                          onChange={e => setNewEvent(v => ({ ...v, type: e.target.value as TenantEvent['type'] }))}
                        >
                          {Object.entries(EVENT_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                        <input
                          className="form-input mono"
                          type="date"
                          style={{ flex: 1 }}
                          value={newEvent.date}
                          onChange={e => setNewEvent(v => ({ ...v, date: e.target.value }))}
                        />
                      </div>
                      <input
                        className="form-input"
                        placeholder="หมายเหตุ (ถ้ามี)"
                        value={newEvent.note}
                        onChange={e => setNewEvent(v => ({ ...v, note: e.target.value }))}
                      />
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary btn-sm" onClick={handleAddEvent}>
                          <Check size={14} /> บันทึก
                        </button>
                        <button className="btn btn-secondary btn-sm" onClick={() => setShowEventForm(false)}>
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Timeline */}
                  {events.length === 0 ? (
                    <div className="empty-state" style={{ padding: '2.5rem 1rem' }}>
                      <Clock size={36} />
                      <h3>ยังไม่มีประวัติ</h3>
                      <p>กดปุ่ม "เพิ่มรายการ" เพื่อบันทึกการเข้า-ออก</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                      {events.map((ev, i) => {
                        const meta = EVENT_LABELS[ev.type];
                        return (
                          <div key={ev.id} style={{ display: 'flex', gap: '0.875rem', position: 'relative' }}>
                            {/* Timeline line */}
                            {i < events.length - 1 && (
                              <div style={{
                                position: 'absolute', left: '15px', top: '32px',
                                width: '2px', bottom: '-8px',
                                background: 'var(--color-border, #E5E7EB)',
                              }} />
                            )}
                            {/* Icon dot */}
                            <div style={{
                              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                              background: `${meta.color}18`,
                              border: `2px solid ${meta.color}40`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: meta.color, zIndex: 1,
                            }}>
                              {meta.icon}
                            </div>
                            {/* Content */}
                            <div style={{ flex: 1, paddingBottom: '1rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.125rem' }}>
                                <span style={{ fontWeight: 700, fontSize: '0.875rem', color: meta.color }}>{meta.label}</span>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #6B7280)' }}>{formatDate(ev.date)}</span>
                                <button
                                  onClick={() => confirm('ลบรายการนี้?') && deleteEvent(ev.id)}
                                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-gray-300, #D1D5DB)', padding: '0 0.25rem' }}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                              {ev.note && (
                                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted, #6B7280)', margin: 0, lineHeight: 1.5 }}>
                                  {ev.note}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: isMobile ? '0.75rem 1rem' : '1rem 1.5rem', borderTop: '1px solid var(--color-border, #E5E7EB)',
          display: 'flex', gap: '0.75rem', justifyContent: 'flex-end',
          background: 'var(--color-surface, #fff)', flexShrink: 0,
        }}>
          {activeTab !== 'history' && (
            isEditing ? (
              <>
                <button className="btn btn-secondary" onClick={() => { setIsEditing(false); }}>
                  <X size={16} /> ยกเลิก
                </button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? <span className="loading-spinner" style={{ width: 16, height: 16 }} /> : <Check size={16} />}
                  บันทึก
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-secondary" onClick={onClose}>
                  ปิด
                </button>
                <button className="btn btn-primary" onClick={() => setIsEditing(true)}>
                  <Edit2 size={16} /> แก้ไขข้อมูล
                </button>
              </>
            )
          )}
          {activeTab === 'history' && (
            <button className="btn btn-secondary" onClick={onClose}>ปิด</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({
  title, icon, children, locked = false,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  locked?: boolean;
  onUnlock?: () => void;
}) {
  return (
    <div style={{
      border: '1px solid var(--color-border, #E5E7EB)',
      borderRadius: '12px', overflow: 'hidden',
    }}>
      <div style={{
        padding: '0.625rem 1rem',
        background: 'var(--color-gray-50, #F9FAFB)',
        borderBottom: '1px solid var(--color-border, #E5E7EB)',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        fontSize: '0.8125rem', fontWeight: 700,
        color: 'var(--color-text-muted, #6B7280)',
      }}>
        {icon} {title}
        {locked && (
          <span style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3rem',
            fontSize: '0.7rem', color: '#A78BFA',
            background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)',
            borderRadius: '6px', padding: '0.1rem 0.4rem',
          }}>
            <Lock size={10} /> Paid
          </span>
        )}
      </div>
      <div style={{ padding: '1rem' }}>{children}</div>
    </div>
  );
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.875rem' }}>
      {children}
    </div>
  );
}

function Field({ label, children, required }: { label: React.ReactNode; children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted, #6B7280)' }}>
        {label}{required && <span style={{ color: '#F87171' }}> *</span>}
      </label>
      {children}
    </div>
  );
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '0.9rem', color: 'var(--color-text, #111827)', fontWeight: 500, padding: '0.375rem 0' }}>
      {children}
    </div>
  );
}

function DepositBadge({ status }: { status?: TenantProfile['deposit_status'] }) {
  const map = {
    held:     { label: 'ถือไว้',  bg: 'rgba(245,158,11,0.1)', color: '#D97706', border: 'rgba(245,158,11,0.3)' },
    returned: { label: 'คืนแล้ว', bg: 'rgba(5,150,105,0.1)',  color: '#059669', border: 'rgba(5,150,105,0.3)' },
    deducted: { label: 'หักแล้ว', bg: 'rgba(220,38,38,0.1)',  color: '#DC2626', border: 'rgba(220,38,38,0.3)' },
  };
  const s = map[status ?? 'held'];
  return (
    <span style={{
      display: 'inline-block', padding: '0.25rem 0.625rem',
      borderRadius: '8px', fontSize: '0.8125rem', fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>
      {s.label}
    </span>
  );
}

function LockedPlaceholder({ onUpgrade }: { onUpgrade?: () => void }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '0.625rem', padding: '1.5rem 1rem', textAlign: 'center',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: '50%',
        background: 'rgba(139,92,246,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Lock size={18} color="#8B5CF6" />
      </div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted, #6B7280)', margin: 0 }}>
        ฟีเจอร์นี้สำหรับแพ็กเกจที่ชำระเงินแล้ว
      </p>
      {onUpgrade && (
        <button
          onClick={onUpgrade}
          style={{
            background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
            border: 'none', borderRadius: '10px',
            padding: '0.5rem 1.25rem', color: '#fff',
            fontWeight: 700, fontSize: '0.8125rem', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '0.375rem',
          }}
        >
          <Zap size={14} /> ดูแพ็กเกจ
        </button>
      )}
    </div>
  );
}
