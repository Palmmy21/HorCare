import { useState, useRef, Fragment } from 'react';
import { Plus, Trash2, Edit2, Check, X, Home, Zap, Droplets, Building2, Store, ClipboardList, CalendarDays, CalendarCheck, MessageCircle, Link2Off, Lock, CheckSquare, Square, UserCheck, Search, Filter, Download, Upload, Globe, Sparkles, Layers } from 'lucide-react';
import type { Room, DormConfig, CommonFee, BillLanguage } from '../../types';
import BulkRoomModal from './BulkRoomModal';
import { BUILTIN_AMENITIES, amenityLabel } from '../../utils/amenities';
import { formatCurrency } from '../../utils/calculations';
import { LANGUAGE_OPTIONS, LANGUAGE_MAP } from '../../utils/i18n/billTranslations';
import { defaultRentType, getWorkspaceTerms, rentTypeLabel, rentTypeOptions } from '../../utils/workspaceTerminology';
import TenantProfilePage from '../TenantProfile/TenantProfilePage';

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
    const [newRoomNumber, setNewRoomNumber] = useState('');
    const [editingRoom, setEditingRoom] = useState<string | null>(null);
    const [importResult, setImportResult] = useState<{ updated: number; created: number; skipped: string[] } | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [editValue, setEditValue] = useState('');
    const [editRentAmount, setEditRentAmount] = useState('');
    const [editRentType, setEditRentType] = useState<Room['rent_type']>('monthly');
    const [editRoomType, setEditRoomType] = useState<'dormitory' | 'commercial'>('dormitory');
    const [editTenantCount, setEditTenantCount] = useState<string>('1');
    const [editZone, setEditZone] = useState('');
    const [editStallSize, setEditStallSize] = useState('');
    const [editBusinessType, setEditBusinessType] = useState('');
    const [editCustomElecRate, setEditCustomElecRate] = useState('');
    const [editCustomWaterRate, setEditCustomWaterRate] = useState('');
    const [editCommonFeeOverrides, setEditCommonFeeOverrides] = useState<Record<string, { amount?: number; is_active?: boolean }>>({});
    const [editLanguage, setEditLanguage] = useState<BillLanguage | ''>('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
    const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
    const [tenantRoomId, setTenantRoomId] = useState<string | null>(null);
    const [showBulk, setShowBulk] = useState(false);
    const [editAmenities, setEditAmenities] = useState<string[]>([]);

    // ── Search & Filter state ───────────────────────────────────────────────────
    const [searchQuery, setSearchQuery] = useState('');
    const [filterType, setFilterType] = useState<'all' | 'dormitory' | 'commercial'>('all');
    const [filterLine, setFilterLine] = useState<'all' | 'linked' | 'unlinked'>('all');

    const filteredRooms = rooms.filter(r => {
        const matchSearch = searchQuery === '' || r.room_number.toLowerCase().includes(searchQuery.toLowerCase());
        const matchType = filterType === 'all' || (r.room_type || 'dormitory') === filterType;
        const matchLine = filterLine === 'all'
            ? true
            : filterLine === 'linked' ? !!r.line_user_id : !r.line_user_id;
        return matchSearch && matchType && matchLine;
    });
    const isFiltering = searchQuery !== '' || filterType !== 'all' || filterLine !== 'all';

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

    const startEdit = (room: Room) => {
        setEditingRoom(room.id);
        setEditValue(room.room_number);
        setEditRentAmount(room.rent_amount.toString());
        setEditRentType(room.rent_type || 'monthly');
        setEditRoomType(room.room_type || 'dormitory');
        setEditTenantCount((room.tenant_count || 1).toString());
        setEditZone(room.zone || '');
        setEditStallSize(room.stall_size || '');
        setEditBusinessType(room.business_type || '');
        setEditCustomElecRate(room.custom_electricity_rate?.toString() || '');
        setEditCustomWaterRate(
            room.custom_water_config
                ? (room.custom_water_config.type === 'normal'
                    ? (room.custom_water_config.unit_rate || 0).toString()
                    : '')
                : ''
        );
        setEditCommonFeeOverrides(room.common_fee_overrides || {});
        setEditLanguage(room.language || '');
        setEditAmenities(room.amenities || []);
    };

    const saveEdit = async (roomId: string) => {
        if (!editValue.trim()) return;
        const updates: Partial<Room> = {
            room_number: editValue.trim(),
            rent_amount: Number(editRentAmount) || 0,
            rent_type: editRentType,
            room_type: editRoomType,
            tenant_count: Number(editTenantCount) || 1,
            zone: editZone.trim() || undefined,
            stall_size: editStallSize.trim() || undefined,
            business_type: editBusinessType.trim() || undefined,
        };
        
        if (editCustomElecRate.trim() && !isNaN(Number(editCustomElecRate))) {
            updates.custom_electricity_rate = Number(editCustomElecRate);
        } else {
            updates.custom_electricity_rate = null;
        }

        if (editCustomWaterRate.trim() && !isNaN(Number(editCustomWaterRate))) {
            updates.custom_water_config = {
                type: 'normal',
                unit_rate: Number(editCustomWaterRate)
            };
        } else {
            updates.custom_water_config = null;
        }

        updates.common_fee_overrides = editCommonFeeOverrides;
        updates.language = editLanguage ? (editLanguage as BillLanguage) : undefined;
        updates.amenities = editAmenities;

        try {
            await onUpdateRoom(roomId, updates);
            setEditingRoom(null);
        } catch (error) {
            console.error('Error updating room:', error);
            alert('โอนข้อมูลไม่สำเร็จ กรุณาลองใหม่');
        }
    };

    const cancelEdit = () => {
        setEditingRoom(null);
        setEditValue('');
        setEditRentAmount('');
        setEditRentType('monthly');
        setEditRoomType('dormitory');
        setEditTenantCount('1');
        setEditZone('');
        setEditStallSize('');
        setEditBusinessType('');
        setEditCustomElecRate('');
        setEditCustomWaterRate('');
        setEditLanguage('');
    };

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

    // ── CSV export template ────────────────────────────────────────────────────
    const exportTemplate = () => {
        const header = ['ห้อง', 'ค่าเช่า', 'จำนวนผู้เช่า', 'ประเภทห้อง', 'ประเภทค่าเช่า', 'มิเตอร์ไฟเริ่มต้น', 'มิเตอร์น้ำเริ่มต้น'];
        const dataRows = rooms.map(r => [
            r.room_number,
            r.rent_amount,
            r.tenant_count ?? 1,
            r.room_type === 'commercial' ? 'commercial' : 'dormitory',
            r.rent_type === 'semester' ? 'semester' : 'monthly',
            r.current_meter_elec ?? 0,
            r.current_meter_water ?? 0,
        ]);
        // Append a blank example row if no rooms exist yet
        if (dataRows.length === 0) dataRows.push(['101', config.room_rent, 1, 'dormitory', 'monthly', 0, 0]);
        const csv = [header, ...dataRows]
            .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'rooms_template.csv';
        a.click();
    };

    // ── CSV import ─────────────────────────────────────────────────────────────
    const handleImportFile = async (file: File) => {
        const text = await file.text();
        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return;

        const parseRow = (line: string) =>
            line.split(',').map(c => c.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"'));

        const ALIASES: Record<string, string> = {
            'ห้อง': 'room', 'room': 'room', 'room_number': 'room', 'เลขห้อง': 'room',
            'ค่าเช่า': 'rent', 'rent_amount': 'rent', 'rent': 'rent',
            'จำนวนผู้เช่า': 'tenants', 'tenant_count': 'tenants', 'tenants': 'tenants',
            'ประเภทห้อง': 'type', 'room_type': 'type', 'type': 'type',
            'ประเภทค่าเช่า': 'renttype', 'rent_type': 'renttype', 'renttype': 'renttype',
            'มิเตอร์ไฟเริ่มต้น': 'elec', 'current_meter_elec': 'elec', 'elec': 'elec',
            'มิเตอร์น้ำเริ่มต้น': 'water', 'current_meter_water': 'water', 'water': 'water',
        };

        const headers = parseRow(lines[0]).map(h => h.toLowerCase().trim());
        const col: Record<string, number> = {};
        headers.forEach((h, i) => {
            const key = ALIASES[h] ?? ALIASES[h.replace(/\s+/g, '')] ?? null;
            if (key && !(key in col)) col[key] = i;
        });
        if (!('room' in col)) { col.room = 0; col.rent = 1; col.tenants = 2; col.type = 3; col.renttype = 4; col.elec = 5; col.water = 6; }

        const roomMap = new Map(rooms.map(r => [r.room_number, r]));
        const get = (cols: string[], key: string) => col[key] !== undefined ? (cols[col[key]] ?? '').trim() : '';

        let updated = 0, created = 0;
        const skipped: string[] = [];
        const promises: Promise<void>[] = [];

        for (let i = 1; i < lines.length; i++) {
            const cols = parseRow(lines[i]);
            const roomNum = get(cols, 'room');
            if (!roomNum) continue;

            const existing = roomMap.get(roomNum);
            const rentVal = get(cols, 'rent');
            const tenantsVal = get(cols, 'tenants');
            const typeVal = get(cols, 'type').toLowerCase();
            const rentTypeVal = get(cols, 'renttype').toLowerCase();
            const elecVal = get(cols, 'elec');
            const waterVal = get(cols, 'water');

            const updates: Partial<Room> = {};
            if (rentVal) updates.rent_amount = Number(rentVal) || 0;
            if (tenantsVal) updates.tenant_count = Math.max(1, Number(tenantsVal) || 1);
            if (typeVal === 'commercial') updates.room_type = 'commercial';
            else if (typeVal === 'dormitory') updates.room_type = 'dormitory';
            if (rentTypeVal === 'semester') updates.rent_type = 'semester';
            else if (rentTypeVal === 'monthly') updates.rent_type = 'monthly';
            if (elecVal) updates.current_meter_elec = Number(elecVal) || 0;
            if (waterVal) updates.current_meter_water = Number(waterVal) || 0;

            if (existing) {
                promises.push(onUpdateRoom(existing.id, updates).then(() => { updated++; }));
            } else {
                if (atRoomLimit) { skipped.push(roomNum); continue; }
                onAddRoom(roomNum);
                created++;
            }
        }

        await Promise.all(promises);
        setImportResult({ updated, created, skipped });
        setTimeout(() => setImportResult(null), 7000);
    };

    return (
        <div>
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
                        title="ดาวน์โหลด Template CSV"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                    >
                        <Download size={15} /> Template
                    </button>
                    <button
                        className="btn btn-outline btn-sm"
                        onClick={() => fileInputRef.current?.click()}
                        title={`นำเข้าข้อมูล${terms.unitName}จาก CSV`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
                    >
                        <Upload size={15} /> นำเข้า CSV
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        style={{ display: 'none' }}
                        onChange={e => {
                            const f = e.target.files?.[0];
                            if (f) { handleImportFile(f); e.target.value = ''; }
                        }}
                    />
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
                        <button onClick={() => { setSearchQuery(''); setFilterType('all'); setFilterLine('all'); }}
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
                                    <Fragment key={room.id}>
                                    <tr style={selectedRooms.has(room.id) ? { background: 'rgba(61, 143, 214,0.06)' } : undefined}>
                                        <td style={{ textAlign: 'center' }}>
                                            <button
                                                onClick={() => editingRoom !== room.id && toggleSelect(room.id)}
                                                disabled={editingRoom === room.id}
                                                style={{ background: 'none', border: 'none', cursor: editingRoom === room.id ? 'default' : 'pointer', color: selectedRooms.has(room.id) ? '#3D8FD6' : 'var(--color-gray-300)', display: 'flex', alignItems: 'center', margin: '0 auto', opacity: editingRoom === room.id ? 0.3 : 1 }}
                                            >
                                                {selectedRooms.has(room.id) ? <CheckSquare size={16} /> : <Square size={16} />}
                                            </button>
                                        </td>
                                        <td className="text-muted">{index + 1}</td>
                                        <td>
                                            {editingRoom === room.id ? (
                                                <div className="edit-room-form">
                                                    <input
                                                        type="text"
                                                        className="form-input mono edit-room-input"
                                                        value={editValue}
                                                        onChange={e => setEditValue(e.target.value)}
                                                        autoFocus
                                                        placeholder={terms.unitNumberLabel}
                                                    />
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <span className="mono font-bold">{room.room_number}</span>
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
                                            )}
                                        </td>
                                        <td className="text-center">
                                            {editingRoom === room.id ? (
                                                terms.isMarket ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: '140px' }}>
                                                        <input
                                                            type="text"
                                                            className="form-input"
                                                            style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem' }}
                                                            placeholder="โซน เช่น โซน A"
                                                            value={editZone}
                                                            onChange={e => setEditZone(e.target.value)}
                                                        />
                                                        <input
                                                            type="text"
                                                            className="form-input"
                                                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                                                            placeholder="ขนาด เช่น 2x2 ม."
                                                            value={editStallSize}
                                                            onChange={e => setEditStallSize(e.target.value)}
                                                        />
                                                        <input
                                                            type="text"
                                                            className="form-input"
                                                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                                                            placeholder="ชื่อร้าน/สินค้า"
                                                            value={editBusinessType}
                                                            onChange={e => setEditBusinessType(e.target.value)}
                                                        />
                                                    </div>
                                                ) : (
                                                    <select
                                                        className="form-input"
                                                        style={{ width: '130px', fontSize: '0.8125rem' }}
                                                        value={editRoomType}
                                                        onChange={e => setEditRoomType(e.target.value as 'dormitory' | 'commercial')}
                                                    >
                                                        <option value="dormitory">หอพัก</option>
                                                        <option value="commercial">พาณิชย์</option>
                                                    </select>
                                                )
                                            ) : terms.isMarket ? (
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
                                            {editingRoom === room.id ? (
                                                <input
                                                    type="number"
                                                    min="1"
                                                    className="form-input mono text-center"
                                                    style={{ width: '60px' }}
                                                    value={editTenantCount}
                                                    onChange={e => setEditTenantCount(e.target.value)}
                                                />
                                            ) : (
                                                <span className="mono">{room.tenant_count || 1} {terms.isMarket ? 'ร้าน' : 'คน'}</span>
                                            )}
                                        </td>
                                        <td className="text-right">
                                            {editingRoom === room.id ? (
                                                <input
                                                    type="number"
                                                    className="form-input mono"
                                                    style={{ width: '120px', textAlign: 'right' }}
                                                    value={editRentAmount}
                                                    onChange={e => setEditRentAmount(e.target.value)}
                                                    placeholder="0"
                                                />
                                            ) : (
                                                <span className="mono">{formatCurrency(room.rent_amount)}</span>
                                            )}
                                        </td>
                                        <td className="text-center">
                                            {editingRoom === room.id ? (
                                                <select
                                                    className="form-input"
                                                    style={{ width: '130px' }}
                                                    value={editRentType}
                                                    onChange={e => setEditRentType(e.target.value as Room['rent_type'])}
                                                >
                                                    {rentTypeOptions(config?.building_type).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                </select>
                                            ) : (
                                                <span className={`badge ${room.rent_type === 'semester' || room.rent_type === 'yearly' ? 'badge-warning' : room.rent_type === 'daily' || room.rent_type === 'weekly' ? 'badge-info' : 'badge-success'}`}>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>{room.rent_type === 'semester' || room.rent_type === 'yearly' ? <CalendarDays size={12} /> : <CalendarCheck size={12} />} {rentTypeLabel(room.rent_type, config?.building_type)}</span>
                                                </span>
                                            )}
                                        </td>
                                        {terms.usesMeters && <td className="text-right mono">{room.current_meter_elec.toLocaleString()}</td>}
                                        {terms.usesMeters && <td className="text-right mono">{room.current_meter_water.toLocaleString()}</td>}
                                        {hasAnyCommercial && (
                                            <td className="text-center" style={{ fontSize: '0.75rem' }}>
                                                {(room.room_type || 'dormitory') === 'commercial' ? (
                                                    editingRoom === room.id ? (
                                                        editRoomType === 'commercial' ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                                    <Zap size={12} color="#F59E2E" />
                                                                    <input
                                                                        type="number"
                                                                        className="form-input mono"
                                                                        style={{ width: '80px', textAlign: 'right', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                                                        value={editCustomElecRate}
                                                                        onChange={e => setEditCustomElecRate(e.target.value)}
                                                                        placeholder={config.electricity_rate.toString()}
                                                                    />
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                                    <Droplets size={12} color="#0A6CC2" />
                                                                    <input
                                                                        type="number"
                                                                        className="form-input mono"
                                                                        style={{ width: '80px', textAlign: 'right', padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                                                        value={editCustomWaterRate}
                                                                        onChange={e => setEditCustomWaterRate(e.target.value)}
                                                                        placeholder="ค่าเริ่มต้น"
                                                                    />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <span className="text-muted">—</span>
                                                        )
                                                    ) : (
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
                                                    )
                                                ) : (
                                                    <span className="text-muted">—</span>
                                                )}
                                            </td>
                                        )}
                                        <td className="text-center">
                                            {editingRoom === room.id ? (
                                                <div className="delete-confirm-actions">
                                                    <button
                                                        className="btn btn-success btn-sm"
                                                        onClick={() => saveEdit(room.id)}
                                                    >
                                                        <Check size={16} />
                                                        บันทึก
                                                    </button>
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={cancelEdit}
                                                    >
                                                        <X size={16} />
                                                        ยกเลิก
                                                    </button>
                                                    {room.line_user_id && (
                                                        <button
                                                            className="btn btn-outline btn-sm"
                                                            style={{ color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }}
                                                            onClick={() => {
                                                                if(confirm('ต้องการยกเลิกการเชื่อมต่อ LINE สำหรับห้องนี้หรือไม่?')) {
                                                                    onUpdateRoom(room.id, { line_user_id: '' });
                                                                    setEditingRoom(null);
                                                                }
                                                            }}
                                                            title="ยกเลิกการเชื่อมต่อ LINE"
                                                        >
                                                            <Link2Off size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            ) : showDeleteConfirm === room.id ? (
                                                <div className="delete-confirm-actions">
                                                    <button
                                                        className="btn btn-danger btn-sm"
                                                        onClick={() => confirmDelete(room.id)}
                                                    >
                                                        ยืนยัน
                                                    </button>
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={() => setShowDeleteConfirm(null)}
                                                    >
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
                                                        className="btn btn-outline btn-sm btn-icon"
                                                        onClick={() => startEdit(room)}
                                                        title="แก้ไข"
                                                    >
                                                        <Edit2 size={16} />
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
                                    {editingRoom === room.id && (
                                        <tr key={`${room.id}-lang`} style={{ background: 'rgba(61, 143, 214,0.06)' }}>
                                            <td colSpan={(hasAnyCommercial ? 11 : 10) - (terms.usesMeters ? 0 : 2)} style={{ padding: '0.5rem 2rem 0.5rem', borderTop: 'none' }}>
                                                <div style={{ background: 'var(--color-bg)', padding: '0.625rem 1rem', borderRadius: '12px', border: '1px solid var(--color-gray-200)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                                    <span style={{ fontWeight: 600, fontSize: '0.8125rem', color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                                        <Globe size={14} color="#0A6CC2" /> ภาษาบิล/แจ้งเตือนห้องนี้:
                                                    </span>
                                                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditLanguage('')}
                                                            className="btn btn-sm"
                                                            style={{
                                                                background: editLanguage === '' ? '#0A6CC2' : 'var(--color-gray-100)',
                                                                color: editLanguage === '' ? '#ffffff' : 'var(--color-gray-700)',
                                                                border: '1px solid var(--color-gray-300)',
                                                                borderRadius: '6px',
                                                                fontSize: '0.75rem',
                                                                padding: '0.2rem 0.5rem'
                                                            }}
                                                        >
                                                            ค่าเริ่มต้น ({LANGUAGE_MAP[config.bill_customization?.default_language || 'th']?.flag} {LANGUAGE_MAP[config.bill_customization?.default_language || 'th']?.nativeName})
                                                        </button>
                                                        {LANGUAGE_OPTIONS.map(opt => (
                                                            <button
                                                                key={opt.code}
                                                                type="button"
                                                                onClick={() => setEditLanguage(opt.code)}
                                                                className="btn btn-sm"
                                                                style={{
                                                                    background: editLanguage === opt.code ? '#0A6CC2' : 'var(--color-gray-100)',
                                                                    color: editLanguage === opt.code ? '#ffffff' : 'var(--color-gray-700)',
                                                                    border: '1px solid var(--color-gray-300)',
                                                                    borderRadius: '6px',
                                                                    fontSize: '0.75rem',
                                                                    padding: '0.2rem 0.5rem',
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: '3px'
                                                                }}
                                                            >
                                                                <span>{opt.flag}</span>
                                                                <span>{opt.nativeName}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    {editingRoom === room.id && (
                                        <tr key={`${room.id}-amenities`} style={{ background: 'rgba(61, 143, 214,0.06)' }}>
                                            <td colSpan={(hasAnyCommercial ? 11 : 10) - (terms.usesMeters ? 0 : 2)} style={{ padding: '0.5rem 2rem', borderTop: 'none' }}>
                                                <div style={{ background: 'var(--color-bg)', padding: '0.625rem 1rem', borderRadius: '12px', border: '1px solid var(--color-gray-200)' }}>
                                                    <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '0.5rem' }}>สิ่งอำนวยความสะดวก</div>
                                                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                                        {[...BUILTIN_AMENITIES.map(a => a.id), ...(config.custom_amenities ?? []),
                                                          ...editAmenities.filter(a => !BUILTIN_AMENITIES.some(b => b.id === a) && !(config.custom_amenities ?? []).includes(a))
                                                        ].map(key => {
                                                            const on = editAmenities.includes(key);
                                                            return (
                                                                <button
                                                                    key={key} type="button" aria-pressed={on}
                                                                    onClick={() => setEditAmenities(prev => on ? prev.filter(x => x !== key) : [...prev, key])}
                                                                    className="btn btn-sm"
                                                                    style={{
                                                                        background: on ? '#0A6CC2' : 'var(--color-gray-100)',
                                                                        color: on ? '#fff' : 'var(--color-gray-700)',
                                                                        border: '1px solid var(--color-gray-300)', borderRadius: '6px',
                                                                        fontSize: '0.75rem', padding: '0.2rem 0.5rem',
                                                                    }}
                                                                >{amenityLabel(key)}</button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    {editingRoom === room.id && commonFees.length > 0 && (
                                        <tr key={`${room.id}-fees`} style={{ background: 'rgba(61, 143, 214,0.06)' }}>
                                            <td colSpan={(hasAnyCommercial ? 10 : 9) - (terms.usesMeters ? 0 : 2)} style={{ padding: '0.75rem 2rem', borderTop: 'none' }}>
                                                <div style={{ background: 'var(--color-bg)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--color-gray-200)' }}>
                                                    <div style={{ fontWeight: 600, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <Building2 size={16} color="#0A6CC2" />
                                                        ตั้งค่าค่าบริการส่วนกลางรายห้อง
                                                    </div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0.75rem' }}>
                                                        {commonFees.filter(f => f.is_active).map(fee => {
                                                            const override = editCommonFeeOverrides[fee.id] || {};
                                                            const isActive = override.is_active ?? fee.is_active;
                                                            const amount = override.amount ?? fee.amount;
                                                            return (
                                                                <div key={fee.id} style={{
                                                                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                                                                    padding: '0.5rem 0.75rem', borderRadius: '8px',
                                                                    background: isActive ? 'rgba(34, 163, 90,0.05)' : 'rgba(85, 112, 137,0.05)',
                                                                    border: `1px solid ${isActive ? 'rgba(34, 163, 90,0.2)' : 'rgba(85, 112, 137,0.2)'}`,
                                                                    opacity: isActive ? 1 : 0.6
                                                                }}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isActive}
                                                                        onChange={e => setEditCommonFeeOverrides(prev => ({
                                                                            ...prev,
                                                                            [fee.id]: { ...prev[fee.id], is_active: e.target.checked }
                                                                        }))}
                                                                    />
                                                                    <div style={{ flex: 1 }}>
                                                                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text)' }}>{fee.name}</div>
                                                                    </div>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                                        <input
                                                                            type="number"
                                                                            disabled={!isActive}
                                                                            className="form-input mono"
                                                                            style={{ width: '70px', padding: '0.2rem 0.4rem', fontSize: '0.8rem', textAlign: 'right' }}
                                                                            value={amount}
                                                                            onChange={e => setEditCommonFeeOverrides(prev => ({
                                                                                ...prev,
                                                                                [fee.id]: { ...prev[fee.id], amount: Number(e.target.value) }
                                                                            }))}
                                                                        />
                                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)' }}>บ.</span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

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
