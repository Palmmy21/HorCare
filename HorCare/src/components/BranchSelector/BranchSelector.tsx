import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, AlertCircle, Wrench, CheckCircle2, Clock, ChevronRight, ChevronDown, RefreshCw, LogOut, UserRound, KeyRound,
  Wallet, Home, ListTodo, Building2,
} from 'lucide-react';
import horcareLogo from '../../assets/horcare_logo.png';
import type { Building } from '../../types';
import { BUILDING_TYPE_LABELS } from '../../utils/workspaceTerminology';
import { formatCurrency } from '../../utils/calculations';
import { todayTh } from '../../shared/market';
import {
  branchInitials, branchKind, branchTotals, greeting, headline, lastAccessLabel, occupancyPct, sortBranches, thaiLongDate,
  type BranchSummary,
} from '../../shared/branchSummary';
import { useBranchSummary } from '../../hooks/useBranchSummary';
import './BranchSelector.css';

export type BranchTarget = 'overdue' | 'repairs';

interface BranchSelectorProps {
  buildings: Building[];
  /** Buildings still loading: show skeleton cards. */
  loading?: boolean;
  userUid: string;
  orgUid: string;
  onSelect: (id: string, target?: BranchTarget) => void;
  canAddBuilding: boolean;
  onAddBuilding: () => void;
  isStaff: boolean;
  userName: string;
  userEmail?: string;
  avatarUrl?: string | null;
  roleLabel: string;
  onOpenProfile: () => void;
  onChangePassword: () => void;
  onLogout: () => void;
  /** Own account / teams chooser, shown under the greeting when the person may work in more than one. */
  workspaceSwitcher?: React.ReactNode;
}

const SKELETON_KEY = 'horcare_branch_count';

export default function BranchSelector(props: BranchSelectorProps) {
  const { buildings, loading = false, userUid, orgUid, onSelect, canAddBuilding, onAddBuilding, isStaff } = props;
  const summary = useBranchSummary(userUid, orgUid, !loading && buildings.length > 0);

  // Skeletons match the number of branches last time.
  useEffect(() => {
    if (!loading && buildings.length > 0) { try { localStorage.setItem(SKELETON_KEY, String(buildings.length)); } catch { /* ignore */ } }
  }, [loading, buildings.length]);
  const skeletonCount = (() => { try { return Math.min(8, Math.max(1, Number(localStorage.getItem(SKELETON_KEY)) || 3)); } catch { return 3; } })();

  const sorted = useMemo(() => sortBranches(buildings, summary.lastAccess), [buildings, summary.lastAccess]);
  const known = sorted.map(b => summary.byId.get(b.id)).filter((x): x is BranchSummary => !!x);
  const totals = branchTotals(known, summary.canSeeFinance);
  const figuresReady = !summary.loading && !summary.error;

  const now = new Date();
  const thHour = new Date(now.getTime() + 7 * 3600_000).getUTCHours();
  const firstName = props.userName.split(/\s+/)[0];

  return (
    <div className="bs-page">
      <header className="bs-topbar">
        <div className="bs-brand">
          <img src={horcareLogo} alt="" className="bs-brand-logo" />
          <span>HorCare</span>
        </div>
        <UserMenu {...props} />
      </header>

      <main className="bs-main">
        <div className="bs-hello">
          <h1>{greeting(thHour)}, {firstName}</h1>
          <p>{thaiLongDate(todayTh(now))}</p>
        </div>
        {props.workspaceSwitcher}

        {/* FR-05 */}
        {(loading || buildings.length > 0) && (
          <section className="bs-totals" aria-label="สรุปรวมทุกสาขา">
            {/* money only for those allowed to see it (the server sends none otherwise) */}
            {summary.canSeeFinance || (!isStaff && !figuresReady) ? (
              <TotalCell icon={<Wallet size={16} />} label="เก็บได้เดือนนี้" loading={loading || summary.loading} failed={summary.error} onRetry={summary.retry}>
                {totals.revenueCollected !== null && (
                  <>
                    <div className="bs-total-value tnum">{formatCurrency(totals.revenueCollected)}</div>
                    <div className="bs-total-sub tnum">จาก {formatCurrency(totals.revenueExpected ?? 0)}</div>
                    <Bar pct={totals.revenueExpected ? (totals.revenueCollected / totals.revenueExpected) * 100 : 0} tone="success" />
                  </>
                )}
              </TotalCell>
            ) : null}
            <TotalCell icon={<Home size={16} />} label="อัตราเข้าใช้เฉลี่ย" loading={loading || summary.loading} failed={summary.error} onRetry={summary.retry}>
              <div className="bs-total-value tnum">{totals.occupancyPct === null ? '—' : `${totals.occupancyPct}%`}</div>
              <div className="bs-total-sub">ถ่วงตามจำนวนห้อง/แผง</div>
              <Bar pct={totals.occupancyPct ?? 0} tone="primary" />
            </TotalCell>
            <TotalCell icon={<ListTodo size={16} />} label="รอดำเนินการ" loading={loading || summary.loading} failed={summary.error} onRetry={summary.retry}>
              <div className={`bs-total-value tnum ${totals.pending > 0 ? 'is-warn' : 'is-ok'}`}>{totals.pending.toLocaleString('th-TH')} รายการ</div>
              <div className="bs-total-sub">บิลค้าง + แจ้งซ่อม</div>
            </TotalCell>
          </section>
        )}

        {buildings.length > 0 && (
          <div className="bs-section-head">
            <h2>{isStaff ? 'สาขาที่ดูแล' : 'สาขาของคุณ'} <span className="tnum">({buildings.length})</span></h2>
            {summary.error && (
              <button type="button" className="bs-retry" onClick={summary.retry}><RefreshCw size={14} /> โหลดตัวเลขไม่สำเร็จ · ลองใหม่</button>
            )}
          </div>
        )}

        {loading ? (
          <div className="bs-grid" aria-busy="true" aria-label="กำลังโหลดสาขา">
            {Array.from({ length: skeletonCount }, (_, i) => <div key={i} className="bs-card bs-skeleton" aria-hidden="true"><span /><span /><span /><span /></div>)}
          </div>
        ) : buildings.length === 0 ? (
          <div className="bs-empty">
            <Building2 size={40} aria-hidden />
            {isStaff ? (
              <>
                <h2>ยังไม่ได้รับสิทธิ์สาขาใด</h2>
                <p>กรุณาติดต่อผู้ดูแลเพื่อขอสิทธิ์เข้าใช้งานสาขา</p>
              </>
            ) : (
              <>
                <h2>ยังไม่มีสาขา</h2>
                <p>เริ่มต้นด้วยการเพิ่มหอพัก ตลาด หรืออสังหาฯ แห่งแรกของคุณ</p>
              </>
            )}
            {canAddBuilding && <div className="bs-grid bs-grid-single"><AddCard onClick={onAddBuilding} /></div>}
          </div>
        ) : (
          <div className="bs-grid">
            {sorted.map(b => (
              <BranchCard
                key={b.id}
                building={b}
                data={summary.byId.get(b.id)}
                state={summary.loading ? 'loading' : (summary.error || summary.failed.has(b.id) || !summary.byId.has(b.id)) ? 'failed' : 'ready'}
                lastAccessedAt={summary.lastAccess[b.id] ?? null}
                onSelect={onSelect}
                onRetry={summary.retry}
              />
            ))}
            {canAddBuilding && <AddCard onClick={onAddBuilding} />}
          </div>
        )}
      </main>
    </div>
  );
}

function BranchCard({ building, data, state, lastAccessedAt, onSelect, onRetry }: {
  building: Building;
  data: BranchSummary | undefined;
  state: 'loading' | 'ready' | 'failed';
  lastAccessedAt: string | null;
  onSelect: (id: string, target?: BranchTarget) => void;
  onRetry: () => void;
}) {
  const kind = branchKind(building.building_type);
  const typeLabel = BUILDING_TYPE_LABELS[building.building_type ?? 'dormitory'] ?? 'หอพัก';
  const head = headline(kind, data?.unitsOccupied ?? 0, data?.unitsTotal ?? 0);
  const pct = data ? occupancyPct(data.unitsOccupied, data.unitsTotal) : 0;
  const ready = state === 'ready' && !!data;

  return (
    <article className={`bs-card bs-kind-${kind}`}>
      {/* the whole card enters the branch; the badges below sit above it and go straight to their list */}
      <button type="button" className="bs-card-hit" onClick={() => onSelect(building.id)} aria-label={`เข้าสาขา ${building.name}`} />

      <div className="bs-card-top">
        <div className={`bs-card-icon ${building.logo ? 'has-logo' : ''}`} aria-hidden>
          {building.logo ? <img src={building.logo} alt="" /> : <span>{branchInitials(building.name)}</span>}
        </div>
        <div className="bs-card-title">
          <h3>{building.name}</h3>
          <span className="bs-type">{typeLabel}</span>
        </div>
      </div>

      <div className="bs-figure">
        <div className="bs-figure-row">
          <span className="bs-figure-label">{head.label}</span>
          {state === 'loading' ? <span className="bs-shimmer" style={{ width: 110 }} /> : (
            <span className="bs-figure-value tnum">
              {ready ? head.value : '—'}
              {ready && head.showPct && <span className="bs-figure-pct"> ({pct}%)</span>}
            </span>
          )}
        </div>
        <Bar pct={ready ? pct : 0} tone="kind" />
      </div>

      <div className="bs-badges">
        {state === 'loading' ? <span className="bs-shimmer" style={{ width: 140, height: 28 }} /> : !ready ? (
          <button type="button" className="bs-badge bs-badge-retry" onClick={onRetry}><RefreshCw size={13} aria-hidden /> ลองใหม่</button>
        ) : data.overdueInvoices === 0 && data.openRepairs === 0 ? (
          <span className="bs-badge bs-badge-ok"><CheckCircle2 size={14} aria-hidden /> ไม่มีรายการค้าง</span>
        ) : (
          <>
            {data.overdueInvoices > 0 && (
              <button type="button" className="bs-badge bs-badge-danger" onClick={() => onSelect(building.id, 'overdue')}
                aria-label={`ค้างชำระ ${data.overdueInvoices} บิล — เปิดหน้าบิลค้างของ ${building.name}`}>
                <AlertCircle size={14} aria-hidden /> ค้างชำระ <b className="tnum">{data.overdueInvoices}</b>
              </button>
            )}
            {data.openRepairs > 0 && (
              <button type="button" className="bs-badge bs-badge-warn" onClick={() => onSelect(building.id, 'repairs')}
                aria-label={`แจ้งซ่อม ${data.openRepairs} รายการ — เปิดหน้าแจ้งซ่อมของ ${building.name}`}>
                <Wrench size={14} aria-hidden /> แจ้งซ่อม <b className="tnum">{data.openRepairs}</b>
              </button>
            )}
          </>
        )}
      </div>

      <div className="bs-card-foot">
        <span><Clock size={13} aria-hidden /> {lastAccessLabel(lastAccessedAt)}</span>
        <span className="bs-enter">เข้าสาขา <ChevronRight size={15} aria-hidden /></span>
      </div>
    </article>
  );
}

function AddCard({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="bs-card bs-add" onClick={onClick}>
      <span className="bs-add-icon"><Plus size={24} aria-hidden /></span>
      <span className="bs-add-title">เพิ่มสาขาใหม่</span>
      <span className="bs-add-sub">หอพัก / คอนโด / ตลาด / รีสอร์ท</span>
    </button>
  );
}

function TotalCell({ icon, label, loading, failed, onRetry, children }: {
  icon: React.ReactNode; label: string; loading: boolean; failed: boolean; onRetry: () => void; children: React.ReactNode;
}) {
  return (
    <div className="bs-total">
      <div className="bs-total-label">{icon} {label}</div>
      {loading ? (
        <><span className="bs-shimmer" style={{ width: '60%', height: 26 }} /><span className="bs-shimmer" style={{ width: '40%' }} /></>
      ) : failed ? (
        <><div className="bs-total-value">—</div><button type="button" className="bs-retry" onClick={onRetry}><RefreshCw size={13} /> ลองใหม่</button></>
      ) : children}
    </div>
  );
}

function Bar({ pct, tone }: { pct: number; tone: 'kind' | 'primary' | 'success' }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className={`bs-bar bs-bar-${tone}`} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${v}%` }} />
    </div>
  );
}

function UserMenu({ userName, userEmail, avatarUrl, roleLabel, onOpenProfile, onChangePassword, onLogout }: BranchSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const initials = branchInitials(userName);
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div className="bs-user" ref={ref}>
      <button ref={btnRef} type="button" className="bs-user-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        aria-label={`บัญชีของ ${userName}`}>
        <span className="bs-avatar">{avatarUrl ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials}</span>
        <span className="bs-user-name">{userName}</span>
        <ChevronDown size={16} className="bs-user-caret" aria-hidden />
      </button>
      {open && (
        <div className="bs-menu" role="menu" aria-label="เมนูบัญชี">
          <div className="bs-menu-head">
            <strong>{userName}</strong>
            {userEmail && <span>{userEmail}</span>}
            <span className="bs-menu-role">{roleLabel}</span>
          </div>
          <button type="button" role="menuitem" onClick={pick(onOpenProfile)}><UserRound size={16} aria-hidden /> โปรไฟล์</button>
          <button type="button" role="menuitem" onClick={pick(onChangePassword)}><KeyRound size={16} aria-hidden /> เปลี่ยนรหัสผ่าน</button>
          <button type="button" role="menuitem" className="is-danger" onClick={pick(onLogout)}><LogOut size={16} aria-hidden /> ออกจากระบบ</button>
        </div>
      )}
    </div>
  );
}
