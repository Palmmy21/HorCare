import { useState } from 'react';
import {
  LayoutDashboard, Home, FileText, Send, Settings as SettingsIcon,
  Menu, X, LogOut, Clock, Shield, Calculator
} from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useFirestore } from './hooks/useFirestore';
import { getCurrentMonth } from './utils/calculations';
import Dashboard from './components/Dashboard/Dashboard';
import RoomManagement from './components/RoomManagement/RoomManagement';
import MeterRecording from './components/MeterRecording/MeterRecording';
import Summary from './components/Summary/Summary';
import Settings from './components/Settings/Settings';
import LoginPage from './components/Auth/LoginPage';
import AdminDashboard from './components/Admin/AdminDashboard';
import MeterCalculator from './components/MeterCalculator/MeterCalculator';
import './index.css';

type ViewMode = 'dashboard' | 'rooms' | 'recording' | 'summary' | 'settings' | 'admin' | 'calculator';

function App() {
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(getCurrentMonth());

  // Auth
  const {
    user, profile, loading: authLoading, error: authError,
    login, register, logout, isTrialExpired, trialDaysLeft, isBanned, setError
  } = useAuth();

  // Firestore (only loads when user is logged in)
  const {
    config,
    rooms,
    bills,
    loading: dataLoading,
    saveConfig,
    addRoom,
    updateRoom,
    deleteRoom,
    saveBill,
    getBillForRoom,
    getBillsForMonth,
    getPreviousBill,
    closeMonth,
    getMonthStats
  } = useFirestore(user?.uid ?? null);

  const stats = getMonthStats(currentMonth);
  const monthBills = getBillsForMonth(currentMonth);

  const navItems = [
    { id: 'dashboard' as ViewMode, icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'rooms' as ViewMode, icon: Home, label: 'จัดการห้อง' },
    { id: 'recording' as ViewMode, icon: FileText, label: 'จดมิเตอร์' },
    { id: 'summary' as ViewMode, icon: Send, label: 'สรุปยอด' },
    { id: 'calculator' as ViewMode, icon: Calculator, label: 'คำนวณมิเตอร์' },
    { id: 'settings' as ViewMode, icon: SettingsIcon, label: 'ตั้งค่า' },
  ];

  const isAdmin = profile?.role === 'admin' || user?.email === 'sakdidechneverdie@gmail.com';

  if (isAdmin) {
    navItems.push({ id: 'admin' as ViewMode, icon: Shield, label: 'Admin' });
  }

  const handleNavClick = (view: ViewMode) => {
    setCurrentView(view);
    setMobileMenuOpen(false);
  };

  const handleLogin = async (email: string, password: string) => {
    await login(email, password);
  };

  const handleRegister = async (email: string, password: string, name: string) => {
    await register(email, password, name);
  };

  // Loading state
  if (authLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <div className="loading-spinner" style={{ width: 40, height: 40 }}></div>
        <p>กำลังโหลด...</p>
      </div>
    );
  }

  // Banned → block usage and force sign out
  if (user && isBanned) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', flexDirection: 'column', gap: '1rem',
        padding: '2rem', textAlign: 'center',
        background: 'linear-gradient(135deg, #1a0a0a 0%, #2d0000 100%)'
      }}>
        <div style={{ fontSize: '3.5rem' }}>🚫</div>
        <h2 style={{ color: '#F87171', fontWeight: 800, fontSize: '1.5rem', marginBottom: '0.25rem' }}>บัญชีถูกระงับ</h2>
        <p style={{ color: '#9CA3AF', maxWidth: '380px', lineHeight: 1.7 }}>
          บัญชีของคุณถูกระงับโดยผู้ดูแลระบบ
          หากคิดว่าเป็นการผิดพลาด กรุณาติดต่อทีมสนับสนุน
        </p>
        <button
          className="btn"
          onClick={logout}
          style={{ marginTop: '1rem', background: '#DC2626', color: '#fff', padding: '0.75rem 2rem', borderRadius: '12px' }}
        >
          ออกจากระบบ
        </button>
      </div>
    );
  }

  // Trial expired → block usage
  if (user && isTrialExpired) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '1rem',
        padding: '2rem',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: '3rem' }}>⏰</div>
        <h2 style={{ color: '#EF4444', marginBottom: '0.5rem' }}>ทดลองใช้หมดอายุแล้ว</h2>
        <p style={{ color: '#737373', maxWidth: '400px' }}>
          ระยะเวลาทดลองใช้งานฟรี 30 วันของคุณหมดอายุแล้ว
          กรุณาอัปเกรดเพื่อใช้งานต่อ
        </p>
        <button
          className="btn btn-primary"
          onClick={logout}
          style={{ marginTop: '1rem' }}
        >
          ออกจากระบบ
        </button>
      </div>
    );
  }

  // Not logged in → show login page
  if (!user) {
    return (
      <LoginPage
        onLogin={handleLogin}
        onRegister={handleRegister}
        error={authError}
        clearError={() => setError(null)}
      />
    );
  }

  // Still loading data
  if (dataLoading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <div className="loading-spinner" style={{ width: 40, height: 40 }}></div>
        <p>กำลังโหลดข้อมูล...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Trial Banner */}
      {profile?.license === 'trial' && trialDaysLeft !== null && (
        <div className={`trial-banner ${isTrialExpired ? 'expired' : ''}`}>
          <Clock size={16} />
          {isTrialExpired
            ? 'ทดลองใช้หมดอายุแล้ว — กรุณาอัปเกรดเพื่อบันทึกข้อมูลต่อ'
            : `ทดลองใช้ฟรี เหลือ ${trialDaysLeft} วัน`
          }
        </div>
      )}

      {/* Mobile Header */}
      <div className="mobile-header">
        <button
          className="mobile-menu-btn"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <span style={{ fontWeight: 700 }}>HorCare</span>
        <div style={{ width: 44 }}></div>
      </div>

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <img src="/logo.png" alt="HorCare" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          <span>HorCare</span>
        </div>

        <nav className="sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${currentView === item.id ? 'active' : ''}`}
              onClick={() => handleNavClick(item.id)}
            >
              <item.icon size={20} />
              {item.label}
            </button>
          ))}
        </nav>

        {/* User info + logout */}
        <div style={{
          marginTop: 'auto',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid rgba(255,255,255,0.08)'
        }}>
          <div style={{
            color: 'rgba(255,255,255,0.6)',
            fontSize: '0.75rem',
            marginBottom: 'var(--space-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {profile?.display_name || user.email}
          </div>
          <button
            className="nav-item"
            onClick={logout}
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            <LogOut size={18} />
            ออกจากระบบ
          </button>
          <div style={{
            color: 'rgba(255,255,255,0.3)',
            fontSize: '0.6875rem',
            marginTop: 'var(--space-2)'
          }}>
            HorCare v1.0
          </div>
        </div>
      </aside>

      {/* Overlay for mobile menu */}
      {mobileMenuOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 99
          }}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Main Content */}
      <main className="main-content">
        {currentView === 'dashboard' && (
          <Dashboard
            config={config}
            stats={stats}
            currentMonth={currentMonth}
            recentBills={monthBills}
          />
        )}

        {currentView === 'rooms' && (
          <RoomManagement
            rooms={rooms}
            config={config}
            onAddRoom={addRoom}
            onUpdateRoom={updateRoom}
            onDeleteRoom={deleteRoom}
          />
        )}

        {currentView === 'recording' && (
          <MeterRecording
            rooms={rooms}
            config={config}
            currentMonth={currentMonth}
            onSaveBill={saveBill}
            getBillForRoom={getBillForRoom}
            getPreviousBill={getPreviousBill}
            onMonthChange={setCurrentMonth}
          />
        )}

        {currentView === 'summary' && (
          <Summary
            bills={bills}
            rooms={rooms}
            config={config}
            currentMonth={currentMonth}
            stats={stats}
            onCloseMonth={closeMonth}
          />
        )}

        {currentView === 'calculator' && (
          <MeterCalculator />
        )}

        {currentView === 'settings' && (
          <Settings
            config={config}
            onSaveConfig={saveConfig}
          />
        )}

        {currentView === 'admin' && profile?.role === 'admin' && (
          <AdminDashboard />
        )}
      </main>
    </div>
  );
}

export default App;
