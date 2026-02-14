import { useState } from 'react';
import { Plus, Trash2, Edit2, Check, X, Home, Zap, Droplets } from 'lucide-react';
import type { Room, DormConfig } from '../../types';
import { formatCurrency } from '../../utils/calculations';

interface RoomManagementProps {
    rooms: Room[];
    config: DormConfig;
    onAddRoom: (roomNumber: string) => void;
    onUpdateRoom: (roomId: string, updates: Partial<Room>) => void;
    onDeleteRoom: (roomId: string) => void;
}

export default function RoomManagement({
    rooms,
    config,
    onAddRoom,
    onUpdateRoom,
    onDeleteRoom
}: RoomManagementProps) {
    const [newRoomNumber, setNewRoomNumber] = useState('');
    const [editingRoom, setEditingRoom] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [editRentAmount, setEditRentAmount] = useState('');
    const [editRentType, setEditRentType] = useState<'monthly' | 'semester'>('monthly');
    const [editRoomType, setEditRoomType] = useState<'dormitory' | 'commercial'>('dormitory');
    const [editCustomElecRate, setEditCustomElecRate] = useState('');
    const [editCustomWaterRate, setEditCustomWaterRate] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

    const hasAnyCommercial = rooms.some(r => (r.room_type || 'dormitory') === 'commercial');

    const handleAddRoom = () => {
        if (!newRoomNumber.trim()) return;

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
        setEditCustomElecRate(room.custom_electricity_rate?.toString() || '');
        setEditCustomWaterRate(
            room.custom_water_config
                ? (room.custom_water_config.type === 'normal'
                    ? (room.custom_water_config.unit_rate || 0).toString()
                    : '')
                : ''
        );
    };

    const saveEdit = (roomId: string) => {
        if (!editValue.trim()) return;
        const updates: Partial<Room> = {
            room_number: editValue.trim(),
            rent_amount: Number(editRentAmount) || 0,
            rent_type: editRentType,
            room_type: editRoomType
        };
        if (editRoomType === 'commercial') {
            updates.custom_electricity_rate = editCustomElecRate
                ? Number(editCustomElecRate)
                : undefined;
            updates.custom_water_config = editCustomWaterRate
                ? { type: 'normal' as const, unit_rate: Number(editCustomWaterRate) }
                : undefined;
        } else {
            // Clear custom rates when switching to dormitory
            updates.custom_electricity_rate = undefined;
            updates.custom_water_config = undefined;
        }
        onUpdateRoom(roomId, updates);
        setEditingRoom(null);
    };

    const cancelEdit = () => {
        setEditingRoom(null);
        setEditValue('');
        setEditRentAmount('');
        setEditRentType('monthly');
        setEditRoomType('dormitory');
        setEditCustomElecRate('');
        setEditCustomWaterRate('');
    };

    const confirmDelete = (roomId: string) => {
        onDeleteRoom(roomId);
        setShowDeleteConfirm(null);
    };

    return (
        <div>
            <div className="page-header">
                <h1 className="page-title">🏠 จัดการห้องพัก</h1>
                <p className="page-subtitle">เพิ่ม แก้ไข หรือลบห้องพักในระบบ</p>
            </div>

            {/* Add Room Form */}
            <div className="card mb-6">
                <div className="card-header">
                    <span className="card-title">➕ เพิ่มห้องใหม่</span>
                </div>
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
            </div>

            {/* Room List */}
            <div className="card">
                <div className="card-header">
                    <span className="card-title">📋 รายการห้องทั้งหมด ({rooms.length} ห้อง)</span>
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
                                    <th style={{ width: '60px' }}>#</th>
                                    <th>หมายเลขห้อง</th>
                                    <th className="text-center">ประเภทห้อง</th>
                                    <th className="text-right">ค่าเช่า</th>
                                    <th className="text-center">การชำระ</th>
                                    <th className="text-right">มิเตอร์ไฟ</th>
                                    <th className="text-right">มิเตอร์น้ำ</th>
                                    {hasAnyCommercial && <th className="text-center">ค่าน้ำ/ไฟ</th>}
                                    <th className="text-center" style={{ width: '140px' }}>จัดการ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rooms.map((room, index) => (
                                    <tr key={room.id}>
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
                                                <span className="mono font-bold">{room.room_number}</span>
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
                                                    <option value="dormitory">🏠 หอพัก</option>
                                                    <option value="commercial">🏢 พาณิชย์</option>
                                                </select>
                                            ) : (
                                                <span className={`badge ${(room.room_type || 'dormitory') === 'commercial' ? 'badge-info' : 'badge-success'}`} style={{ fontSize: '0.75rem' }}>
                                                    {(room.room_type || 'dormitory') === 'commercial' ? '🏢 พาณิชย์' : '🏠 หอพัก'}
                                                </span>
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
                                                    {room.rent_type === 'semester' ? '📅 รายเทอม' : '📆 รายเดือน'}
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
                                                                <div>⚡ {room.custom_electricity_rate} บ./หน่วย</div>
                                                            )}
                                                            {room.custom_water_config?.unit_rate && (
                                                                <div>💧 {room.custom_water_config.unit_rate} บ./หน่วย</div>
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
        </div>
    );
}
