import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard, Home, FileText, Send, Settings as SettingsIcon,
  Menu, X, LogOut, Clock, Shield, Calculator, Zap, Ban,
  Building2, ChevronDown, Plus, Check, Pencil, Wallet
} from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useFirestore } from './hooks/useFirestore';
import { useBuildings } from './hooks/useBuildings';
import { useTheme } from './hooks/useTheme';
import { getCurrentMonth } from './utils/calculations';
import Dashboard from './components/Dashboard/Dashboard';
import RoomManagement from './components/RoomManagement/RoomManagement';
import MeterRecording from './components/MeterRecording/MeterRecording';
import Summary from './components/Summary/Summary';
import Settings from './components/Settings/Settings';
import LoginPage from './components/Auth/LoginPage';
import VerifyEmailWall from './components/Auth/VerifyEmailWall';
import AdminDashboard from './components/Admin/AdminDashboard';
import PaymentsPage from './components/Payments/PaymentsPage';
import MeterCalculator from './components/MeterCalculator/MeterCalculator';
import PricingPage from './components/Pricing/PricingPage';
import InstallPrompt from './components/PWA/InstallPrompt';
import { isPaidLicense, getMaxRooms, getMaxBuildings, canSendLine } from './hooks/useSubscription';

import './index.css';

type ViewMode = 'dashboard' | 'rooms' | 'recording' | 'summary' | 'payments' | 'settings' | 'admin' | 'calculator' | 'pricing';

function App() {
  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(getCurrentMonth());
  const [buildingMenuOpen, setBuildingMenuOpen] = useState(false);
  const [addBuildingMode, setAddBuildingMode] = useState(false);
  const [newBuildingName, setNewBuildingName] = useState('');
  const [renamingBuildingId, setRenamingBuildingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');
  const buildingMenuRef = useRef<HTMLDivElement>(null);
  const [paymentToast, setPaymentToast] = useState<'success' | 'cancel' | null>(null);
  const [pendingPlan, setPendingPlan] = useState<{ planId: string; cycle: string } | null>(null);

  // Theme
  const { themeId, setTheme, mode, setMode } = useTheme();

  // Auth
  const {
    user, profile, loading: authLoading, error: authError,
    emailVerified, login, register, logout, resetPassword,
    resendVerification, refreshEmailVerified,
    isTrialExpired, isPaidExpired, trialDaysLeft, licenseDaysLeft, isBanned, setError
  } = useAuth();

  // Buildings (multi-building support — Large plan)
  const { buildings, loading: buildingsLoading, addBuilding, renameBuilding } = useBuildings(user?.uid ?? null);

  // Active building — persisted per user in localStorage
  const buildingStorageKey = user ? `horcare_active_building_${user.uid}` : null;
  const [activeBuildingId, setActiveBuildingId] = useState<string | null>(null);

  // Sync activeBuildingId when buildings load
  useEffect(() => {
    if (buildingsLoading || buildings.length === 0) return;
    const stored = buildingStorageKey ? localStorage.getItem(buildingStorageKey) : null;
    const valid = stored && buildings.some(b => b.id === stored);
    const next = valid ? stored : buildings[0].id;
    setActiveBuildingId(next);
  }, [buildingsLoading, buildings, buildingStorageKey]);

  // Handle Stripe redirect: ?payment=success|cancel
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('payment');
    if (result === 'success' || result === 'cancel') {
      setPaymentToast(result as 'success' | 'cancel');
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => setPaymentToast(null), result === 'success' ? 6000 : 3000);
    }
  }, []);

  // After login+verify, redirect to pricing and pre-select the plan chosen as guest
  useEffect(() => {
    if (!user || !emailVerified) return;
    const pending = localStorage.getItem('horcare_pending_plan');
    if (pending) {
      localStorage.removeItem('horcare_pending_plan');
      try {
        setPendingPlan(JSON.parse(pending));
      } catch {}
      setCurrentView('pricing');
    }
  }, [user, emailVerified]);

  // Close building menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (buildingMenuRef.current && !buildingMenuRef.current.contains(e.target as Node)) {
        setBuildingMenuOpen(false);
        setAddBuildingMode(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleSwitchBuilding = (id: string) => {
    setActiveBuildingId(id);
    if (buildingStorageKey) localStorage.setItem(buildingStorageKey, id);
    setBuildingMenuOpen(false);
  };

  const handleAddBuilding = async () => {
    if (!newBuildingName.trim()) return;
    const b = await addBuilding(newBuildingName);
    if (b) handleSwitchBuilding(b.id);
    setNewBuildingName('');
    setAddBuildingMode(false);
    setBuildingMenuOpen(false);
  };

  const handleRenameBuilding = async (id: string) => {
    if (!renamingName.trim()) return;
    await renameBuilding(id, renamingName);
    setRenamingBuildingId(null);
    setRenamingName('');
  };

  // Firestore — scoped to active building
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
    unlockMonth,
    getMonthStats,
    deleteBill,
    updateBillPayment
  } = useFirestore(user?.uid ?? null, activeBuildingId, currentMonth);

  // Auto-clean orphaned bills (e.g. from deleted rooms)
  useEffect(() => {
    if (dataLoading || !user || bills.length === 0 || rooms.length === 0) return;

    bills.forEach(bill => {
      // If the room doesn't exist anymore, delete its orphaned bills
      const roomExists = rooms.some(r => r.id === bill.room_id);
      if (!roomExists && deleteBill) {
        console.log(`Auto-deleting orphaned bill: ${bill.id} (Room ${bill.room_number})`);
        deleteBill(bill.id);
      }
    });
  }, [bills, rooms, dataLoading, user, deleteBill]);

  const stats = getMonthStats(currentMonth);
  const monthBills = getBillsForMonth(currentMonth);

  const navItems = [
    { id: 'dashboard' as ViewMode, icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'rooms' as ViewMode, icon: Home, label: 'จัดการห้อง' },
    { id: 'recording' as ViewMode, icon: FileText, label: 'จดมิเตอร์' },
    { id: 'summary' as ViewMode, icon: Send, label: 'สรุปยอด' },
    { id: 'payments' as ViewMode, icon: Wallet, label: 'การชำระเงิน' },
    { id: 'calculator' as ViewMode, icon: Calculator, label: 'คำนวณมิเตอร์' },
    { id: 'settings' as ViewMode, icon: SettingsIcon, label: 'ตั้งค่า' },
    { id: 'pricing' as ViewMode, icon: Zap, label: 'แพ็กเกจ' },
  ];

  const isAdmin = profile?.role === 'admin' || user?.email === 'horcare.admin@gmail.com';

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
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'rgba(220,38,38,0.15)', border: '2px solid rgba(220,38,38,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Ban size={40} color="#F87171" /></div>
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

  // Trial OR paid plan expired → show upgrade/renewal wall.
  // Paid plans are one-time payments that don't auto-renew, so once the period
  // lapses the user must pay again to keep using the app.
  if (user && (isTrialExpired || isPaidExpired)) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', flexDirection: 'column', gap: '1.25rem',
        padding: '2rem', textAlign: 'center',
        background: 'linear-gradient(135deg, #0F0C29 0%, #302B63 50%, #24243E 100%)'
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'rgba(139,92,246,0.15)', border: '2px solid rgba(139,92,246,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Clock size={40} color="#A78BFA" /></div>
        <h2 style={{ color: '#F87171', fontWeight: 800, fontSize: '1.6rem', margin: 0 }}>
          {isPaidExpired ? 'แพ็กเกจหมดอายุแล้ว' : 'ทดลองใช้หมดอายุแล้ว'}
        </h2>
        <p style={{ color: '#9CA3AF', maxWidth: '400px', lineHeight: 1.7, margin: 0 }}>
          {isPaidExpired ? (
            <>แพ็กเกจของคุณครบรอบการใช้งานแล้ว<br />ต่ออายุเพื่อใช้งานต่อได้เลย</>
          ) : (
            <>ระยะเวลาทดลองใช้งานฟรี 60 วันของคุณหมดอายุแล้ว<br />อัปเกรดแผนเพื่อใช้งานต่อได้เลย</>
          )}
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.5rem' }}>
          <button
            className="btn btn-primary"
            id="upgrade-from-expired"
            onClick={() => {
              // Mount a temporary pricing page overlay
              const overlay = document.getElementById('expired-pricing-overlay');
              if (overlay) overlay.style.display = 'block';
            }}
            style={{
              background: 'linear-gradient(135deg, #8B5CF6, #EC4899)',
              border: 'none', padding: '0.875rem 2rem',
              borderRadius: '14px', color: '#fff',
              fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              boxShadow: '0 4px 24px rgba(139,92,246,0.4)',
            }}
          >
            <Zap size={18} /> ดูแพ็กเกจ
          </button>
          <button
            className="btn"
            onClick={logout}
            style={{
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.6)', padding: '0.875rem 1.5rem',
              borderRadius: '14px', cursor: 'pointer',
            }}
          >
            ออกจากระบบ
          </button>
        </div>
        {/* Pricing overlay for expired users */}
        <div
          id="expired-pricing-overlay"
          style={{
            display: 'none', position: 'fixed', inset: 0,
            background: '#fff', zIndex: 500, overflowY: 'auto', padding: '2rem',
          }}
        >
          <PricingPage
            profile={profile}
            onBack={() => {
              const overlay = document.getElementById('expired-pricing-overlay');
              if (overlay) overlay.style.display = 'none';
            }}
            onSubscribed={() => {
              window.location.reload();
            }}
          />
        </div>
      </div>
    );
  }

  // Not logged in → show login page
  if (!user) {
    return (
      <LoginPage
        onLogin={handleLogin}
        onRegister={handleRegister}
        onResetPassword={resetPassword}
        error={authError}
        clearError={() => setError(null)}
      />
    );
  }

  // Email not verified → block usage until verified (admin exempt to avoid lockout).
  // Stops fake-email signups and unlimited free-trial farming via throwaway emails.
  if (!emailVerified && user.email !== 'horcare.admin@gmail.com') {
    return (
      <VerifyEmailWall
        email={user.email ?? ''}
        onResend={resendVerification}
        onRefresh={refreshEmailVerified}
        onLogout={logout}
      />
    );
  }

  // Still loading data (buildings must resolve first so we have a valid buildingId)
  if (buildingsLoading || dataLoading || !activeBuildingId) {
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

  // Check if user has paid subscription / large plan
  const hasPaidSubscription = profile ? isPaidLicense(profile.license) : false;
  const maxBuildings = profile ? getMaxBuildings(profile.license) : 1;
  const canAddBuilding = maxBuildings > 1;
  const isTrial = profile?.license === 'trial';
  const lineEnabled = profile?.license ? canSendLine(profile.license) : true;
  const maxRooms = profile ? getMaxRooms(profile.license) : 5;
  const activeBuilding = buildings.find(b => b.id === activeBuildingId);

  return (
    <div className="app-container">
      {/* Trial Banner */}
      {profile?.license === 'trial' && trialDaysLeft !== null && (
        <div
          className={`trial-banner ${isTrialExpired ? 'expired' : ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => setCurrentView('pricing')}
        >
          <Clock size={16} />
          {isTrialExpired
            ? 'ทดลองใช้หมดอายุแล้ว — คลิกเพื่ออัปเกรด'
            : `ทดลองใช้ฟรี เหลือ ${trialDaysLeft} วัน — คลิกเพื่ออัปเกรด`
          }
          <Zap size={14} style={{ marginLeft: 'auto' }} />
        </div>
      )}

      {/* Paid plan near-expiry reminder — nudge to renew before access lapses */}
      {licenseDaysLeft !== null && licenseDaysLeft <= 7 && (
        <div
          className="trial-banner"
          style={{ cursor: 'pointer' }}
          onClick={() => setCurrentView('pricing')}
        >
          <Clock size={16} />
          {licenseDaysLeft === 0
            ? 'แพ็กเกจครบรอบวันนี้ — คลิกเพื่อต่ออายุ'
            : `แพ็กเกจใกล้ครบรอบ เหลือ ${licenseDaysLeft} วัน — คลิกเพื่อต่ออายุ`
          }
          <Zap size={14} style={{ marginLeft: 'auto' }} />
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
          <img src="/logo-icon.png" alt="HorCare" style={{ width: 36, height: 36, objectFit: 'contain' }} />
          <span>HorCare</span>
        </div>

        {/* Building Switcher — all paid plans (small=5, medium=20, large=∞) */}
        {canAddBuilding && (
          <div ref={buildingMenuRef} style={{ position: 'relative', padding: '0 var(--space-3)', marginBottom: 'var(--space-2)' }}>
            <button
              onClick={() => { setBuildingMenuOpen(v => !v); setAddBuildingMode(false); }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px', padding: '0.5rem 0.625rem', cursor: 'pointer',
                color: 'rgba(255,255,255,0.85)', fontSize: '0.8125rem', fontWeight: 600,
              }}
            >
              <Building2 size={15} style={{ flexShrink: 0, opacity: 0.7 }} />
              <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeBuilding?.name ?? '—'}
              </span>
              <ChevronDown size={14} style={{ flexShrink: 0, opacity: 0.5, transform: buildingMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>

            {buildingMenuOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 'var(--space-3)', right: 'var(--space-3)',
                background: '#1e2535', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '10px', overflow: 'hidden', zIndex: 200,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}>
                {buildings.map(b => (
                  <div key={b.id} style={{ display: 'flex', alignItems: 'center' }}>
                    {renamingBuildingId === b.id ? (
                      <form
                        style={{ flex: 1, display: 'flex', gap: '0.25rem', padding: '0.375rem 0.5rem' }}
                        onSubmit={e => { e.preventDefault(); handleRenameBuilding(b.id); }}
                      >
                        <input
                          autoFocus
                          value={renamingName}
                          onChange={e => setRenamingName(e.target.value)}
                          style={{
                            flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
                            borderRadius: '6px', color: '#fff', fontSize: '0.8rem', padding: '0.25rem 0.5rem',
                          }}
                        />
                        <button type="submit" style={{ background: 'none', border: 'none', color: '#60A5FA', cursor: 'pointer', padding: '0 0.25rem' }}>
                          <Check size={14} />
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          onClick={() => handleSwitchBuilding(b.id)}
                          style={{
                            flex: 1, textAlign: 'left', background: 'none', border: 'none',
                            color: b.id === activeBuildingId ? '#60A5FA' : 'rgba(255,255,255,0.75)',
                            fontSize: '0.8125rem', fontWeight: b.id === activeBuildingId ? 700 : 400,
                            padding: '0.5rem 0.75rem', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                          }}
                        >
                          {b.id === activeBuildingId && <Check size={12} />}
                          <span style={{ marginLeft: b.id === activeBuildingId ? 0 : '1.25rem' }}>{b.name}</span>
                        </button>
                        <button
                          onClick={() => { setRenamingBuildingId(b.id); setRenamingName(b.name); }}
                          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', padding: '0 0.5rem' }}
                        >
                          <Pencil size={12} />
                        </button>
                      </>
                    )}
                  </div>
                ))}

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', padding: '0.375rem 0.5rem' }}>
                  {addBuildingMode ? (
                    <form style={{ display: 'flex', gap: '0.25rem' }} onSubmit={e => { e.preventDefault(); handleAddBuilding(); }}>
                      <input
                        autoFocus
                        placeholder="ชื่อตึกใหม่"
                        value={newBuildingName}
                        onChange={e => setNewBuildingName(e.target.value)}
                        style={{
                          flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '6px', color: '#fff', fontSize: '0.8rem', padding: '0.25rem 0.5rem',
                        }}
                      />
                      <button type="submit" style={{ background: 'none', border: 'none', color: '#60A5FA', cursor: 'pointer', padding: '0 0.25rem' }}>
                        <Check size={14} />
                      </button>
                    </form>
                  ) : buildings.length >= maxBuildings ? (
                    <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', padding: '0.25rem 0.25rem', display: 'block' }}>
                      ครบ {maxBuildings} หอแล้ว
                    </span>
                  ) : (
                    <button
                      onClick={() => setAddBuildingMode(true)}
                      style={{
                        width: '100%', background: 'none', border: 'none',
                        color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.25rem',
                      }}
                    >
                      <Plus size={13} /> เพิ่มตึก
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

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

        {/* Upgrade nudge for trial users */}
        {profile?.license === 'trial' && !hasPaidSubscription && (
          <button
            onClick={() => handleNavClick('pricing')}
            style={{
              margin: 'var(--space-4) var(--space-3) 0',
              background: 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(236,72,153,0.15))',
              border: '1px solid rgba(139,92,246,0.35)',
              borderRadius: '12px',
              padding: '0.75rem',
              cursor: 'pointer', textAlign: 'left', width: 'calc(100% - calc(var(--space-3) * 2))',
              color: '#C4B5FD',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <Zap size={14} color="#A78BFA" />
              <span style={{ fontWeight: 700, fontSize: '0.8125rem' }}>อัปเกรดแผน</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(196,181,253,0.7)', lineHeight: 1.4 }}>
              เริ่มต้น ฿79/เดือน
            </div>
          </button>
        )}

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
            allBills={bills}
            uid={user?.uid}
            onGoToPayments={() => setCurrentView('payments')}
          />
        )}

        {currentView === 'rooms' && (
          <RoomManagement
            rooms={rooms}
            config={config}
            onAddRoom={addRoom}
            onUpdateRoom={updateRoom}
            onDeleteRoom={deleteRoom}
            maxRooms={maxRooms}
            isTrial={isTrial}
            onUpgrade={() => setCurrentView('pricing')}
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
            buildingId={activeBuildingId ?? undefined}
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
            onUnlockMonth={unlockMonth}
            uid={user?.uid}
            buildingId={activeBuildingId ?? undefined}
            isTrial={isTrial}
            canSendLine={lineEnabled}
            onUpgrade={() => setCurrentView('pricing')}
          />
        )}

        {currentView === 'payments' && (
          <PaymentsPage
            bills={bills}
            rooms={rooms}
            config={config}
            currentMonth={currentMonth}
            onMonthChange={setCurrentMonth}
            onUpdatePayment={updateBillPayment}
            uid={user?.uid}
            buildingId={activeBuildingId ?? undefined}
          />
        )}

        {currentView === 'calculator' && (
          <MeterCalculator />
        )}

        {currentView === 'settings' && (
          <Settings
            config={config}
            onSaveConfig={saveConfig}
            themeId={themeId}
            onSetTheme={setTheme}
            mode={mode}
            onSetMode={setMode}
          />
        )}

        {currentView === 'admin' && isAdmin && (
          <AdminDashboard />
        )}

        {currentView === 'pricing' && (
          <PricingPage
            profile={profile}
            onBack={() => setCurrentView('dashboard')}
            initialPlanId={pendingPlan?.planId}
            initialCycle={pendingPlan?.cycle as 'monthly' | 'yearly' | undefined}
            onSubscribed={() => {
              setPendingPlan(null);
              setCurrentView('dashboard');
            }}
          />
        )}
      </main>
      <InstallPrompt />

      {/* Payment result toast */}
      {paymentToast === 'success' && (
        <div style={{
          position: 'fixed', top: '1.25rem', left: '50%', transform: 'translateX(-50%)',
          background: 'linear-gradient(135deg, #059669, #10B981)',
          color: '#fff', padding: '0.875rem 1.5rem',
          borderRadius: '14px', boxShadow: '0 4px 24px rgba(16,185,129,0.4)',
          zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.625rem',
          fontWeight: 600, fontSize: '0.9375rem', whiteSpace: 'nowrap',
        }}>
          <Check size={18} />
          ชำระเงินสำเร็จ! แพ็กเกจของคุณเปิดใช้งานแล้ว
          <button
            onClick={() => setPaymentToast(null)}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', marginLeft: '0.25rem', padding: 0, display: 'flex' }}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {paymentToast === 'cancel' && (
        <div style={{
          position: 'fixed', top: '1.25rem', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(30,37,53,0.96)', border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.8)', padding: '0.875rem 1.5rem',
          borderRadius: '14px', boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
          zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.625rem',
          fontWeight: 500, fontSize: '0.9rem', whiteSpace: 'nowrap',
        }}>
          ยกเลิกการชำระเงินแล้ว
          <button
            onClick={() => setPaymentToast(null)}
            style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', marginLeft: '0.25rem', padding: 0, display: 'flex' }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
