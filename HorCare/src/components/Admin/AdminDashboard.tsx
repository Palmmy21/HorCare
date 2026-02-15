import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useFirestore } from '../../hooks/useFirestore';
import type { UserProfile } from '../../types';
import { Search, Loader2, CheckCircle, Clock, Shield, AlertTriangle } from 'lucide-react';

export default function AdminDashboard() {
    const { user, profile } = useAuth();
    const { getAllUsers, updateUserLicense } = useFirestore(user?.uid ?? null);

    const [users, setUsers] = useState<UserProfile[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [processingId, setProcessingId] = useState<string | null>(null);

    const loadUsers = async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await getAllUsers();
            setUsers(result);
        } catch (err: any) {
            console.error('Failed to load users:', err);
            setError(err.message || 'ไม่สามารถโหลดข้อมูลผู้ใช้งานได้');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, [getAllUsers]);

    const handleExtendTrial = async (uid: string) => {
        setProcessingId(uid);
        try {
            const current = users.find(u => u.uid === uid);
            if (!current) return;

            const currentExp = new Date(current.trial_expires_at || new Date());
            currentExp.setDate(currentExp.getDate() + 30);

            await updateUserLicense(uid, {
                trial_expires_at: currentExp.toISOString(),
                license: 'trial'
            });
            await loadUsers();
            alert('เพิ่มเวลาทดลองใช้เรียบร้อย');
        } catch (error) {
            console.error(error);
            alert('เกิดข้อผิดพลาดในการบันทึก');
        } finally {
            setProcessingId(null);
        }
    };

    const handleUnlockForever = async (uid: string) => {
        if (!confirm('ยืนยันปลดล็อกถาวรให้กับผู้ใช้นี้?')) return;
        setProcessingId(uid);
        try {
            await updateUserLicense(uid, {
                license: 'active'
            });
            await loadUsers();
            alert('ปลดล็อกถาวรเรียบร้อย');
        } catch (error) {
            console.error(error);
            alert('เกิดข้อผิดพลาดในการบันทึก');
        } finally {
            setProcessingId(null);
        }
    };

    const filteredUsers = users.filter(u =>
        u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.display_name?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // Allow hardcoded admin email or role
    const isAdmin = profile?.role === 'admin' || user?.email === 'sakdidechneverdie@gmail.com';

    if (!isAdmin) {
        return (
            <div className="p-8 text-center text-red-500">
                <AlertTriangle className="mx-auto mb-2" size={48} />
                <h2 className="text-xl font-bold">Access Denied</h2>
                <p>คุณไม่มีสิทธิ์เข้าถึงหน้านี้</p>
                <div className="mt-4 text-xs bg-gray-100 p-2 rounded max-w-md mx-auto text-left">
                    <p>Current Email: {user?.email}</p>
                    <p>Current Role: {profile?.role || 'N/A'}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="fade-in">
            <div className="page-header">
                <h1 className="page-title flex items-center gap-2">
                    <Shield className="text-primary" />
                    แผงควบคุมผู้ดูแลระบบ
                </h1>
                <p className="page-subtitle">จัดการสิทธิ์และข้อมูลผู้ใช้งาน</p>
            </div>

            <div className="card">
                {error && (
                    <div className="p-4 mb-4 text-sm text-red-700 bg-red-100 rounded-lg flex items-center gap-2">
                        <AlertTriangle size={16} />
                        {error}
                    </div>
                )}

                <div className="card-header flex-col md:flex-row gap-4 items-stretch md:items-center">
                    <div className="relative w-full md:max-w-md">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
                        <input
                            type="text"
                            placeholder="ค้นหาผู้ใช้ (ชื่อ, อีเมล)..."
                            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="text-sm text-gray-500 ml-auto">
                        ผู้ใช้งานทั้งหมด: {users.length} คน
                    </div>
                </div>

                <div className="table-container">
                    <table className="table w-full">
                        <thead>
                            <tr>
                                <th className="text-left py-3 px-4">ผู้ใช้งาน</th>
                                <th className="text-center py-3 px-4">สถานะ</th>
                                <th className="text-left py-3 px-4">วันที่หมดอายุ</th>
                                <th className="text-center py-3 px-4">จัดการ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={4} className="text-center py-12">
                                        <Loader2 className="spin mx-auto text-primary" size={32} />
                                        <p className="mt-2 text-gray-500">กำลังโหลดข้อมูล...</p>
                                    </td>
                                </tr>
                            ) : filteredUsers.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="text-center py-12 text-gray-400">
                                        {error ? 'เกิดข้อผิดพลาดในการโหลดข้อมูล' : 'ไม่พบข้อมูลผู้ใช้งานที่ค้นหา'}
                                    </td>
                                </tr>
                            ) : filteredUsers.map(u => (
                                <tr key={u.uid} className="hover:bg-gray-50 transition-colors">
                                    <td className="py-3 px-4">
                                        <div className="font-semibold text-gray-900">{u.display_name || 'ไม่ระบุชื่อ'}</div>
                                        <div className="text-sm text-gray-500">{u.email}</div>
                                        <div className="text-xs text-gray-400 mt-1">
                                            UID: {u.uid.substring(0, 8)}...
                                        </div>
                                    </td>
                                    <td className="py-3 px-4 text-center">
                                        {u.license === 'active' ? (
                                            <span className="badge badge-success inline-flex items-center gap-1">
                                                <CheckCircle size={12} /> ตลอดชีพ
                                            </span>
                                        ) : (
                                            <span className={`badge ${u.trial_expires_at && new Date(u.trial_expires_at) < new Date() ? 'badge-error' : 'badge-warning'} inline-flex items-center gap-1`}>
                                                <Clock size={12} /> ทดลองใช้
                                            </span>
                                        )}
                                    </td>
                                    <td className="py-3 px-4">
                                        {u.license === 'trial' && u.trial_expires_at ? (
                                            <div className={`text-sm ${new Date(u.trial_expires_at) < new Date() ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                                                {new Date(u.trial_expires_at).toLocaleDateString('th-TH', {
                                                    year: 'numeric',
                                                    month: 'long',
                                                    day: 'numeric'
                                                })}
                                            </div>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </td>
                                    <td className="py-3 px-4">
                                        <div className="flex gap-2 justify-center">
                                            <button
                                                className="btn text-xs px-3 py-1 bg-yellow-100 text-yellow-700 hover:bg-yellow-200 border-yellow-200 transition-colors"
                                                onClick={() => handleExtendTrial(u.uid)}
                                                disabled={processingId === u.uid}
                                                title="ต่อเวลาทดลองใช้ 30 วัน"
                                            >
                                                {processingId === u.uid ? '...' : '+30 วัน'}
                                            </button>
                                            <button
                                                className="btn text-xs px-3 py-1 bg-green-100 text-green-700 hover:bg-green-200 border-green-200 transition-colors"
                                                onClick={() => handleUnlockForever(u.uid)}
                                                disabled={processingId === u.uid}
                                                title="ปลดล็อกใช้งานถาวร"
                                            >
                                                {processingId === u.uid ? '...' : 'ปลดล็อก'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
