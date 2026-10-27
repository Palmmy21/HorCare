import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowDown, ArrowUp, Box, Check, ClipboardList, Link2, Map as MapIcon, MessageCircle, Minus, Pencil, Plus, Receipt, RotateCcw,
  Square, Trash2, Unlink, UserRound, X,
} from 'lucide-react';
import type { CleaningRequest, DormConfig, MaintenanceRequest, MonthlyBill, Room } from '../../types';
import type { Permission } from '../../shared/permissions';
import {
  addGap, addGroup, autoPlan, linkUnits, moveGroup, moveUnit, placeUnit, planKindOf, PLAN_LABELS, reconcile, removeGap,
  removeGroup, renameGroup, resizeUnit, setCols, unlinkUnit, MAX_COLS, MAX_SPAN, MIN_COLS, daysUntil, type FloorPlan,
} from '../../shared/floorPlan';
import { LAYER_LABELS, legendOf, type PlanLayer, type UnitMark } from '../../shared/planLayers';
import type { RoundStatus } from '../../shared/collections';
import { todayTh } from '../../shared/market';
import { useFloorPlan } from '../../hooks/useFloorPlan';
import { useRoomOccupancy } from '../../hooks/useRoomOccupancy';
import { todayRoundOf, useCollections } from '../../hooks/useCollections';
import { canOpenView } from '../../shared/viewAccess';
import { getWorkspaceTerms } from '../../utils/workspaceTerminology';
import { formatCurrency, formatMonthThai } from '../../utils/calculations';
import FloorPlanBoard from './FloorPlanBoard';
import { usePlanView } from './usePlanView';

const FloorPlan3D = lazy(() => import('./FloorPlan3D'));
const VIEW_KEY = 'horcare.plan.view';
const readView = (): '2d' | '3d' => { try { return localStorage.getItem(VIEW_KEY) === '3d' ? '3d' : '2d'; } catch { return '2d'; } };

type NavTarget = 'messages' | 'maintenance' | 'payments';

interface Props {
  uid: string;
  buildingId: string;
  config: DormConfig;
  rooms: Room[];
  bills: MonthlyBill[];
  currentMonth: string;
  maintenance: MaintenanceRequest[];
  cleaning: CleaningRequest[];
  /** Staff permissions; null for the owner. */
  permissions: readonly Permission[] | null;
  actorName?: string;
  onUpdateRoom: (roomId: string, updates: Partial<Room>) => Promise<void>;
  onAddRoom: (roomNumber: string) => Promise<Room | undefined>;
  onDeleteRoom: (roomId: string) => Promise<void>;
  onOpenTenant?: (room: Room) => void;
  onNavigate: (view: NavTarget) => void;
}

const thDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
};

/** Reads today's market round and hands it up; mounted only for markets whose staff may see collections. */
function MarketToday({ uid, buildingId, onRows }: { uid: string; buildingId: string; onRows: (rows: Record<string, RoundStatus>) => void }) {
  const today = todayTh();
  const { data } = useCollections(uid, buildingId, today, today);
  useEffect(() => {
    if (!data) return;
    onRows(Object.fromEntries(todayRoundOf(data).map(r => [r.room_id, r.status])));
  }, [data, onRows]);
  return null;
}

export default function FloorPlanPage(props: Props) {
  const { uid, buildingId, config, rooms, bills, currentMonth, maintenance, cleaning, permissions, actorName } = props;
  const terms = getWorkspaceTerms(config.building_type);
  const kind = planKindOf(config.building_type);
  const L = PLAN_LABELS[kind];
  const unitName = kind === 'streets' ? L.unit : terms.unitName;
  const canEdit = permissions === null || permissions.includes('property.update');
  const canCreate = permissions === null || permissions.includes('room.create');
  const canDelete = permissions === null || permissions.includes('room.delete');
  const canUpdateRoom = permissions === null || permissions.includes('room.update');

  const { plan: livePlan, saved, save } = useFloorPlan(uid, buildingId, rooms, kind);
  const { byRoom: occupancy, termsByRoom } = useRoomOccupancy(uid, buildingId, rooms, {
    leasing: canOpenView('leasing', permissions), tenants: canOpenView('tenants', permissions),
  });

  const showToday = terms.isMarket && canOpenView('collections', permissions);
  const [todayByRoom, setTodayByRoom] = useState<Record<string, RoundStatus> | undefined>(undefined);
  // the market's "today" layer appears once the round has loaded (a property without the collections module has none)
  const layers: PlanLayer[] = [...(todayByRoom ? ['today' as const] : []), 'occupancy', 'payment', 'contract', 'jobs'];
  const [layer, setLayer] = useState<PlanLayer>('occupancy');
  const [todayShown, setTodayShown] = useState(false);
  useEffect(() => { if (todayByRoom && !todayShown) { setLayer('today'); setTodayShown(true); } }, [todayByRoom, todayShown]);

  const [draft, setDraft] = useState<FloorPlan | null>(null);
  const editing = draft !== null;
  const plan = draft ?? livePlan;
  const [selected, setSelected] = useState<string[]>([]);
  const [slot, setSlot] = useState<{ groupId: string; col: number; row: number } | null>(null);
  const [newNumber, setNewNumber] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [areaInput, setAreaInput] = useState('');
  const [view3d, setView3d] = useState(() => readView() === '3d');
  const pickView = (on: boolean) => { setView3d(on); try { localStorage.setItem(VIEW_KEY, on ? '3d' : '2d'); } catch { /* per-viewer convenience only */ } };
  const show3d = view3d && !editing;

  const monthBills = useMemo(() => bills.filter(b => b.month === currentMonth), [bills, currentMonth]);
  const view = usePlanView({ plan, rooms, occupancy, termsByRoom, monthBills, maintenance, cleaning, todayByRoom, layer, terms });
  const roomsById = useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms]);
  const focus = selected.length === 1 ? roomsById.get(selected[0]) : undefined;
  useEffect(() => { setAreaInput(focus?.area_sqm ? String(focus.area_sqm) : ''); setConfirmDelete(false); }, [focus?.id, focus?.area_sqm]);

  const legend = legendOf(Object.values(view.marks));
  const apply = (next: FloorPlan | null, refusal: string) => { if (next) setDraft(next); else toast.error(refusal); };

  const startEdit = () => { setDraft(livePlan); setSelected([]); };
  const cancelEdit = () => { setDraft(null); setSelected([]); setSlot(null); setConfirmReset(false); };
  const saveEdit = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      await save(reconcile(draft, rooms, kind), actorName);
      toast.success('บันทึกผังแล้ว');
      cancelEdit();
    } catch { toast.error('บันทึกผังไม่สำเร็จ — ตรวจสิทธิ์การแก้ไขของบัญชีนี้'); }
    finally { setBusy(false); }
  };

  const onUnitClick = (id: string, additive: boolean) => {
    setSlot(null);
    setSelected(s => (additive ? (s.includes(id) ? s.filter(x => x !== id) : [...s, id]) : s.length === 1 && s[0] === id ? [] : [id]));
  };

  const addUnitAt = async () => {
    const number = newNumber.trim();
    if (!slot || !number || !draft) return;
    if (rooms.some(r => r.room_number === number)) { toast.error(`มี${unitName} ${number} อยู่แล้ว`); return; }
    setBusy(true);
    try {
      const created = await props.onAddRoom(number);
      if (!created) throw new Error('not_created');
      const group = draft.groups.find(g => g.id === slot.groupId);
      if (group && group.name) await props.onUpdateRoom(created.id, kind === 'floors' ? { floor: group.name.replace(/^ชั้น\s*/, '') } : { zone: group.name });
      const next = placeUnit(draft, created.id, slot.groupId, slot.col, slot.row);
      if (next) setDraft(next);
      toast.success(`เพิ่ม${unitName} ${number} แล้ว`);
      setSlot(null); setNewNumber('');
    } catch { toast.error(`เพิ่ม${unitName}ไม่สำเร็จ`); }
    finally { setBusy(false); }
  };

  const deleteFocus = async () => {
    if (!focus) return;
    setBusy(true);
    try {
      await props.onDeleteRoom(focus.id);
      toast.success(`ลบ${unitName} ${focus.room_number} แล้ว`);
      setSelected([]);
    } catch { toast.error(`ลบ${unitName}ไม่สำเร็จ`); }
    finally { setBusy(false); }
  };

  const saveArea = async () => {
    if (!focus) return;
    const v = areaInput.trim() === '' ? null : Number(areaInput);
    if (v !== null && (!Number.isFinite(v) || v <= 0 || v > 100_000)) { toast.error('พื้นที่ต้องเป็นตัวเลขมากกว่า 0'); return; }
    try { await props.onUpdateRoom(focus.id, { area_sqm: v }); toast.success('บันทึกพื้นที่แล้ว'); }
    catch { toast.error('บันทึกพื้นที่ไม่สำเร็จ'); }
  };

  const cellOf = (id: string) => plan.groups.flatMap(g => g.cells).find(c => c.room_id === id);
  const focusCell = focus ? cellOf(focus.id) : undefined;
  const links = selected.length > 1 ? selected : [];
  const focusGroup = focus ? view.groups[focus.id] : undefined;

  const groupTools = (g: FloorPlan['groups'][number]) => (
    <span className="plan-group-tools">
      {renaming?.id === g.id ? (
        <form onSubmit={e => { e.preventDefault(); apply(renameGroup(plan, g.id, renaming.name), 'ชื่อนี้ซ้ำหรือว่าง'); setRenaming(null); }} className="plan-inline-form">
          <input className="form-input" value={renaming.name} onChange={e => setRenaming({ id: g.id, name: e.target.value })} aria-label={`ชื่อ${L.group}`} autoFocus />
          <button type="submit" className="btn-icon" aria-label="บันทึกชื่อ"><Check size={15} /></button>
        </form>
      ) : (
        <button type="button" className="btn-icon" onClick={() => setRenaming({ id: g.id, name: g.name })} aria-label={`เปลี่ยนชื่อ ${g.name}`} title="เปลี่ยนชื่อ"><Pencil size={14} /></button>
      )}
      <span className="plan-cols" title="จำนวนช่องต่อแถว">
        <button type="button" className="btn-icon" disabled={g.cols <= MIN_COLS} onClick={() => apply(setCols(plan, g.id, g.cols - 1), 'ยังมียูนิตอยู่ในคอลัมน์สุดท้าย ย้ายออกก่อน')} aria-label="ลดช่องต่อแถว"><Minus size={14} /></button>
        <span>{g.cols} ช่อง</span>
        <button type="button" className="btn-icon" disabled={g.cols >= MAX_COLS} onClick={() => apply(setCols(plan, g.id, g.cols + 1), 'กว้างสุดแล้ว')} aria-label="เพิ่มช่องต่อแถว"><Plus size={14} /></button>
      </span>
      <button type="button" className="btn-icon" onClick={() => setDraft(moveGroup(plan, g.id, -1))} aria-label={`เลื่อน ${g.name} ขึ้น`} title="เลื่อนขึ้น"><ArrowUp size={14} /></button>
      <button type="button" className="btn-icon" onClick={() => setDraft(moveGroup(plan, g.id, 1))} aria-label={`เลื่อน ${g.name} ลง`} title="เลื่อนลง"><ArrowDown size={14} /></button>
      {g.cells.length === 0 && (
        <button type="button" className="btn-icon danger" onClick={() => apply(removeGroup(plan, g.id), 'ย้ายยูนิตออกก่อนจึงลบได้')} aria-label={`ลบ ${g.name}`} title={`ลบ${L.group}`}><Trash2 size={14} /></button>
      )}
    </span>
  );

  const slotMenu = slot && (
    <div className="plan-slot-menu" role="group" aria-label="ช่องว่างที่เลือก">
      <span className="plan-panel-note">ช่องที่เลือก: แถว {slot.row + 1} ช่อง {slot.col + 1}</span>
      {canCreate && (
        <form onSubmit={e => { e.preventDefault(); void addUnitAt(); }} className="plan-inline-form">
          <input className="form-input" value={newNumber} onChange={e => setNewNumber(e.target.value)} placeholder={terms.unitPlaceholder || `เลข${unitName}`} aria-label={`เลข${unitName}ใหม่`} autoFocus />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !newNumber.trim()}>เพิ่ม{unitName}</button>
        </form>
      )}
      <button type="button" className="btn btn-outline btn-sm" onClick={() => { apply(addGap(plan, slot.groupId, slot.col, slot.row), 'ช่องนี้ไม่ว่าง'); setSlot(null); }}>เว้นเป็นช่องว่าง</button>
      <button type="button" className="link-btn" onClick={() => setSlot(null)}>ปิด</button>
    </div>
  );

  const occLabel = (s?: string) => (s === 'occupied' ? terms.occupiedUnitLabel : s === 'reserved' ? terms.reservedUnitLabel : terms.vacantUnitLabel);
  const markText = (m?: UnitMark) => m?.label ?? '';
  const occ = focus ? occupancy[focus.id] : undefined;
  const focusTerms = focus ? termsByRoom[focus.id] : undefined;
  const focusBill = focus ? monthBills.find(b => b.room_id === focus.id && b.is_saved) : undefined;
  const focusJobs = focus ? [
    ...maintenance.filter(r => r.room_id === focus.id && (r.status === 'open' || r.status === 'in_progress')).map(r => ({ id: r.id, text: r.description || 'แจ้งซ่อม', kind: 'ซ่อม' })),
    ...cleaning.filter(r => r.room_id === focus.id && ['open', 'pending', 'assigned', 'in_progress'].includes(r.status)).map(r => ({ id: r.id, text: r.description || 'ทำความสะอาด', kind: 'แม่บ้าน' })),
  ] : [];
  const payLabel = (s?: string) => (s === 'paid' ? 'จ่ายแล้ว' : s === 'pending' ? 'รอตรวจสลิป' : 'ค้างชำระ');

  return (
    <div className="plan-page">
      {showToday && <MarketToday uid={uid} buildingId={buildingId} onRows={setTodayByRoom} />}
      <div className="page-header plan-page-head">
        <div>
          <h1 className="page-title"><MapIcon size={26} aria-hidden /> {L.title}</h1>
          <p className="page-subtitle">
            {view.summary.total} {unitName} · {terms.occupiedUnitLabel} {view.summary.occupied} ({view.summary.occupancyPct}%)
            {view.summary.area > 0 && <> · เช่าแล้ว {view.summary.areaLet.toLocaleString('th-TH')} จาก {view.summary.area.toLocaleString('th-TH')} ตร.ม.</>}
            {!saved && !editing && ' · ผังนี้จัดให้อัตโนมัติ'}
          </p>
        </div>
        {canEdit && !editing && <button type="button" className="btn btn-outline" onClick={startEdit}><Pencil size={16} /> แก้ไขผัง</button>}
      </div>

      {editing ? (
        <div className="plan-editbar" role="region" aria-label="แก้ไขผัง">
          <p>ลาก{unitName}เพื่อย้ายหรือสลับ · กด <Plus size={13} aria-hidden /> ที่ช่องว่างเพื่อเพิ่ม{unitName}หรือเว้นช่อง · กด{unitName}แล้วปรับขนาดหรือพื้นที่ได้ทางขวา · Shift+คลิกเลือกหลาย{unitName}เพื่อรวมผู้เช่า</p>
          <div className="plan-editbar-actions">
            <form onSubmit={e => { e.preventDefault(); apply(addGroup(plan, newGroup), `ชื่อ${L.group}ซ้ำหรือว่าง`); setNewGroup(''); }} className="plan-inline-form">
              <input className="form-input" value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder={`${L.group}ใหม่ เช่น ${kind === 'floors' ? 'ชั้น 5' : kind === 'zones' ? 'โซน F' : 'ซอย 3'}`} aria-label={`ชื่อ${L.group}ใหม่`} />
              <button type="submit" className="btn btn-outline btn-sm" disabled={!newGroup.trim()}><Plus size={14} /> เพิ่ม{L.group}</button>
            </form>
            <span className="plan-editbar-spacer" />
            {confirmReset ? (
              <span className="plan-confirm">จัดใหม่ทั้งผัง?
                <button type="button" className="btn btn-outline btn-sm" onClick={() => { setDraft({ ...autoPlan(rooms, kind), links: draft!.links }); setConfirmReset(false); }}>ใช่ จัดใหม่</button>
                <button type="button" className="link-btn" onClick={() => setConfirmReset(false)}>ไม่</button>
              </span>
            ) : (
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmReset(true)}><RotateCcw size={14} /> จัดอัตโนมัติ</button>
            )}
            <button type="button" className="btn btn-outline btn-sm" onClick={cancelEdit} disabled={busy}>ยกเลิก</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveEdit()} disabled={busy}><Check size={14} /> บันทึกผัง</button>
          </div>
        </div>
      ) : (
        <div className="plan-toolbar">
          <div className="seg plan-viewseg" role="group" aria-label="มุมมอง">
            <button type="button" className={`seg-item${!view3d ? ' active' : ''}`} aria-pressed={!view3d} onClick={() => pickView(false)}><Square size={14} aria-hidden /> 2 มิติ</button>
            <button type="button" className={`seg-item${view3d ? ' active' : ''}`} aria-pressed={view3d} onClick={() => pickView(true)}><Box size={14} aria-hidden /> 3 มิติ</button>
          </div>
          <div className="seg" role="tablist" aria-label="เลเยอร์">
            {layers.map(l => (
              <button key={l} type="button" role="tab" aria-selected={layer === l} className={`seg-item${layer === l ? ' active' : ''}`} onClick={() => setLayer(l)}>
                {l === 'payment' ? `${LAYER_LABELS[l]} · ${formatMonthThai(currentMonth)}` : LAYER_LABELS[l]}
              </button>
            ))}
          </div>
          <ul className="plan-legend" aria-label="คำอธิบาย">
            {legend.map(i => (
              <li key={`${i.tone}${i.label}`}><i className={`plan-key tone-${i.tone}`} aria-hidden /> {i.label} <b>{i.count}</b></li>
            ))}
          </ul>
        </div>
      )}

      <div className={`plan-layout${selected.length ? ' with-panel' : ''}`}>
        {show3d ? (
          <Suspense fallback={<div className="plan3d plan3d-loading" aria-busy="true">กำลังโหลดผัง 3 มิติ…</div>}>
            <FloorPlan3D
              plan={plan} kind={kind} units={view.units} marks={view.marks} tenantGroups={view.groups}
              groupLabel={L.group} unitLabel={unitName} selected={selected} onUnitClick={onUnitClick}
              onFallback={() => pickView(false)}
            />
          </Suspense>
        ) : (
        <FloorPlanBoard
          plan={plan} units={view.units} marks={view.marks} tenantGroups={view.groups}
          groupLabel={L.group} unitLabel={unitName} selected={selected} onUnitClick={onUnitClick}
          edit={editing ? {
            onDropUnit: (id, g, c, r) => apply(moveUnit(plan, id, g, c, r), 'วางตรงนั้นไม่ได้ — ช่องไม่พอหรือขนาดไม่เท่ากัน'),
            onSlotClick: (g, c, r) => { setSelected([]); setNewNumber(''); setSlot({ groupId: g, col: c, row: r }); },
            onGapClick: id => setDraft(removeGap(plan, id)),
            groupTools,
          } : undefined}
          activeSlot={slot} slotMenu={slotMenu}
        />
        )}

        {selected.length > 0 && (
          <aside className="plan-panel" aria-label={focus ? `${unitName} ${focus.room_number}` : 'เลือกหลายยูนิต'}>
            <div className="plan-panel-head">
              <h2>{focus ? `${unitName} ${focus.room_number}` : `เลือก ${selected.length} ${unitName}`}</h2>
              <button type="button" className="btn-icon" onClick={() => setSelected([])} aria-label="ปิด"><X size={18} /></button>
            </div>

            {links.length > 0 && (
              <div className="plan-panel-sec">
                <p className="plan-panel-note">{selected.map(id => roomsById.get(id)?.room_number).join(', ')}</p>
                {editing
                  ? <button type="button" className="btn btn-primary btn-sm" onClick={() => { apply(linkUnits(plan, selected), 'เลือกอย่างน้อย 2 ยูนิต'); toast.success('รวมเป็นผู้เช่าเดียวกันแล้ว (กดบันทึกผัง)'); }}><Link2 size={14} /> รวมเป็นผู้เช่าเดียวกัน</button>
                  : <p className="plan-panel-note">กด "แก้ไขผัง" เพื่อรวม{unitName}เหล่านี้เป็นผู้เช่าเดียวกัน</p>}
              </div>
            )}

            {focus && (
              <>
                <dl className="plan-facts">
                  <div><dt>สถานะ</dt><dd>{occLabel(occ?.status)}{occ && <small>{occ.override ? `ปรับเอง: ${occ.override.reason}` : occ.detail}</small>}</dd></div>
                  {layer !== 'occupancy' && <div><dt>{LAYER_LABELS[layer]}</dt><dd>{markText(view.marks[focus.id])}</dd></div>}
                  <div><dt>{terms.tenantLabel}</dt><dd>{focusTerms?.tenant ?? '—'}</dd></div>
                  {focusGroup && <div><dt>เช่ารวม</dt><dd>{focusGroup.map(id => roomsById.get(id)?.room_number).filter(Boolean).join(', ')}</dd></div>}
                  <div><dt>สัญญาถึง</dt><dd>{focusTerms?.end ? <>{thDate(focusTerms.end)} <small>{daysUntil(focusTerms.end, todayTh()) < 0 ? 'หมดแล้ว' : `อีก ${daysUntil(focusTerms.end, todayTh())} วัน`}</small></> : '—'}</dd></div>
                  <div><dt>บิล {formatMonthThai(currentMonth)}</dt><dd>{focusBill ? <>{formatCurrency(focusBill.total_bill)} <small>{payLabel(focusBill.payment_status)}</small></> : 'ยังไม่มีบิล'}</dd></div>
                  {(focus.area_sqm ?? 0) > 0 && (
                    <div><dt>พื้นที่</dt><dd>{focus.area_sqm!.toLocaleString('th-TH')} ตร.ม.{focus.rent_amount > 0 && <small>ค่าเช่า {formatCurrency(Math.round(focus.rent_amount / focus.area_sqm!))}/ตร.ม.</small>}</dd></div>
                  )}
                  {terms.isMarket && focus.business_type && <div><dt>สินค้า</dt><dd>{focus.business_type}</dd></div>}
                </dl>

                {focusJobs.length > 0 && (
                  <div className="plan-panel-sec">
                    <h3>งานค้าง {focusJobs.length}</h3>
                    <ul className="plan-jobs">{focusJobs.slice(0, 4).map(j => <li key={j.id}><span>{j.kind}</span> {j.text}</li>)}</ul>
                  </div>
                )}

                {!editing && (
                  <div className="plan-actions">
                    {props.onOpenTenant && <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onOpenTenant!(focus)}><UserRound size={15} /> ข้อมูล{terms.tenantLabel}</button>}
                    {canOpenView('messages', permissions) && <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onNavigate('messages')}><MessageCircle size={15} /> ทัก LINE</button>}
                    {canOpenView('maintenance', permissions) && <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onNavigate('maintenance')}><ClipboardList size={15} /> งานซ่อม</button>}
                    {canOpenView('payments', permissions) && <button type="button" className="btn btn-outline btn-sm" onClick={() => props.onNavigate('payments')}><Receipt size={15} /> ดูบิล</button>}
                  </div>
                )}

                {editing && focusCell && (
                  <div className="plan-panel-sec">
                    <h3>ขนาดบนผัง</h3>
                    <div className="plan-size">
                      <span>กว้าง</span>
                      <button type="button" className="btn-icon" disabled={focusCell.w <= 1} onClick={() => apply(resizeUnit(plan, focus.id, focusCell.w - 1, focusCell.h), 'ลดไม่ได้')} aria-label="ลดความกว้าง"><Minus size={14} /></button>
                      <b>{focusCell.w}</b>
                      <button type="button" className="btn-icon" disabled={focusCell.w >= MAX_SPAN} onClick={() => apply(resizeUnit(plan, focus.id, focusCell.w + 1, focusCell.h), 'ข้าง ๆ ไม่ว่าง — ย้ายยูนิตข้าง ๆ ออกก่อน')} aria-label="เพิ่มความกว้าง"><Plus size={14} /></button>
                      <span>สูง</span>
                      <button type="button" className="btn-icon" disabled={focusCell.h <= 1} onClick={() => apply(resizeUnit(plan, focus.id, focusCell.w, focusCell.h - 1), 'ลดไม่ได้')} aria-label="ลดความสูง"><Minus size={14} /></button>
                      <b>{focusCell.h}</b>
                      <button type="button" className="btn-icon" disabled={focusCell.h >= MAX_SPAN} onClick={() => apply(resizeUnit(plan, focus.id, focusCell.w, focusCell.h + 1), 'ด้านล่างไม่ว่าง — ย้ายยูนิตด้านล่างออกก่อน')} aria-label="เพิ่มความสูง"><Plus size={14} /></button>
                    </div>
                    {canUpdateRoom && (
                      <form className="plan-inline-form" onSubmit={e => { e.preventDefault(); void saveArea(); }}>
                        <label htmlFor="plan-area">พื้นที่ (ตร.ม.)</label>
                        <input id="plan-area" className="form-input" inputMode="decimal" value={areaInput} onChange={e => setAreaInput(e.target.value)} placeholder="เช่น 48" />
                        <button type="submit" className="btn btn-outline btn-sm">บันทึก</button>
                      </form>
                    )}
                    {focusGroup && (
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => setDraft(unlinkUnit(plan, focus.id))}><Unlink size={14} /> แยกออกจากกลุ่มผู้เช่า</button>
                    )}
                    {canDelete && (confirmDelete ? (
                      <div className="plan-confirm danger">
                        ลบ{unitName} {focus.room_number} ออกจากระบบ? บิลและประวัติจะไม่ถูกลบ
                        <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void deleteFocus()}>ลบ{unitName}</button>
                        <button type="button" className="link-btn" onClick={() => setConfirmDelete(false)}>ไม่ลบ</button>
                      </div>
                    ) : (
                      <button type="button" className="btn btn-outline btn-sm danger" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> ลบ{unitName}</button>
                    ))}
                  </div>
                )}
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
