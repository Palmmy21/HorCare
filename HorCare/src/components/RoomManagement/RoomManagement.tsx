import { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, Home, Zap, Droplets, Building2, Store, ClipboardList, CalendarDays, CalendarCheck, MessageCircle, Lock, CheckSquare, Square, UserCheck, Search, Filter, Download, Upload, Sparkles, Layers, LayoutGrid } from 'lucide-react';
import StallBoard from './StallBoard';
import type { Room, DormConfig, CommonFee } from '../../types';
import ImportSheetModal from './ImportSheetModal';
import BulkRoomModal from './BulkRoomModal';
import RoomEditModal from './RoomEditModal';
import { formatCurrency } from '../../utils/calculations';
import { LANGUAGE_MAP } from '../../utils/i18n/billTranslations';
import { defaultRentType, getWorkspaceTerms, rentTypeLabel, rentTypeOptions } from '../../utils/workspaceTerminology';
import TenantProfilePage from '../TenantProfile/TenantProfilePage';
import { downloadXlsx } from '../../utils/xlsxWriter';
import { importTemplateSheets } from '../../shared/importTemplate';
import { UNIT_CATEGORY_LABELS, categoriesInUse, categoryOf, unitHasMeters, type UnitCategory } from '../../shared/unitCategory';

interface RoomManagementProps {
    rooms: Room[];
    config: DormConfig;
    commonFees: CommonFee[];
    onAddRoom: (roomNumber: string) => void;
    /** Create many rooms at once; rejects if any room number already exists. */
    onBulkCreate?: (rooms: Partial<Room>[]) => Promise<{ created: number }>;
    onSaveConfig?: (config: DormConfig) => Promise<void>;
    onUpdateRoom: (roomId: string, updates: Partial<Room>) => Promise<void>;
    onDeleteRoom: (roomId: string) => void;
    maxRooms?: number;
    isTrial?: boolean;
    onUpgrade?: () => void;
    uid?: string;
    buildingId?: string;
    isPaid?: boolean;
}

export default function RoomManagement({
    rooms,
    config,
    commonFees,
    onAddRoom,
    onBulkCreate,
    onSaveConfig,
    onUpdateRoom,
    onDeleteRoom,
    maxRooms = Infinity,
    isTrial = false,
    onUpgrade,
    uid,
    buildingId,
    isPaid = false,
}: RoomManagementProps) {
    const terms = getWorkspaceTerms(config?.building_type);
    // markets open on the stall board (who is on which stall, book one); everything else on the table
    const [layout, setLayout] = useState<'board' | 'table'>(terms.isMarket ? 'board' : 'table');
    const [newRoomNumber, setNewRoomNumber] = useState('');
    const [editingRoom, setEditingRoom] = useState<string | null>(null);
    const [importResult, setImportResult] = useState<{ updated: number; created: number; tenants: number; skipped: string[] } | null>(null);
    const [showImport, setShowImport] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
    const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
    const [tenantRoomId, setTenantRoomId] = useState<string | null>(null);
    const [showBulk, setShowBulk] = useState(false);

    // ── Search & Filter state ───────────────────────────────────────────────────
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'dormitory' | 'commercial'>('all');
    const [filterLine, setFilterLine] = useState<'all' | 'linked' | 'unlinked'>('all');
    const [filterCat, setFilterCat] = useState<'all' | UnitCategory>('all');
    // a branch holding several kinds of property (houses, condos, land…) gets a filter and a badge per unit
    const cats = categoriesInUse(rooms, config?.building_type);
    const mixed = cats.length > 1;
    const catCount = (c: UnitCategory) => rooms.filter(r => categoryOf(r, config?.building_type) === c).length;

    const filteredRooms = rooms.filter(r => {
        if (filterCat !== 'all' && categoryOf(r, config?.building_type) !== filterCat) return false;
        const matchSearch = searchQuery === '' || r.room_number.toLowerCase().includes(searchQuery.toLowerCase());
        const matchType = filterType === 'all' || (r.room_type || 'dormitory') === filterType;
        const matchLine = filterLine === 'all'
            ? true
            : filterLine === 'linked' ? !!r.line_user_id : !r.line_user_id;
        return matchSearch && matchType && matchLine;
    });
    const isFiltering = searchQuery !== '' || filterType !== 'all' || filterLine !== 'all' || filterCat !== 'all';

    const hasAnyCommercial = rooms.some(r => (r.room_type || 'dormitory') === 'commercial');

    const atRoomLimit = rooms.length >= maxRooms;

    const handleAddRoom = () => {
        if (!newRoomNumber.trim()) return;
        if (atRoomLimit) return;

        // Check for duplicate
        if (rooms.some(r => r.room_number === newRoomNumber.trim())) {
            alert(`${terms.unitName}นี้มีอยู่แล้ว!`);
            return;
        }

        onAddRoom(newRoomNumber.trim());
        setNewRoomNumber('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleAddRoom();
        }
    };

    const startEdit = (room: Room) => setEditingRoom(room.id);

    const confirmDelete = (roomId: string) => {
        onDeleteRoom(roomId);
        setShowDeleteConfirm(null);
        setSelectedRooms(prev => { const s = new Set(prev); s.delete(roomId); return s; });
    };

    const toggleSelect = (id: string) => {
        setSelectedRooms(prev => {
            const s = new Set(prev);
            if (s.has(id)) { s.delete(id); } else { s.add(id); }
            return s;
        });
    };

    const isAllSelected = rooms.length > 0 && rooms.every(r => selectedRooms.has(r.id));

    const toggleSelectAll = () => {
        setSelectedRooms(isAllSelected ? new Set() : new Set(rooms.map(r => r.id)));
    };

    const setRentTypeFor = async (ids: string[], to: Room['rent_type']) => {
        await Promise.all(ids.map(id => onUpdateRoom(id, { rent_type: to })));
        setSelectedRooms(new Set());
    };
    const wantedRentType = defaultRentType(config?.building_type, config?.market_config?.default_rent_cycle);
    const offCycle = rooms.filter(r => (r.rent_type || 'monthly') !== wantedRentType && wantedRentType !== 'monthly' && (r.rent_type || 'monthly') === 'monthly');

    const handleBulkDelete = () => {
        selectedRooms.forEach(id => onDeleteRoom(id));
        setSelectedRooms(new Set());
        setShowBulkDeleteConfirm(false);
    };

    // ── Excel template: the import's own columns; the branch's units already filled in, to edit and import back ──
    const exportTemplate = () => {
        const units = [...rooms]
            .sort((x, y) => x.room_number.localeCompare(y.room_number, 'th', { numeric: true }))
            .map(r => ({
                room_number: r.room_number,
                category: UNIT_CATEGORY_LABELS[categoryOf(r, config?.building_type)],
                building_name: r.building_name, floor: r.floor, rent_amount: r.rent_amount, deposit_amount: r.deposit_amount,
                area_sqm: r.area_sqm,
                current_meter_elec: unitHasMeters(r, config?.building_type) ? r.current_meter_elec : null,
                current_meter_water: unitHasMeters(r, config?.building_type) ? r.current_meter_water : null,
            }));
        downloadXlsx(units.length ? 'HorCare-ข้อมูลยูนิต.xlsx' : 'HorCare-แบบฟอร์มนำเข้าข้อมูล.xlsx', importTemplateSheets(units));
    };

    return (
        <div>
            {showImport && onBulkCreate && (
                <ImportSheetModal
                    uid={uid}
                    buildingId={buildingId}
                    rooms={rooms}
                    remainingSlots={Math.max(0, maxRooms - rooms.length)}
                    unitName={terms.unitName}
                    onBulkCreate={onBulkCreate}
                    onUpdateRoom={onUpdateRoom}
                    onClose={() => setShowImport(false)}
                    onDone={r => { setShowImport(false); setImportResult(r); setTimeout(() => setImportResult(null), 9000); }}
                />
            )}
            {showBulk && onBulkCreate && onSaveConfig && (
                <BulkRoomModal
                    existingRooms={rooms}
                    config={config}
                    remainingSlots={Math.max(0, maxRooms - rooms.length)}
                    unitName={terms.unitName}
                    onCreate={onBulkCreate}
                    onSaveConfig={onSaveConfig}
                    onClose={() => setShowBulk(false)}
                />
            )}
            <div className="page-header">
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {terms.isMarket ? <Store size={28} color="#E8740C" /> : <Home size={28} />} {terms.manageUnitsLabel}
                    </h1>
                    <p className="page-subtitle">จัดการข้อมูล{terms.unitNamePlural} · อัตราค่าเช่า · มิเตอร์และค่าบริการ</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, flexWrap: 'wrap' }}>
                    {terms.isMarket && rooms.length === 0 && (
                        <button
                            className="btn btn-outline btn-sm"
                            onClick={async () => {
                                const demo = [
                                    'A01', 'A02', 'A03', 'A04', 'A05',
                                    'B01', 'B02', 'B03', 'B04', 'B05'
                                ];
                                for (const num of demo) {
                                    await onAddRoom(num);
                                }
                            }}
                            title="สร้างแผงตัวอย่างสำหรับเดโม่"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', borderColor: '#E8740C', color: '#C2410C', background: '#FDEBD3', fontWeight: 700 }}
                        >
                            <Sparkles size={15} /> สร้าง 10 แผงตัวอย่าง
                        </button>
                    )}
                    {onBulkCreate && onSaveConfig && (
                        <button
                            className="btn btn-primary btn-sm"
                            onClick={() => setShowBulk(true)}
                            disabled={atRoomLimit}
                            title={`สร้าง${terms.unitName}หลายรายการพร้อมกัน เช่น 101–120`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                        >
                            <Layers size={15} /> สร้างหลายรายการ
                        </button>
                    )}
                    <button
                        className="btn btn-outline btn-sm"
                        onClick={exportTemplate}
                        title={rooms.length ? `ดาวน์โหลดไฟล์ Excel ที่มี${terms.unitName}ทั้งหมด แก้แล้วนำเข้ากลับได้` : 'ดาวน์โหลดแบบฟอร์ม Excel สำหรับนำเข้าข้อมูล'}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                    >
                        <Download size={15} /> Template
                    </button>
                    {onBulkCreate && (
                        <button
                            className="btn btn-outline btn-sm"
                            onClick={() => setShowImport(true)}
                            title={`นำเข้า${terms.unitName}และผู้เช่าจากไฟล์ Excel / CSV รูปแบบไหนก็ได้`}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                        >
                            <Upload size={15} /> นำเข้า Excel
                        </button>
                    )}
                </div>
            </div>

            {/* Import result toast */}
            {importResult && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.625rem',
                    background: '#EFF8F2', border: '1px solid #A7DDBB',
                    color: '#166534', borderRadius: '10px',
                    padding: '0.625rem 0.875rem', fontSize: '0.8125rem',
                    fontWeight: 600, marginBottom: '0.75rem',
                }}>
                    <Check size={15} color="#15803D" />
                    <span style={{ flex: 1 }}>
                        {importResult.updated > 0 && `อัปเดต ${importResult.updated} ${terms.unitName}`}
                        {importResult.updated > 0 && importResult.created > 0 && ' · '}
                        {importResult.created > 0 && `สร้างใหม่ ${importResult.created} ${terms.unitName}`}
                        {importResult.tenants > 0 && ` · ข้อมูลผู้เช่า ${importResult.tenants} ราย`}
                        {importResult.updated === 0 && importResult.created === 0 && 'ไม่พบข้อมูลที่นำเข้าได้'}
                        {importResult.skipped.length > 0 && ` · ข้ามไป (ถึงลิมิต): ${importResult.skipped.join(', ')}`}
                    </span>
                    <button onClick={() => setImportResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Room limit banner — trial users only */}
            {isTrial && maxRooms !== Infinity && (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexWrap: 'wrap', gap: '0.75rem',
                    padding: '0.75rem 1rem', marginBottom: '1rem',
                    borderRadius: '12px',
                    background: atRoomLimit ? 'rgba(239,68,68,0.10)' : 'rgba(15, 76, 129,0.08)',
                    border: atRoomLimit ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(15, 76, 129,0.2)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Lock size={14} color={atRoomLimit ? '#F87171' : '#3D8FD6'} />
                        <span style={{ fontSize: '0.8125rem', color: atRoomLimit ? '#FCA5A5' : '#CFE2F6', fontWeight: 600 }}>
                            {atRoomLimit
                                ? `ถึงลิมิตทดลองใช้แล้ว (${rooms.length}/${maxRooms} ${terms.unitName})`
                                : `ทดลองใช้: ${rooms.length}/${maxRooms} ${terms.unitName}`
                            }
                        </span>
                    </div>
                    {atRoomLimit && onUpgrade && (
                        <button
                            onClick={onUpgrade}
                            style={{
                                background: 'linear-gradient(135deg,#0F4C81,#E8740C)',
                                border: 'none', borderRadius: '8px',
                                padding: '0.375rem 0.875rem',
                                color: '#fff', fontWeight: 700, fontSize: '0.78rem',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem',
                            }}
                        >
                            <Zap size={12} fill="currentColor" /> อัปเกรดเพื่อเพิ่ม{terms.unitName}ได้มากขึ้น
                        </button>
                    )}
                </div>
            )}

            {/* Add Room Form */}
            <div className="card mb-6">
                <div className="card-header">
                    <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Plus size={16} /> {terms.addUnitLabel}ใหม่</span>
                </div>
                {atRoomLimit ? (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.875rem 1rem',
                        background: 'rgba(239,68,68,0.07)', borderRadius: '10px',
                        border: '1px dashed rgba(239,68,68,0.25)',
                    }}>
                        <Lock size={16} color="#F87171" />
                        <span style={{ fontSize: '0.875rem', color: '#FCA5A5' }}>
                            ไม่สามารถเพิ่ม{terms.unitName}ได้ — แผนทดลองใช้รองรับสูงสุด {maxRooms} {terms.unitName}
                        </span>
                        {onUpgrade && (
                            <button
                                onClick={onUpgrade}
                                style={{
                                    marginLeft: 'auto', background: 'rgba(15, 76, 129,0.15)',
                                    border: '1px solid rgba(15, 76, 129,0.3)',
                                    borderRadius: '8px', padding: '0.375rem 0.75rem',
                                    color: '#CFE2F6', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                                }}
                            >
                                อัปเกรด
                            </button>
                        )}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
                        <input
                            type="text"
                            className="form-input mono"
                            style={{ maxWidth: '240px' }}
                            placeholder={terms.unitPlaceholder}
                            value={newRoomNumber}
                            onChange={e => setNewRoomNumber(e.target.value)}
                            onKeyDown={handleKeyDown}
                        />
                        <button
                            className="btn btn-primary"
                            onClick={handleAddRoom}
                            disabled={!newRoomNumber.trim()}
                        >
                            <Plus size={18} />
                            {terms.addUnitLabel}
                        </button>
                    </div>
                )}
            </div>

            {/* Board (status at a glance, book / cancel) or the full table (edit everything) */}
            {rooms.length > 0 && uid && buildingId && (
                <div role="tablist" aria-label="มุมมอง" className="seg" style={{ marginBottom: '0.75rem', alignSelf: 'flex-start', display: 'inline-flex' }}>
                    <button role="tab" aria-selected={layout === 'board'} className={`seg-item ${layout === 'board' ? 'active' : ''}`} onClick={() => setLayout('board')}>
                        <LayoutGrid size={14} /> ผัง{terms.unitName} · ว่าง / จอง
                    </button>
                    <button role="tab" aria-selected={layout === 'table'} className={`seg-item ${layout === 'table' ? 'active' : ''}`} onClick={() => setLayout('table')}>
                        <ClipboardList size={14} /> ตาราง · แก้ไขข้อมูล
                    </button>
                </div>
            )}
            {layout === 'board' && rooms.length > 0 && uid && buildingId ? (
                <StallBoard uid={uid} buildingId={buildingId} rooms={rooms} unitName={terms.unitName}
                    onEdit={room => startEdit(room)} />
            ) : (<>
            {/* Search & Filter bar */}
            <div className="card mb-4" style={{ padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    {/* Search */}
                    <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 0 }}>
                        <Search size={15} style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', pointerEvents: 'none' }} />
                        <input
                            type="text"
                            className="form-input"
                            style={{ paddingLeft: '2.1rem', width: '100%', height: '36px', fontSize: '0.875rem' }}
                            placeholder={`ค้นหา${terms.unitNumberLabel}...`}
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>
                    {/* Type filter */}
                    <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--color-gray-100,#EBF1F7)', borderRadius: '8px', padding: '0.2rem' }}>
                        {([['all', 'ทั้งหมด'], ['dormitory', terms.isMarket ? 'แผงทั่วไป' : 'หอพัก'], ['commercial', terms.isMarket ? 'พาณิชย์/พิเศษ' : 'พาณิชย์']] as const).map(([val, label]) => (
                            <button key={val} onClick={() => setFilterType(val)}
                                style={{
                                    padding: '0.25rem 0.625rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: filterType === val ? 700 : 500, border: 'none',
                                    background: filterType === val ? 'var(--color-primary,#0F4C81)' : 'none',
                                    color: filterType === val ? '#fff' : 'var(--color-text-muted)',
                                }}
                            >{label}</button>
                        ))}
                    </div>
                    {/* LINE filter */}
                    <div style={{ display: 'flex', gap: '0.25rem', background: 'var(--color-gray-100,#EBF1F7)', borderRadius: '8px', padding: '0.2rem' }}>
                        {([['all', 'LINE: ทั้งหมด'], ['linked', 'เชื่อมแล้ว'], ['unlinked', 'ยังไม่เชื่อม']] as const).map(([val, label]) => (
                            <button key={val} onClick={() => setFilterLine(val)}
                                style={{
                                    padding: '0.25rem 0.625rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: filterLine === val ? 700 : 500, border: 'none',
                                    background: filterLine === val ? '#06C755' : 'none',
                                    color: filterLine === val ? '#fff' : 'var(--color-text-muted)',
                                }}
                            >{label}</button>
                        ))}
                    </div>
                    {/* Clear */}
                    {isFiltering && (
                        <button onClick={() => { setSearchQuery(''); setFilterType('all'); setFilterLine('all'); setFilterCat('all'); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.625rem',
                                borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#F87171',
                            }}
                        >
                            <X size={12} /> ล้างตัวกรอง
                        </button>
                    )}
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
                        <Filter size={12} style={{ verticalAlign: 'middle', marginRight: '0.2rem' }} />
                        {filteredRooms.length}/{rooms.length} {terms.unitName}
                    </span>
                </div>
                {mixed && (
                    <div className="unit-cat-filter" role="group" aria-label="หมวดหมู่">
                        <button type="button" className={filterCat === 'all' ? 'is-on' : ''} onClick={() => setFilterCat('all')}>
                            ทุกหมวดหมู่ <span>{rooms.length}</span>
                        </button>
                        {cats.map(c => (
                            <button key={c} type="button" className={filterCat === c ? 'is-on' : ''} onClick={() => setFilterCat(c)}>
                                {UNIT_CATEGORY_LABELS[c]} <span>{catCount(c)}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {offCycle.length > 0 && (
                <div className="card" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', background: '#FEF6EC', borderColor: '#F7B86C' }}>
                    <span style={{ flex: 1, minWidth: 220, fontSize: '0.875rem' }}>
                        มี {offCycle.length} {terms.unitName}ที่ยังตั้งเป็น "{rentTypeLabel('monthly', config?.building_type)}" — {terms.isMarket ? 'ตลาดนี้เก็บเงินรายวัน/รายสัปดาห์' : 'ที่นี่เก็บเงินต่อคืน'}
                    </span>
                    <button className="btn btn-primary btn-sm" onClick={() => void setRentTypeFor(offCycle.map(r => r.id), wantedRentType)}>
                        เปลี่ยนทั้งหมดเป็น "{rentTypeLabel(wantedRentType, config?.building_type)}"
                    </button>
                </div>
            )}

            {/* Room List */}
            <div className="card">
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <ClipboardList size={18} /> รายการ{terms.unitNamePlural}ทั้งหมด ({rooms.length} {terms.unitName}{isFiltering ? ` — แสดง ${filteredRooms.length}` : ''})
                    </span>
                    {selectedRooms.size > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                                เลือก {selectedRooms.size} {terms.unitName}
                            </span>
                            <select className="form-input" style={{ width: 'auto', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }} value="" aria-label="เปลี่ยนรูปแบบการเก็บเงิน"
                                onChange={e => { if (e.target.value) void setRentTypeFor([...selectedRooms], e.target.value as Room['rent_type']); }}>
                                <option value="">เปลี่ยนรูปแบบเก็บเงิน…</option>
                                {rentTypeOptions(config?.building_type).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                            <button
                                className="btn btn-sm"
                                onClick={() => setShowBulkDeleteConfirm(true)}
                                style={{
                                    background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                                    color: '#F87171', borderRadius: '8px', padding: '0.35rem 0.75rem',
                                    fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                                }}
                            >
                                <Trash2 size={14} /> ลบที่เลือก
                            </button>
                            <button
                                className="btn btn-sm"
                                onClick={() => setSelectedRooms(new Set())}
                                style={{
                                    background: 'var(--color-gray-100)', border: '1px solid var(--color-gray-200)',
                                    color: 'var(--color-gray-500)', borderRadius: '8px', padding: '0.35rem 0.75rem',
                                    fontSize: '0.8rem', cursor: 'pointer',
                                }}
                            >
                                ยกเลิก
                            </button>
                        </div>
                    )}
                </div>

                {rooms.length === 0 ? (
                    <div className="empty-state">
                        {terms.isMarket ? <Store size={48} color="#E8740C" /> : <Home size={48} />}
                        <h3>ยังไม่มี{terms.unitNamePlural}</h3>
                        <p>เพิ่ม{terms.unitNamePlural}ด้านบนเพื่อเริ่มต้นใช้งาน{terms.isMarket ? ' หรือกดปุ่ม "สร้าง 10 แผงตัวอย่าง" ด้านบนเพื่อเดโม่ได้ทันที' : ''}</p>
                    </div>
                ) : filteredRooms.length === 0 ? (
                    <div className="empty-state">
                        <Search size={40} />
                        <h3>ไม่พบ{terms.unitName}ที่ตรงกับการค้นหา</h3>
                        <p>ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง</p>
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th style={{ width: '40px', textAlign: 'center' }}>
                                        <button
                                            onClick={toggleSelectAll}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: isAllSelected ? '#3D8FD6' : 'var(--color-gray-400)', display: 'flex', alignItems: 'center', margin: '0 auto' }}
                                            title={isAllSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                                        >
                                            {isAllSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                        </button>
                                    </th>
                                    <th style={{ width: '50px' }}>#</th>
                                    <th>{terms.unitNumberLabel}</th>
                                    <th className="text-center">{terms.isMarket ? 'โซน / แผงค้า' : 'ประเภทห้อง'}</th>
                                    <th className="text-center">{terms.tenantLabel}</th>
                                    <th className="text-right">{terms.rentLabel}</th>
                                    <th className="text-center">การชำระ</th>
                                    {terms.usesMeters && <th className="text-right">{terms.isMarket ? 'ไฟแผง (หน่วย)' : 'มิเตอร์ไฟ'}</th>}
                                    {terms.usesMeters && <th className="text-right">{terms.isMarket ? 'น้ำ (หน่วย)' : 'มิเตอร์น้ำ'}</th>}
                                    {hasAnyCommercial && <th className="text-center">ค่าน้ำ/ไฟ</th>}
                                    <th className="text-center" style={{ width: '180px' }}>จัดการ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRooms.map((room, index) => (
                                    <tr
                                        key={room.id}
                                        className="room-row-clickable"
                                        onClick={() => startEdit(room)}
                                        title={`กดเพื่อแก้ไข${terms.unitName} ${room.room_number}`}
                                        style={selectedRooms.has(room.id) ? { background: 'rgba(61, 143, 214,0.06)' } : undefined}
                                    >
                                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                                            <button
                                                onClick={() => toggleSelect(room.id)}
                                                aria-label={selectedRooms.has(room.id) ? 'ยกเลิกเลือก' : 'เลือก'}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: selectedRooms.has(room.id) ? '#3D8FD6' : 'var(--color-gray-300)', display: 'flex', alignItems: 'center', margin: '0 auto' }}
                                            >
                                                {selectedRooms.has(room.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                                            </button>
                                        </td>
                                        <td className="text-muted">{index + 1}</td>
                                        <td>
                                            <div className="flex items-center gap-2">
                                                <span className="mono font-bold">{room.room_number}</span>
                                                {mixed && <span className="unit-cat-badge">{UNIT_CATEGORY_LABELS[categoryOf(room, config?.building_type)]}</span>}
                                                {room.language ? (
                                                    <span
                                                        title={`ภาษารับบิล: ${LANGUAGE_MAP[room.language]?.nativeName} (${LANGUAGE_MAP[room.language]?.name})`}
                                                        style={{ fontSize: '1rem', cursor: 'help' }}
                                                    >
                                                        {LANGUAGE_MAP[room.language]?.flag}
                                                    </span>
                                                ) : null}
                                                {room.line_user_id && (
                                                    <span title="เชื่อมต่อ LINE แล้ว" style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                        <MessageCircle size={14} color="#06C755" />
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="text-center">
                                            {terms.isMarket ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                                    <span className="badge" style={{ fontSize: '0.75rem', background: '#FDEBD3', color: '#C2410C', border: '1px solid #FBD9A8' }}>
                                                        <Store size={11} style={{ marginRight: 3 }} /> {room.zone || 'แผงทั่วไป'}
                                                    </span>
                                                    {room.business_type && (
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                                                            {room.business_type}
                                                        </span>
                                                    )}
                                                    {room.stall_size && (
                                                        <span style={{ fontSize: '0.68rem', color: '#8FA3B8' }}>
                                                            ขนาด {room.stall_size}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className={`badge ${(room.room_type || 'dormitory') === 'commercial' ? 'badge-info' : 'badge-success'}`} style={{ fontSize: '0.75rem' }}>
                                                    {(room.room_type || 'dormitory') === 'commercial' ? (
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Building2 size={12} /> พาณิชย์</span>
                                                    ) : (
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><Home size={12} /> หอพัก</span>
                                                    )}
                                                </span>
                                            )}
                                        </td>
                                        <td className="text-center">
                                            <span className="mono">{room.tenant_count || 1} {terms.isMarket ? 'ร้าน' : 'คน'}</span>
                                        </td>
                                        <td className="text-right">
                                            <span className="mono">{formatCurrency(room.rent_amount)}</span>
                                        </td>
                                        <td className="text-center">
                                            <span className={`badge ${room.rent_type === 'semester' || room.rent_type === 'yearly' ? 'badge-warning' : room.rent_type === 'daily' || room.rent_type === 'weekly' ? 'badge-info' : 'badge-success'}`}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>{room.rent_type === 'semester' || room.rent_type === 'yearly' ? <CalendarDays size={12} /> : <CalendarCheck size={12} />} {rentTypeLabel(room.rent_type, config?.building_type)}</span>
                                            </span>
                                        </td>
                                        {terms.usesMeters && <td className="text-right mono">{unitHasMeters(room, config?.building_type) ? room.current_meter_elec.toLocaleString() : <span className="text-muted" title="ไม่มีมิเตอร์">—</span>}</td>}
                                        {terms.usesMeters && <td className="text-right mono">{unitHasMeters(room, config?.building_type) ? room.current_meter_water.toLocaleString() : <span className="text-muted" title="ไม่มีมิเตอร์">—</span>}</td>}
                                        {hasAnyCommercial && (
                                            <td className="text-center" style={{ fontSize: '0.75rem' }}>
                                                {(room.room_type || 'dormitory') === 'commercial' ? (
                                                    <div>
                                                        {room.custom_electricity_rate && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Zap size={12} color="#E8740C" /> {room.custom_electricity_rate} บ./หน่วย</div>
                                                        )}
                                                        {room.custom_water_config?.unit_rate && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Droplets size={12} color="#0A6CC2" /> {room.custom_water_config.unit_rate} บ./หน่วย</div>
                                                        )}
                                                        {!room.custom_electricity_rate && !room.custom_water_config && (
                                                            <span className="text-muted">ค่าเริ่มต้น</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-muted">—</span>
                                                )}
                                            </td>
                                        )}
                                        <td className="text-center" onClick={e => e.stopPropagation()}>
                                            {showDeleteConfirm === room.id ? (
                                                <div className="delete-confirm-actions">
                                                    <button className="btn btn-danger btn-sm" onClick={() => confirmDelete(room.id)}>
                                                        ยืนยัน
                                                    </button>
                                                    <button className="btn btn-secondary btn-sm" onClick={() => setShowDeleteConfirm(null)}>
                                                        ยกเลิก
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex gap-2 justify-center">
                                                    <button
                                                        className="btn btn-outline btn-sm btn-icon"
                                                        onClick={() => uid && buildingId && setTenantRoomId(room.id)}
                                                        title="ข้อมูลผู้เช่า"
                                                        style={{ color: 'var(--color-primary)' }}
                                                    >
                                                        <UserCheck size={16} />
                                                    </button>
                                                    <button
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => startEdit(room)}
                                                        title="แก้ไข"
                                                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                                                    >
                                                        <Edit2 size={14} /> แก้ไข
                                                    </button>
                                                    <button
                                                        className="btn btn-outline btn-sm btn-icon"
                                                        onClick={() => setShowDeleteConfirm(room.id)}
                                                        title="ลบ"
                                                        style={{ color: 'var(--color-danger)' }}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            </>)}

            {/* Bulk Delete Confirm Modal */}
            {showBulkDeleteConfirm && (
                <>
                    <div
                        onClick={() => setShowBulkDeleteConfirm(false)}
                        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, backdropFilter: 'blur(4px)' }}
                    />
                    <div style={{
                        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                        zIndex: 301, background: 'var(--color-white)',
                        border: '1px solid rgba(239,68,68,0.3)', borderRadius: '16px',
                        padding: '1.75rem', width: 'min(380px, 92vw)',
                        boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Trash2 size={18} color="#F87171" />
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--color-gray-900)' }}>ยืนยันการลบ</div>
                                <div style={{ fontSize: '0.8125rem', color: 'var(--color-gray-500)', marginTop: '0.125rem' }}>
                                    ลบ {selectedRooms.size} ห้องที่เลือก — ไม่สามารถย้อนกลับได้
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.625rem', marginTop: '1.25rem' }}>
                            <button
                                onClick={() => setShowBulkDeleteConfirm(false)}
                                style={{
                                    flex: 1, padding: '0.7rem', borderRadius: '10px', cursor: 'pointer',
                                    background: 'var(--color-gray-100)', border: '1px solid var(--color-gray-200)',
                                    color: 'var(--color-gray-600)', fontWeight: 600, fontSize: '0.9rem',
                                }}
                            >
                                ยกเลิก
                            </button>
                            <button
                                onClick={handleBulkDelete}
                                style={{
                                    flex: 2, padding: '0.7rem', borderRadius: '10px', border: 'none', cursor: 'pointer',
                                    background: 'linear-gradient(135deg,#DC2626,#EF4444)',
                                    color: '#fff', fontWeight: 700, fontSize: '0.9rem',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                    boxShadow: '0 4px 16px rgba(220,38,38,0.4)',
                                }}
                            >
                                <Trash2 size={15} /> ลบ {selectedRooms.size} ห้อง
                            </button>
                        </div>
                    </div>
                </>
            )}

            {/* Edit popup — the whole room on one sheet */}
            {editingRoom && (() => {
                const room = rooms.find(r => r.id === editingRoom);
                if (!room) return null;
                return (
                    <RoomEditModal
                        key={room.id}
                        room={room}
                        rooms={rooms}
                        config={config}
                        commonFees={commonFees}
                        onSave={onUpdateRoom}
                        onUnlinkLine={id => onUpdateRoom(id, { line_user_id: '' })}
                        onClose={() => setEditingRoom(null)}
                    />
                );
            })()}

            {/* Tenant Profile Modal */}
            {tenantRoomId && uid && buildingId && (() => {
                const room = rooms.find(r => r.id === tenantRoomId);
                if (!room) return null;
                return (
                    <TenantProfilePage
                        room={room}
                        uid={uid}
                        buildingId={buildingId}
                        isPaid={isPaid}
                        onUpgrade={onUpgrade}
                        onClose={() => setTenantRoomId(null)}
                        config={config}
                    />
                );
            })()}
        </div>
    );
}
