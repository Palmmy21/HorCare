import { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, Home, Zap, Droplets, Building2, ClipboardList, CalendarDays, CalendarCheck, MessageCircle, Link2Off, Lock, CheckSquare, Square, UserCheck } from 'lucide-react';
import type { Room, DormConfig } from '../../types';
import { formatCurrency } from '../../utils/calculations';
import TenantProfilePage from '../TenantProfile/TenantProfilePage';

interface RoomManagementProps {
    rooms: Room[];
    config: DormConfig;
    onAddRoom: (roomNumber: string) => void;
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
    onAddRoom,
    onUpdateRoom,
    onDeleteRoom,
    maxRooms = Infinity,
    isTrial = false,
    onUpgrade,
    uid,
    buildingId,
    isPaid = false,
}: RoomManagementProps) {
    const [newRoomNumber, setNewRoomNumber] = useState('');
    const [editingRoom, setEditingRoom] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [editRentAmount, setEditRentAmount] = useState('');
    const [editRentType, setEditRentType] = useState<'monthly' | 'semester'>('monthly');
    const [editRoomType, setEditRoomType] = useState<'dormitory' | 'commercial'>('dormitory');
    const [editTenantCount, setEditTenantCount] = useState<string>('1');
    const [editCustomElecRate, setEditCustomElecRate] = useState('');
    const [editCustomWaterRate, setEditCustomWaterRate] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
    const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
    const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
    const [tenantRoomId, setTenantRoomId] = useState<string | null>(null);

    const hasAnyCommercial = rooms.some(r => (r.room_type || 'dormitory') === 'commercial');

    const atRoomLimit = rooms.length >= maxRooms;

    const handleAddRoom = () => {
        if (!newRoomNumber.trim()) return;
        if (atRoomLimit) return;

        // Check for duplicate
        if (rooms.some(r => r.room_number === newRoomNumber.trim())) {
            alert('ห้องนี้มีอยู่แล้ว!');
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
        setEditRentType(room.rent_type);
        setEditRoomType(room.room_type || 'dormitory');
        setEditTenantCount((room.tenant_count || 1).toString());
        setEditCustomElecRate(room.custom_electricity_rate?.toString() || '');
        setEditCustomWaterRate(
            room.custom_water_config
                ? (room.custom_water_config.type === 'normal'
                    ? (room.custom_water_config.unit_rate || 0).toString()
                    : '')
                : ''
        );
    };

    const saveEdit = async (roomId: string) => {
        if (!editValue.trim()) return;
        const updates: Partial<Room> = {
            room_number: editValue.trim(),
            rent_amount: Number(editRentAmount) || 0,
            rent_type: editRentType,
            room_type: editRoomType,
            tenant_count: Number(editTenantCount) || 1
        };
        if (editRoomType === 'commercial') {
            updates.custom_electricity_rate = editCustomElecRate
                ? Number(editCustomElecRate)
                : null;
            updates.custom_water_config = editCustomWaterRate
                ? { type: 'normal' as const, unit_rate: Number(editCustomWaterRate) }
                : null;
        } else {
            // Clear custom rates when switching to dormitory
            updates.custom_electricity_rate = null;
            updates.custom_water_config = null;
        }
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
        setEditCustomElecRate('');
        setEditCustomWaterRate('');
    };

    const confirmDelete = (roomId: string) => {
        onDeleteRoom(roomId);
        setShowDeleteConfirm(null);
        setSelectedRooms(prev => { const s = new Set(prev); s.delete(roomId); return s; });
    };

    const toggleSelect = (id: string) => {
        setSelectedRooms(prev => {
            const s = new Set(prev);
            s.has(id) ? s.delete(id) : s.add(id);
            return s;
        });
    };

    const isAllSelected = rooms.length > 0 && rooms.every(r => selectedRooms.has(r.id));

    const toggleSelectAll = () => {
        setSelectedRooms(isAllSelected ? new Set() : new Set(rooms.map(r => r.id)));
    };

    const handleBulkDelete = () => {
        selectedRooms.forEach(id => onDeleteRoom(id));
        setSelectedRooms(new Set());
        setShowBulkDeleteConfirm(false);
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Home size={28} /> จัดการห้องพัก</h1>
                <p className="page-subtitle">เพิ่ม แก้ไข หรือลบห้องพักในระบบ</p>
            </div>

            {/* Room limit banner — trial users only */}
            {isTrial && maxRooms !== Infinity && (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexWrap: 'wrap', gap: '0.75rem',
                    padding: '0.75rem 1rem', marginBottom: '1rem',
                    borderRadius: '12px',
                    background: atRoomLimit ? 'rgba(239,68,68,0.10)' : 'rgba(139,92,246,0.08)',
                    border: atRoomLimit ? '1px solid rgba(239,68,68,0.25)' : '1px solid rgba(139,92,246,0.2)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Lock size={14} color={atRoomLimit ? '#F87171' : '#A78BFA'} />
                        <span style={{ fontSize: '0.8125rem', color: atRoomLimit ? '#FCA5A5' : '#C4B5FD', fontWeight: 600 }}>
                            {atRoomLimit
                                ? `ถึงลิมิตทดลองใช้แล้ว (${rooms.length}/${maxRooms} ห้อง)`
                                : `ทดลองใช้: ${rooms.length}/${maxRooms} ห้อง`
                            }
                        </span>
                    </div>
                    {atRoomLimit && onUpgrade && (
                        <button
                            onClick={onUpgrade}
                            style={{
                                background: 'linear-gradient(135deg,#8B5CF6,#EC4899)',
                                border: 'none', borderRadius: '8px',
                                padding: '0.375rem 0.875rem',
                                color: '#fff', fontWeight: 700, fontSize: '0.78rem',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem',
                            }}
                        >
                            <Zap size={12} fill="currentColor" /> อัปเกรดเพื่อเพิ่มห้องได้มากขึ้น
                        </button>
                    )}
                </div>
            )}

            {/* Add Room Form */}
            <div className="card mb-6">
                <div className="card-header">
                    <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Plus size={16} /> เพิ่มห้องใหม่</span>
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
                            ไม่สามารถเพิ่มห้องได้ — แผนทดลองใช้รองรับสูงสุด {maxRooms} ห้อง
                        </span>
                        {onUpgrade && (
                            <button
                                onClick={onUpgrade}
                                style={{
                                    marginLeft: 'auto', background: 'rgba(139,92,246,0.15)',
                                    border: '1px solid rgba(139,92,246,0.3)',
                                    borderRadius: '8px', padding: '0.375rem 0.75rem',
                                    color: '#C4B5FD', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                                }}
                            >
                                อัปเกรด
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="flex gap-4 items-center">
                        <input
                            type="text"
                            className="form-input mono"
                            style={{ maxWidth: '200px' }}
                            placeholder="เช่น A101, B202"
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
                            เพิ่มห้อง
                        </button>
                    </div>
                )}
            </div>

            {/* Room List */}
            <div className="card">
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <span className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <ClipboardList size={18} /> รายการห้องทั้งหมด ({rooms.length} ห้อง)
                    </span>
                    {selectedRooms.size > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                                เลือก {selectedRooms.size} ห้อง
                            </span>
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
                        <Home size={48} />
                        <h3>ยังไม่มีห้องพัก</h3>
                        <p>เพิ่มห้องพักด้านบนเพื่อเริ่มต้นใช้งาน</p>
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th style={{ width: '40px', textAlign: 'center' }}>
                                        <button
                                            onClick={toggleSelectAll}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: isAllSelected ? '#60A5FA' : 'var(--color-gray-400)', display: 'flex', alignItems: 'center', margin: '0 auto' }}
                                            title={isAllSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
                                        >
                                            {isAllSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                        </button>
                                    </th>
                                    <th style={{ width: '50px' }}>#</th>
                                    <th>หมายเลขห้อง</th>
                                    <th className="text-center">ประเภทห้อง</th>
                                    <th className="text-center">ผู้พักอาศัย</th>
                                    <th className="text-right">ค่าเช่า</th>
                                    <th className="text-center">การชำระ</th>
                                    <th className="text-right">มิเตอร์ไฟ</th>
                                    <th className="text-right">มิเตอร์น้ำ</th>
                                    {hasAnyCommercial && <th className="text-center">ค่าน้ำ/ไฟ</th>}
                                    <th className="text-center" style={{ width: '180px' }}>จัดการ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rooms.map((room, index) => (
                                    <tr key={room.id} style={selectedRooms.has(room.id) ? { background: 'rgba(96,165,250,0.06)' } : undefined}>
                                        <td style={{ textAlign: 'center' }}>
                                            <button
                                                onClick={() => editingRoom !== room.id && toggleSelect(room.id)}
                                                disabled={editingRoom === room.id}
                                                style={{ background: 'none', border: 'none', cursor: editingRoom === room.id ? 'default' : 'pointer', color: selectedRooms.has(room.id) ? '#60A5FA' : 'var(--color-gray-300)', display: 'flex', alignItems: 'center', margin: '0 auto', opacity: editingRoom === room.id ? 0.3 : 1 }}
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
                                                        placeholder="เลขห้อง"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <span className="mono font-bold">{room.room_number}</span>
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
                                                <select
                                                    className="form-input"
                                                    style={{ width: '130px', fontSize: '0.8125rem' }}
                                                    value={editRoomType}
                                                    onChange={e => setEditRoomType(e.target.value as 'dormitory' | 'commercial')}
                                                >
                                                    <option value="dormitory">หอพัก</option>
                                                    <option value="commercial">พาณิชย์</option>
                                                </select>
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
                                                <span className="mono">{room.tenant_count || 1} คน</span>
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
                                                    onChange={e => setEditRentType(e.target.value as 'monthly' | 'semester')}
                                                >
                                                    <option value="monthly">รายเดือน</option>
                                                    <option value="semester">รายเทอม</option>
                                                </select>
                                            ) : (
                                                <span className={`badge ${room.rent_type === 'semester' ? 'badge-warning' : 'badge-success'}`}>
                                                    {room.rent_type === 'semester' ? (
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><CalendarDays size={12} /> รายเทอม</span>
                                                    ) : (
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><CalendarCheck size={12} /> รายเดือน</span>
                                                    )}
                                                </span>
                                            )}
                                        </td>
                                        <td className="text-right mono">{room.current_meter_elec.toLocaleString()}</td>
                                        <td className="text-right mono">{room.current_meter_water.toLocaleString()}</td>
                                        {hasAnyCommercial && (
                                            <td className="text-center" style={{ fontSize: '0.75rem' }}>
                                                {(room.room_type || 'dormitory') === 'commercial' ? (
                                                    editingRoom === room.id ? (
                                                        editRoomType === 'commercial' ? (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                                    <Zap size={12} color="#F59E0B" />
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
                                                                    <Droplets size={12} color="#2563EB" />
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
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Zap size={12} color="#D97706" /> {room.custom_electricity_rate} บ./หน่วย</div>
                                                            )}
                                                            {room.custom_water_config?.unit_rate && (
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Droplets size={12} color="#2563EB" /> {room.custom_water_config.unit_rate} บ./หน่วย</div>
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
                    />
                );
            })()}
        </div>
    );
}
