import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  LayoutDashboard, Home, FileText, Send, Settings as SettingsIcon,
  Menu, X, LogOut, Clock, Shield, ShieldCheck, Zap, Ban, Package, ClipboardCheck, MessageSquare, Megaphone,
  Building2, ChevronDown, ChevronLeft, Plus, Check, Pencil, Users, Wrench, SlidersHorizontal, Lock, CreditCard, Trash2 as TrashIcon, Archive, Bell, Smartphone, Sparkles, Store
} from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { useFirestore } from './hooks/useFirestore';
import { useBuildings } from './hooks/useBuildings';
import { useLineThreads } from './hooks/useLineThreads';
import { groupNav, groupOfView, isGroupOpen, navGroupDefs, parseSavedState, type NavGroupState, type TransientClose } from './utils/navGroups';
import { useFCMToken } from './hooks/useFCMToken';
import { usePushNotification } from './hooks/usePushNotification';
import { useTheme } from './hooks/useTheme';
import { getCurrentMonth } from './utils/calculations';
import { getWorkspaceTerms } from './utils/workspaceTerminology';
import { setAuditContext, logActivity, logActivityAsync } from './utils/auditLog';
// Core pages — always needed, load eagerly
import Dashboard from './components/Dashboard/Dashboard';
import RoomManagement from './components/RoomManagement/RoomManagement';
import MeterRecording from './components/MeterRecording/MeterRecording';
import Settings from './components/Settings/Settings';
import LoginPage from './components/Auth/LoginPage';
import { isPaidLicense, getMaxRooms, getMaxBuildings, canSendLine, isPlusOrAbove } from './hooks/useSubscription';
import { useMaintenanceRequests, useStockItems } from './hooks/useMaintenanceRequests';
import { useCleaningRequests } from './hooks/useCleaningRequests';
import SlipNotificationToast from './components/SlipNotificationToast';
import InstallPrompt, { isPWAStandalone } from './components/PWA/InstallPrompt';
import AddBuildingModal from './components/Building/AddBuildingModal';
import type { HousekeeperSession, DormConfig, InitialBuildingConfig } from './types';
import toast from 'react-hot-toast';
// Heavy pages — lazy loaded so their chunks (jsPDF, html2canvas, Stripe, etc.)
// are downloaded only when the user first navigates to them
const Summary         = lazy(() => import('./components/Summary/Summary'));
const DocumentArchive = lazy(() => import('./components/DocumentArchive/DocumentArchive'));
const PaymentsPage    = lazy(() => import('./components/Payments/PaymentsPage'));
const TenantsPage     = lazy(() => import('./components/TenantProfile/TenantsPage'));
const MaintenancePage = lazy(() => import('./components/Maintenance/MaintenancePage'));
const CleaningPage    = lazy(() => import('./components/Cleaning/CleaningPage'));
const MaidPortalView  = lazy(() => import('./components/Cleaning/MaidPortalView'));
const OperationsPage  = lazy(() => import('./components/Operations/OperationsPage'));
const SecurityPage    = lazy(() => import('./components/Security/SecurityPage'));
const ParcelsPage     = lazy(() => import('./components/Parcels/ParcelsPage'));
const AnnouncementsPage = lazy(() => import('./components/Announcements/AnnouncementsPage'));
const WorkOrdersPage  = lazy(() => import('./components/WorkOrders/WorkOrdersPage'));
const MessagesPage    = lazy(() => import('./components/Messages/MessagesPage'));

const PricingPage     = lazy(() => import('./components/Pricing/PricingPage'));
const AdminDashboard  = lazy(() => import('./components/Admin/AdminDashboard'));
const FeatureLockedModal = lazy(() => import('./components/FeatureLockedModal'));
const BranchSelector = lazy(() => import('./components/BranchSelector/BranchSelector'));

import './index.css';
import horcareLogo from './assets/horcare_logo.png';

function PageLoader({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: fullScreen ? '100dvh' : '60vh',
      height: fullScreen ? '100dvh' : 'auto',
      width: '100%',
      gap: '0.875rem',
      color: 'var(--text-secondary, #64748b)',
      fontSize: '0.9375rem',
      fontWeight: 500
    }}>
      <div className="loading-spinner" style={{ width: 36, height: 36, borderWidth: 3 }} />
      <span>กำลังโหลด...</span>
    </div>
  );
}


type ViewMode = 'dashboard' | 'rooms' | 'tenants' | 'maintenance' | 'cleaning' | 'operations' | 'recording' | 'summary' | 'archives' | 'payments' | 'parcels' | 'workorders' | 'messages' | 'announcements' | 'security' | 'settings' | 'admin' | 'pricing';

function App() {
  const [minSplashDone, setMinSplashDone] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setMinSplashDone(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  const [currentView, setCurrentView] = useState<ViewMode>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Sidebar categories: which groups the user left expanded (saved), plus a one-off collapse
  // of the group that holds the page they are on (only valid for that page).
  const [navGroupState, setNavGroupState] = useState<NavGroupState>(() => {
    try { return parseSavedState(localStorage.getItem('horcare_nav_groups_v1')); } catch { return {}; }
  });
  const [transientClose, setTransientClose] = useState<TransientClose | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('horcare_sidebar_collapsed') === 'true';
  });

  const handleToggleSidebar = () => {
    if (window.innerWidth <= 768) {
      setMobileMenuOpen(false);
    } else {
      setSidebarCollapsed(prev => {
        const next = !prev;
        localStorage.setItem('horcare_sidebar_collapsed', String(next));
        return next;
      });
    }
  };
  const [currentMonth, setCurrentMonth] = useState(getCurrentMonth());
  const [buildingMenuOpen, setBuildingMenuOpen] = useState(false);
  const [isAddBuildingModalOpen, setIsAddBuildingModalOpen] = useState(false);
  const [renamingBuildingId, setRenamingBuildingId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');
  const buildingMenuRef = useRef<HTMLDivElement>(null);
  const [paymentToast, setPaymentToast] = useState<'success' | 'cancel' | null>(null);
  const [pendingPlan, setPendingPlan] = useState<{ planId: string; cycle: string } | null>(null);
  const [showFeatureLockedModal, setShowFeatureLockedModal] = useState<string | null>(null);
  const [deleteBuildingConfirm, setDeleteBuildingConfirm] = useState<string | null>(null);
  const [hasSelectedBranch, setHasSelectedBranch] = useState(false);

  // Theme
  const { themeId, setTheme, mode, setMode } = useTheme();

  // Auth
  const {
    user, profile, loading: authLoading, error: authError,
    emailVerified, login, register, logout: signOutUser, resetPassword,
    sendVerifyEmailViaResend, refreshEmailVerified,
    isPaidExpired, licenseDaysLeft, isBanned, setError
  } = useAuth();

  // FCM push notification token — registers silently when permission is already granted
  useFCMToken(user?.uid ?? null);

  // Browser push notification permission state & request helper
  const { permission: notifPermission, requestPermission: requestNotifPermission } = usePushNotification();
  const [dismissedNotifBanner, setDismissedNotifBanner] = useState(() => {
    return sessionStorage.getItem('horcare_dismiss_notif_banner') === 'true';
  });

  // Maid session state
  const [maidSession, setMaidSession] = useState<HousekeeperSession | null>(() => {
    try {
      const raw = localStorage.getItem('horcare_maid_session');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const handleMaidLogout = () => {
    localStorage.removeItem('horcare_maid_session');
    setMaidSession(null);
    setCurrentView('dashboard');
  };

  // Active building — persisted per user in localStorage
  const buildingStorageKey = user ? `horcare_active_building_${user.uid}` : null;
  const [activeBuildingId, setActiveBuildingId] = useState<string | null>(() => maidSession?.building_id ?? null);

  const effectiveUid = maidSession ? maidSession.owner_uid : (user?.uid ?? null);
  const effectiveBuildingId = maidSession ? maidSession.building_id : activeBuildingId;

  // Activity log identity. Maid sessions have no Firebase user, so nothing is logged for them.
  useEffect(() => {
    if (!user || maidSession) {
      setAuditContext(null);
      return;
    }
    setAuditContext({
      organizationId: user.uid,
      userId: user.uid,
      userName: user.displayName || user.email || user.uid,
      role: 'owner',
      propertyId: activeBuildingId,
    });
  }, [user, maidSession, activeBuildingId]);

  // One LOGIN event per browser session (page reloads restore the session and are not logins).
  useEffect(() => {
    if (!user || maidSession) return;
    const key = `horcare_login_logged_${user.uid}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch { /* storage blocked — log anyway */ }
    logActivity({ action: 'LOGIN', resourceType: 'session', resourceId: user.uid, resourceLabel: user.email ?? undefined, propertyId: null });
  }, [user, maidSession]);

  const logout = async () => {
    if (user && !maidSession) {
      // Must be written before sign-out (rules need the auth token); don't hang if offline.
      await Promise.race([
        logActivityAsync({ action: 'LOGOUT', resourceType: 'session', resourceId: user.uid, resourceLabel: user.email ?? undefined, propertyId: null }),
        new Promise(resolve => setTimeout(resolve, 1500)),
      ]);
      try { sessionStorage.removeItem(`horcare_login_logged_${user.uid}`); } catch { /* ignore */ }
    }
    await signOutUser();
  };

  // Buildings (multi-building support — Large plan)
  const { buildings, loading: buildingsLoading, addBuilding, renameBuilding, deleteBuilding } = useBuildings(effectiveUid);

  useEffect(() => {
    if (maidSession?.building_id) {
      setActiveBuildingId(maidSession.building_id);
    }
  }, [maidSession]);

  useEffect(() => {
    if (maidSession && currentView !== 'cleaning' && currentView !== 'recording') {
      setCurrentView('cleaning');
    }
  }, [maidSession, currentView]);

  // Sync activeBuildingId when buildings load
  useEffect(() => {
    if (maidSession?.building_id) return;
    if (buildingsLoading || buildings.length === 0) return;
    const stored = buildingStorageKey ? localStorage.getItem(buildingStorageKey) : null;
    const valid = stored && buildings.some(b => b.id === stored);
    const next = valid ? stored : buildings[0].id;
    setActiveBuildingId(next); // eslint-disable-line react-hooks/set-state-in-effect
  }, [buildingsLoading, buildings, buildingStorageKey, maidSession]);

  // Handle Stripe redirect: ?payment=success|cancel
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('payment');
    if (result === 'success' || result === 'cancel') {
      setPaymentToast(result as 'success' | 'cancel'); // eslint-disable-line react-hooks/set-state-in-effect
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => setPaymentToast(null), result === 'success' ? 6000 : 3000);
    }
  }, []);

  // After login, redirect to pricing and pre-select the plan chosen as guest
  useEffect(() => {
    if (!user) return;
    const pending = localStorage.getItem('horcare_pending_plan');
    if (pending) {
      localStorage.removeItem('horcare_pending_plan');
      try {
        setPendingPlan(JSON.parse(pending)); // eslint-disable-line react-hooks/set-state-in-effect
      } catch { /* ignore malformed pending plan JSON */ }
      setCurrentView('pricing');
    }
  }, [user]);

  // Close building menu on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (buildingMenuRef.current && !buildingMenuRef.current.contains(e.target as Node)) {
        setBuildingMenuOpen(false);
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

  const handleAddBuildingSubmit = async (name: string, initialConfig: Partial<DormConfig>) => {
    const b = await addBuilding(name, initialConfig);
    if (b) {
      handleSwitchBuilding(b.id);
      setHasSelectedBranch(true);
      toast.success(`เพิ่มสาขา "${name}" เรียบร้อยแล้ว 🎉`);
    }
    setBuildingMenuOpen(false);
    setIsAddBuildingModalOpen(false);
  };

  const handleRenameBuilding = async (id: string) => {
    if (!renamingName.trim()) return;
    await renameBuilding(id, renamingName);
    setRenamingBuildingId(null);
    setRenamingName('');
  };

  const handleDeleteBuilding = async (id: string) => {
    if (buildings.length <= 1) return; // ป้องกันลบตึกสุดท้าย
    await deleteBuilding(id);
    // ถ้าตึกที่ลบคือตึกที่กำลังใช้งาน ให้สลับไปตึกแรกที่เหลือ
    if (activeBuildingId === id) {
      const next = buildings.find(b => b.id !== id);
      if (next) handleSwitchBuilding(next.id);
    }
    setDeleteBuildingConfirm(null);
    setBuildingMenuOpen(false);
  };

  // Firestore — scoped to active building
  const {
    config,
    rooms,
    bills,
    fines,
    commonFees,
    loading: dataLoading,
    saveConfig,
    addRoom,
    addRoomsBulk,
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
    updateBillPayment,
    addFine,
    updateFine,
    deleteFine,
    addCommonFee,
    updateCommonFee,
    deleteCommonFee,
  } = useFirestore(effectiveUid, effectiveBuildingId, currentMonth);


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

  // Maintenance badge — real-time count of open/in-progress requests
  const { requests: _maintenanceReqs } = useMaintenanceRequests(
    effectiveUid,
    effectiveBuildingId,
  );
  const pendingMaintenanceCount = _maintenanceReqs.filter(
    r => r.status === 'open' || r.status === 'in_progress'
  ).length;

  // Cleaning requests badge — real-time count of open requests
  const { requests: cleaningRequests } = useCleaningRequests(
    effectiveUid,
    effectiveBuildingId,
  );
  const pendingCleaningCount = cleaningRequests.filter(r => r.status === 'pending').length;

  // Payment slip badge — bills waiting for owner confirmation
  const pendingSlipCount = bills.filter(b => b.payment_status === 'pending').length;

  // LINE inbox — live conversations (shared with the Messages page) and the unread badge
  const { threads: lineThreads, unreadTotal: unreadMessages, loading: threadsLoading, error: threadsError } =
    useLineThreads(maidSession ? null : (user?.uid ?? null), maidSession ? null : activeBuildingId);

  // Stock badge — real-time count of items below minimum quantity
  const { items: _stockItems } = useStockItems(effectiveUid, effectiveBuildingId);
  const lowStockCount = _stockItems.filter(
    i => i.min_quantity > 0 && i.quantity <= i.min_quantity
  ).length;

  // PWA standalone state
  const [isStandalone, setIsStandalone] = useState(() => isPWAStandalone());
  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const onChange = () => setIsStandalone(isPWAStandalone());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const stats = getMonthStats(currentMonth);
  const monthBills = getBillsForMonth(currentMonth);
  const terms = getWorkspaceTerms(config?.building_type);

  const navItems = [
    { id: 'dashboard'   as ViewMode, icon: LayoutDashboard, label: 'Dashboard' },
    { id: 'rooms'       as ViewMode, icon: terms.isMarket ? Store : Home, label: terms.manageUnitsLabel || 'จัดการห้อง' },
    { id: 'recording'   as ViewMode, icon: FileText,        label: terms.meterRecordingLabel || 'จดมิเตอร์' },
    { id: 'tenants'     as ViewMode, icon: Users,           label: terms.tenantLabel || 'ผู้เช่า' },
    { id: 'maintenance' as ViewMode, icon: Wrench,          label: 'แจ้งซ่อม' },
    { id: 'cleaning'    as ViewMode, icon: Sparkles,        label: terms.isMarket ? 'ดูแลตลาด/ขยะ' : 'งานแม่บ้าน' },
    { id: 'operations'  as ViewMode, icon: SlidersHorizontal, label: 'ระบบจัดการ' },
    { id: 'payments'    as ViewMode, icon: CreditCard,      label: 'การชำระเงิน' },
    { id: 'summary'     as ViewMode, icon: Send,            label: 'สรุปยอด' },
    { id: 'archives'    as ViewMode, icon: Archive,         label: 'คลังเอกสาร' },
    { id: 'parcels'     as ViewMode, icon: Package,         label: 'พัสดุ' },
    { id: 'workorders'  as ViewMode, icon: ClipboardCheck,  label: 'ใบงานช่าง/แม่บ้าน' },
    { id: 'messages'    as ViewMode, icon: MessageSquare,   label: 'ข้อความ LINE' },
    { id: 'announcements' as ViewMode, icon: Megaphone, label: 'ประกาศ & ตอบอัตโนมัติ' },
    { id: 'security'    as ViewMode, icon: ShieldCheck,     label: 'ความปลอดภัย' },

    { id: 'settings'    as ViewMode, icon: SettingsIcon,    label: 'ตั้งค่า' },
    { id: 'pricing'     as ViewMode, icon: Zap,             label: 'แพ็กเกจ' },
  ];

  const visibleNavItems = maidSession
    ? [
        { id: 'cleaning' as ViewMode, icon: Sparkles, label: terms.isMarket ? 'ดูแลตลาด/ขยะ' : 'งานแม่บ้าน' },
        { id: 'recording' as ViewMode, icon: FileText, label: terms.meterRecordingLabel || 'จดมิเตอร์' },
      ]
    : navItems;

  const isAdmin = profile?.role === 'admin';

  if (isAdmin) {
    navItems.push({ id: 'admin' as ViewMode, icon: Shield, label: 'Admin' });
  }

  // Start+ features (any paid plan: Start / Plus / Pro)
  const START_ONLY_VIEWS: ViewMode[] = ['tenants', 'maintenance', 'cleaning', 'operations', 'payments', 'archives'];

  const VIEW_LABELS: Record<string, string> = {
    tenants: terms.tenantLabel || 'ผู้เช่า',
    maintenance: 'แจ้งซ่อม',
    cleaning: terms.isMarket ? 'ดูแลตลาด/ขยะ' : 'งานแม่บ้าน',
    operations: 'ระบบจัดการ',
    payments: 'การชำระเงิน',
    archives: 'คลังเอกสาร',
  };

  const handleNavClick = (view: ViewMode) => {
    if (!maidSession && START_ONLY_VIEWS.includes(view) && !hasPaidSubscription) {
      setShowFeatureLockedModal(VIEW_LABELS[view] ?? view);
      setMobileMenuOpen(false);
      return;
    }
    setCurrentView(view);
    setMobileMenuOpen(false);
  };

  // Sidebar: red badge count per view (paid features only), grouped into categories.
  const badgeOf = (id: string): number => {
    if (!hasPaidSubscription) return 0;
    switch (id) {
      case 'cleaning': return pendingCleaningCount;
      case 'maintenance': return pendingMaintenanceCount;
      case 'operations': return lowStockCount;
      case 'payments': return pendingSlipCount;
      case 'messages': return unreadMessages;
      default: return 0;
    }
  };

  const navGroups = groupNav(visibleNavItems, navGroupDefs(terms.isMarket));
  const activeNavGroupId = groupOfView(navGroups, currentView);
  const NAV_GROUP_ICONS: Record<string, React.ElementType> = {
    property: terms.isMarket ? Store : Home, people: Users, money: CreditCard,
    service: Wrench, comms: MessageSquare, system: SettingsIcon, overview: LayoutDashboard,
  };

  const toggleNavGroup = (groupId: string) => {
    if (groupId === activeNavGroupId) {
      // Collapse/expand the group holding the current page; forgotten when the page changes.
      setTransientClose(prev => (prev && prev.groupId === groupId && prev.view === currentView) ? null : { groupId, view: currentView });
      return;
    }
    setNavGroupState(prev => {
      const next: NavGroupState = { ...prev, [groupId]: prev[groupId] === 'open' ? 'closed' : 'open' };
      try { localStorage.setItem('horcare_nav_groups_v1', JSON.stringify(next)); } catch { /* storage blocked */ }
      return next;
    });
  };

  const renderNavItem = (item: (typeof navItems)[number], nested = false) => {
    const isLocked = !maidSession && START_ONLY_VIEWS.includes(item.id) && !hasPaidSubscription;
    const badgeCount = badgeOf(item.id);
    const showBadge = badgeCount > 0;
    return (
      <button
        key={item.id}
        className={`nav-item ${nested ? 'nav-subitem' : ''} ${currentView === item.id ? 'active' : ''} ${isLocked ? 'nav-item-locked' : ''}`}
        onClick={() => handleNavClick(item.id)}
      >
        {/* Icon with optional red dot */}
        <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
          <item.icon size={nested ? 18 : 20} />
          {showBadge && (
            <span className="nav-item-badge" style={{
              position: 'absolute', top: -3, right: -4,
              width: 8, height: 8, borderRadius: '50%',
              background: '#EF4444',
              border: '1.5px solid #FFFFFF',
              boxShadow: '0 0 6px rgba(239,68,68,0.7)',
            }} />
          )}
        </span>
        <span className="nav-label">{item.label}</span>
        {/* Badge count on the right when not locked */}
        {showBadge && (
          <span className="nav-item-badge" style={{
            marginLeft: 'auto',
            minWidth: 18, height: 18, borderRadius: 9,
            background: '#EF4444',
            color: '#fff', fontSize: '0.6875rem', fontWeight: 700,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 5px',
            boxShadow: '0 2px 6px rgba(239,68,68,0.5)',
          }}>
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
        {isLocked && <Lock className="nav-item-lock" size={13} style={{ marginLeft: 'auto', color: '#BAE6FD', opacity: 0.8 }} />}
      </button>
    );
  };
  // Sidebar branch button: back to the "choose a branch" welcome page.
  const goToBranchSelector = () => {
    setBuildingMenuOpen(false);
    setMobileMenuOpen(false);
    setHasSelectedBranch(false);
  };

  const handleLogin = async (email: string, password: string) => {
    await login(email, password);
  };

  const handleRegister = async (email: string, password: string, name: string, initialBuilding?: InitialBuildingConfig) => {
    await register(email, password, name, initialBuilding);
  };

  const handleMonthChange = (newMonth: string) => {
    const current = getCurrentMonth();
    const currentY = parseInt(current.split('-')[0], 10);
    const currentM = parseInt(current.split('-')[1], 10);
    const newY = parseInt(newMonth.split('-')[0], 10);
    const newM = parseInt(newMonth.split('-')[1], 10);
    
    const monthDiff = (currentY - newY) * 12 + (currentM - newM);

    if (monthDiff > 6) {
      alert('ระบบรองรับการดูบิลย้อนหลังได้สูงสุด 6 เดือนเท่านั้น');
      return;
    }
    setCurrentMonth(newMonth);
  };

  // Loading state
  if (authLoading || !minSplashDone) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '1rem'
      }}>
        <div className="login-logo" style={{ marginBottom: 0 }}>
          <img src={horcareLogo} alt="HorCare" style={{ width: 140, height: 140, objectFit: 'contain' }} />
        </div>
        <p style={{ color: 'var(--color-gray-400)', fontWeight: 500 }}>กำลังโหลด...</p>
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

  // Paid plan expired → show renewal wall.
  // Paid plans are one-time payments that don't auto-renew, so once the period
  // lapses the user must pay again to keep using the app.
  if (user && isPaidExpired) {
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
          แพ็กเกจหมดอายุแล้ว
        </h2>
        <p style={{ color: '#9CA3AF', maxWidth: '400px', lineHeight: 1.7, margin: 0 }}>
          แพ็กเกจของคุณครบรอบการใช้งานแล้ว<br />ต่ออายุเพื่อใช้งานต่อได้เลย
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
  if (!user && !maidSession) {
    return (
      <LoginPage
        onLogin={handleLogin}
        onRegister={handleRegister}
        onResetPassword={resetPassword}
        onMaidLogin={(session) => {
          setMaidSession(session);
          setCurrentView('cleaning');
        }}
        error={authError}
        clearError={() => setError(null)}
      />
    );
  }

  // (Email verification is now optional — users can access immediately after signup)
  // A banner in Settings will prompt them to verify when convenient

  // Still loading data (buildings must resolve first so we have a valid buildingId)
  if (!maidSession && (buildingsLoading || dataLoading || !activeBuildingId)) {
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

  if (maidSession && (!activeBuildingId || dataLoading)) {
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
        <p>กำลังโหลดข้อมูลแม่บ้าน...</p>
      </div>
    );
  }

  // Plan tier checks
  const hasPaidSubscription = profile ? isPaidLicense(profile.license) : false;
  const maxBuildings = profile ? getMaxBuildings(profile.license) : 1;
  const canAddBuilding = maxBuildings > 1;
  const lineEnabled = profile?.license ? canSendLine(profile.license) : true;
  const maxRooms = profile ? getMaxRooms(profile.license) : 5;
  const activeBuilding = buildings.find(b => b.id === activeBuildingId);

  if (!maidSession && hasPaidSubscription && !hasSelectedBranch && buildings.length > 0) {
    return (
      <Suspense fallback={<PageLoader fullScreen />}>
        <BranchSelector 
          buildings={buildings}
          onSelect={(id) => {
            handleSwitchBuilding(id);
            setHasSelectedBranch(true);
          }}
          canAddBuilding={canAddBuilding}
          onAddBuilding={() => {
            setIsAddBuildingModalOpen(true);
          }}
          userName={profile?.name || user?.email?.split('@')[0] || 'User'}
        />
        <AddBuildingModal
          isOpen={isAddBuildingModalOpen}
          onClose={() => setIsAddBuildingModalOpen(false)}
          onAdd={handleAddBuildingSubmit}
        />
      </Suspense>
    );
  }

  return (
    <div className="app-container">
      <SlipNotificationToast
        bills={bills}
        fines={fines}
        maintenanceRequests={_maintenanceReqs}
        cleaningRequests={cleaningRequests}
        buildingId={effectiveBuildingId}
        onGoToPayments={() => handleNavClick('payments')}
        onGoToMaintenance={() => handleNavClick('maintenance')}
        onGoToCleaning={() => handleNavClick('cleaning')}
      />
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
          style={{ position: 'relative' }}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          {/* Red dot on hamburger when menu is closed and there are pending items */}
          {!mobileMenuOpen && (pendingMaintenanceCount > 0 || lowStockCount > 0 || pendingSlipCount > 0) && hasPaidSubscription && (
            <span style={{
              position: 'absolute', top: 6, right: 6,
              width: 8, height: 8, borderRadius: '50%',
              background: '#EF4444',
              border: '1.5px solid var(--bg-primary, #fff)',
              boxShadow: '0 0 5px rgba(239,68,68,0.7)',
              pointerEvents: 'none',
            }} />
          )}
        </button>
        <span style={{ fontWeight: 700 }}>HorCare</span>
        <div style={{ width: 44 }}></div>
      </div>

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-logo" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: sidebarCollapsed ? 'center' : 'space-between',
          width: '100%',
        }}>
          {!sidebarCollapsed ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
                <img src={horcareLogo} alt="HorCare" style={{ width: 36, height: 36, objectFit: 'contain', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>HorCare</span>
              </div>
              <button
                type="button"
                onClick={handleToggleSidebar}
                style={{
                  background: 'rgba(255, 255, 255, 0.18)',
                  border: '1px solid rgba(255, 255, 255, 0.35)',
                  borderRadius: '8px',
                  width: 26,
                  height: 26,
                  color: '#FFFFFF',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  flexShrink: 0,
                  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.32)';
                  e.currentTarget.style.transform = 'scale(1.08)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.18)';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
                aria-label="ย่อแถบเมนู"
                title="ย่อแถบเมนู"
              >
                <ChevronLeft size={16} strokeWidth={2.4} />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={handleToggleSidebar}
              style={{
                background: 'rgba(255, 255, 255, 0.15)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                padding: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '12px',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.08)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.28)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
              }}
              aria-label="ขยายแถบเมนู"
              title="คลิกเพื่อขยายแถบเมนู"
            >
              <img src={horcareLogo} alt="HorCare" style={{ width: 32, height: 32, objectFit: 'contain' }} />
            </button>
          )}
        </div>

        {/* Building Switcher — Plus/Pro (multiple buildings) */}
        {!sidebarCollapsed && canAddBuilding && (
          <div ref={buildingMenuRef} className="sidebar-building-switcher" style={{ position: 'relative', padding: '0 var(--space-3)', marginBottom: 'var(--space-2)' }}>
            <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'stretch' }}>
            <button
              onClick={goToBranchSelector}
              title="เลือก/สลับสาขา"
              style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.5rem',
                background: 'rgba(255, 255, 255, 0.18)', border: '1px solid rgba(255, 255, 255, 0.35)',
                borderRadius: '12px', padding: '0.55rem 0.75rem', cursor: 'pointer',
                color: '#FFFFFF', fontSize: '0.85rem', fontWeight: 700,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              <Building2 size={15} style={{ flexShrink: 0, color: '#BAE6FD' }} />
              <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeBuilding?.name ?? '—'}
              </span>
              <ChevronDown size={14} style={{ flexShrink: 0, color: '#BAE6FD', transform: 'rotate(-90deg)' }} />
            </button>
            {/* Manage branches (rename / delete / add) — the old dropdown, kept reachable. */}
            <button
              type="button"
              onClick={() => setBuildingMenuOpen(v => !v)}
              aria-expanded={buildingMenuOpen}
              title="จัดการสาขา (เปลี่ยนชื่อ / ลบ / เพิ่ม)"
              style={{
                flexShrink: 0, width: 38, background: 'rgba(255, 255, 255, 0.18)',
                border: '1px solid rgba(255, 255, 255, 0.35)', borderRadius: '12px', color: '#BAE6FD',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Pencil size={15} />
            </button>
            </div>

            {buildingMenuOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 'var(--space-3)', right: 'var(--space-3)',
                background: '#0369A1', border: '1.5px solid rgba(255,255,255,0.3)',
                borderRadius: '12px', overflow: 'hidden', zIndex: 200,
                boxShadow: '0 12px 32px rgba(0,0,0,0.3)',
              }}>
                <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                  {buildings.map(b => (
                    <div
                      key={b.id}
                      style={{
                        display: 'flex', alignItems: 'center',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                        background: b.id === activeBuildingId ? 'rgba(255,255,255,0.18)' : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      {renamingBuildingId === b.id ? (
                        <form
                          style={{ flex: 1, display: 'flex', gap: '0.375rem', padding: '0.5rem 0.625rem', alignItems: 'center' }}
                          onSubmit={e => { e.preventDefault(); handleRenameBuilding(b.id); }}
                        >
                          <input
                            autoFocus
                            value={renamingName}
                            onChange={e => setRenamingName(e.target.value)}
                            style={{
                              flex: 1, background: 'rgba(255, 255, 255, 0.22)',
                              border: '1.5px solid rgba(255, 255, 255, 0.65)',
                              borderRadius: '8px', color: '#FFFFFF', fontWeight: 600,
                              fontSize: '0.875rem', padding: '0.45rem 0.6rem',
                              outline: 'none',
                              boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.15)',
                            }}
                          />
                          <button
                            type="submit"
                            title="บันทึก"
                            style={{
                              flexShrink: 0,
                              background: '#10B981', border: 'none', color: '#FFFFFF',
                              borderRadius: '8px', cursor: 'pointer', width: 32, height: 32,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              boxShadow: '0 2px 8px rgba(16, 185, 129, 0.4)',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.background = '#059669'; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = '#10B981'; }}
                          >
                            <Check size={16} strokeWidth={3} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingBuildingId(null)}
                            title="ยกเลิก"
                            style={{
                              flexShrink: 0,
                              background: '#EF4444', border: 'none', color: '#FFFFFF',
                              borderRadius: '8px', cursor: 'pointer', width: 32, height: 32,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.background = '#DC2626'; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = '#EF4444'; }}
                          >
                            <X size={16} strokeWidth={3} />
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            onClick={() => handleSwitchBuilding(b.id)}
                            style={{
                              flex: 1, textAlign: 'left', background: 'none', border: 'none',
                              color: '#FFFFFF',
                              fontSize: '0.875rem', fontWeight: b.id === activeBuildingId ? 700 : 500,
                              padding: '0.65rem 0.875rem', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: '0.625rem', minHeight: '44px',
                            }}
                          >
                            {b.id === activeBuildingId ? (
                              <Check size={16} color="#38BDF8" style={{ flexShrink: 0 }} />
                            ) : (
                              <span style={{ width: 16, flexShrink: 0 }} />
                            )}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {b.name}
                            </span>
                          </button>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', paddingRight: '0.5rem' }}>
                            <button
                              onClick={() => { setRenamingBuildingId(b.id); setRenamingName(b.name); }}
                              style={{
                                background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)',
                                cursor: 'pointer', width: 32, height: 32, borderRadius: 6,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}
                              title="เปลี่ยนชื่อ"
                            >
                              <Pencil size={15} />
                            </button>
                            {buildings.length > 1 && (
                              <button
                                onClick={() => setDeleteBuildingConfirm(b.id)}
                                style={{
                                  background: 'none', border: 'none', color: 'rgba(254,202,202,0.95)',
                                  cursor: 'pointer', width: 32, height: 32, borderRadius: 6,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                                title="ลบตึก"
                              >
                                <TrashIcon size={15} />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', padding: '0.625rem 0.75rem', background: 'rgba(0,0,0,0.12)' }}>
                  {buildings.length >= maxBuildings ? (
                    <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', padding: '0.25rem', display: 'block', textAlign: 'center' }}>
                      ครบ {maxBuildings} สาขาแล้วตามแพ็กเกจ
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        setBuildingMenuOpen(false);
                        setIsAddBuildingModalOpen(true);
                      }}
                      style={{
                        width: '100%', background: 'rgba(255,255,255,0.12)', border: '1.5px dashed rgba(255,255,255,0.4)',
                        borderRadius: '10px', color: '#FFFFFF', fontSize: '0.85rem', fontWeight: 600,
                        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: '0.5rem', padding: '0.625rem 0.75rem', transition: 'all 0.15s ease',
                      }}
                    >
                      <Plus size={16} /> เพิ่มสาขาใหม่
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Single Building Name Bar — Start plan (1 building, no switcher) */}
        {!sidebarCollapsed && !canAddBuilding && activeBuilding && (
          <div className="sidebar-building-switcher" style={{ padding: '0 var(--space-3)', marginBottom: 'var(--space-2)' }}>
            {renamingBuildingId === activeBuilding.id ? (
              <form
                style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}
                onSubmit={e => { e.preventDefault(); handleRenameBuilding(activeBuilding.id); }}
              >
                <input
                  autoFocus
                  value={renamingName}
                  onChange={e => setRenamingName(e.target.value)}
                  placeholder="ชื่อหอพัก"
                  style={{
                    flex: 1, background: 'rgba(255, 255, 255, 0.22)',
                    border: '1.5px solid rgba(255, 255, 255, 0.65)',
                    borderRadius: '8px', color: '#FFFFFF', fontWeight: 600,
                    fontSize: '0.875rem', padding: '0.45rem 0.65rem',
                    outline: 'none', minWidth: 0,
                    boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.15)',
                  }}
                />
                <button
                  type="submit"
                  title="บันทึก"
                  style={{
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32,
                    background: '#10B981',
                    border: 'none',
                    borderRadius: '8px', color: '#FFFFFF',
                    cursor: 'pointer', transition: 'all 0.15s ease',
                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.4)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.background = '#059669'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = '#10B981'; }}
                >
                  <Check size={16} strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingBuildingId(null)}
                  title="ยกเลิก"
                  style={{
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32,
                    background: '#EF4444',
                    border: 'none',
                    borderRadius: '8px', color: '#FFFFFF',
                    cursor: 'pointer', transition: 'all 0.15s ease',
                    boxShadow: '0 2px 8px rgba(239, 68, 68, 0.4)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.06)'; e.currentTarget.style.background = '#DC2626'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.background = '#EF4444'; }}
                >
                  <X size={16} strokeWidth={3} />
                </button>
              </form>
            ) : (
              <button
                onClick={() => { setRenamingBuildingId(activeBuilding.id); setRenamingName(activeBuilding.name); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '0.5rem',
                  background: 'rgba(255, 255, 255, 0.18)', border: '1.5px solid rgba(255, 255, 255, 0.35)',
                  borderRadius: '12px', padding: '0.55rem 0.75rem', cursor: 'pointer',
                  color: '#FFFFFF', fontSize: '0.85rem', fontWeight: 700,
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                  backdropFilter: 'blur(8px)',
                }}
                title="คลิกเพื่อเปลี่ยนชื่อหอพัก"
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#10B981', boxShadow: '0 0 6px #10B981', flexShrink: 0 }} />
                <Building2 size={15} style={{ flexShrink: 0, color: '#BAE6FD' }} />
                <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeBuilding.name}
                </span>
                <Pencil size={12} style={{ flexShrink: 0, color: 'rgba(255, 255, 255, 0.75)' }} />
              </button>
            )}
          </div>
        )}


        <nav className="sidebar-nav">
          {maidSession
            ? visibleNavItems.map(item => renderNavItem(item))
            : navGroups.map(group => {
                // A category with a single page is shown as a plain item (e.g. Dashboard).
                if (group.items.length === 1) return renderNavItem(group.items[0]);
                const GroupIcon = NAV_GROUP_ICONS[group.id] ?? SettingsIcon;
                // A collapsed sidebar shows only icons, so every page stays reachable.
                const open = sidebarCollapsed || isGroupOpen(group.id, activeNavGroupId, navGroupState, transientClose, currentView);
                const hasActive = group.id === activeNavGroupId;
                const groupBadge = group.items.reduce((n, i) => n + badgeOf(i.id), 0);
                return (
                  <div key={group.id} className="nav-group">
                    <button
                      type="button"
                      className={`nav-item nav-group-header ${hasActive ? 'has-active' : ''}`}
                      aria-expanded={open}
                      onClick={() => toggleNavGroup(group.id)}
                    >
                      <GroupIcon size={20} />
                      <span className="nav-label">{group.label}</span>
                      {!open && groupBadge > 0 && (
                        <span className="nav-item-badge" style={{
                          marginLeft: 'auto', minWidth: 18, height: 18, borderRadius: 9, background: '#EF4444',
                          color: '#fff', fontSize: '0.6875rem', fontWeight: 700, display: 'inline-flex',
                          alignItems: 'center', justifyContent: 'center', padding: '0 5px',
                        }}>{groupBadge > 99 ? '99+' : groupBadge}</span>
                      )}
                      <ChevronDown
                        size={16}
                        className="nav-group-chevron"
                        style={{ marginLeft: !open && groupBadge > 0 ? 6 : 'auto', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}
                      />
                    </button>
                    {open && <div className="nav-subitems">{group.items.map(i => renderNavItem(i, true))}</div>}
                  </div>
                );
              })}
        </nav>

        {/* Upgrade nudge for free users */}
        {profile?.license === 'free' && !hasPaidSubscription && (
          <button
            className="sidebar-upgrade-nudge"
            onClick={() => handleNavClick('pricing')}
            style={{
              margin: 'var(--space-4) var(--space-3) 0',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.22), rgba(255,255,255,0.12))',
              border: '1.5px solid rgba(255,255,255,0.35)',
              borderRadius: '12px',
              padding: '0.75rem',
              cursor: 'pointer', textAlign: 'left', width: 'calc(100% - calc(var(--space-3) * 2))',
              color: '#FFFFFF',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <Zap size={14} color="#FDE047" />
              <span style={{ fontWeight: 800, fontSize: '0.8125rem', color: '#FFFFFF' }}>อัปเกรดแผน</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.85)', fontWeight: 600, lineHeight: 1.4 }}>
              HorCare ฿399/เดือน · ฟีเจอร์ครบ
            </div>
          </button>
        )}

        {/* User info + logout */}
        <div className="sidebar-user-info" style={{
          marginTop: 'auto',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid rgba(255,255,255,0.2)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: sidebarCollapsed ? 'center' : 'stretch',
        }}>
          {!sidebarCollapsed && (
            <div style={{
              color: '#FFFFFF',
              fontWeight: 700,
              fontSize: '0.8125rem',
              marginBottom: 'var(--space-2)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {maidSession ? `แม่บ้าน: ${maidSession.maid_name}` : (profile?.display_name || user?.email)}
            </div>
          )}

          {/* Install PWA Button (only when in web browser) */}
          {!isStandalone && (
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('open-pwa-install'))}
              title="ติดตั้งแอป HorCare"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                gap: '0.625rem',
                width: sidebarCollapsed ? '42px' : '100%',
                height: sidebarCollapsed ? '42px' : 'auto',
                padding: sidebarCollapsed ? '0' : '0.6rem 0.85rem',
                marginBottom: '0.5rem',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.12) 100%)',
                border: '1px solid rgba(255,255,255,0.35)',
                color: '#FFFFFF',
                fontSize: '0.825rem',
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                flexShrink: 0,
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.3)';
                (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.12) 100%)';
                (e.currentTarget as HTMLButtonElement).style.transform = 'none';
              }}
            >
              <Smartphone size={17} style={{ flexShrink: 0, color: '#FDE047' }} />
              {!sidebarCollapsed && <span>ติดตั้งแอป HorCare</span>}
            </button>
          )}

          {/* LINE Contact Button */}
          <a
            href="https://lin.ee/sBZQ5CF"
            target="_blank"
            rel="noopener noreferrer"
            title="ติดต่อฝ่ายบริการ (LINE Support)"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              gap: '0.625rem',
              width: sidebarCollapsed ? '42px' : '100%',
              height: sidebarCollapsed ? '42px' : 'auto',
              padding: sidebarCollapsed ? '0' : '0.6rem 0.85rem',
              marginBottom: '0.5rem',
              borderRadius: '12px',
              background: '#FFFFFF',
              border: 'none',
              color: '#15803D',
              fontSize: '0.825rem',
              fontWeight: 700,
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLAnchorElement).style.background = '#F0FDF4';
              (e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 6px 18px rgba(0,0,0,0.15)';
              (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLAnchorElement).style.background = '#FFFFFF';
              (e.currentTarget as HTMLAnchorElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
              (e.currentTarget as HTMLAnchorElement).style.transform = 'none';
            }}
          >
            {/* LINE icon SVG */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="#16A34A" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.627.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.281.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"/>
            </svg>
            {!sidebarCollapsed && <span>ติดต่อฝ่ายบริการ</span>}
          </a>

          <button
            className="nav-item"
            onClick={maidSession ? handleMaidLogout : logout}
            style={{
              color: 'rgba(255,255,255,0.95)',
              fontWeight: 700,
              justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
              width: sidebarCollapsed ? '42px' : '100%',
              height: sidebarCollapsed ? '42px' : 'auto',
              padding: sidebarCollapsed ? '0' : '0.55rem 0.85rem',
              margin: '0',
            }}
            title="ออกจากระบบ"
          >
            <LogOut size={18} style={{ color: '#BAE6FD' }} />
            {!sidebarCollapsed && <span>ออกจากระบบ</span>}
          </button>
          {!sidebarCollapsed && (
            <div className="app-version" style={{
              color: 'rgba(255,255,255,0.75)',
              fontWeight: 600,
              fontSize: '0.6875rem',
              marginTop: 'var(--space-2)'
            }}>
              HorCare Property Care
            </div>
          )}
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
      <main className={`main-content ${sidebarCollapsed ? 'collapsed' : ''}`}>
        {/* Browser Notification Permission Banner */}
        {user && notifPermission === 'default' && !dismissedNotifBanner && (
          <div style={{
            background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.1), rgba(16, 185, 129, 0.08))',
            border: '1px solid rgba(14, 165, 233, 0.25)',
            borderRadius: '14px',
            padding: '0.75rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            boxShadow: '0 4px 16px rgba(14, 165, 233, 0.08)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1, minWidth: '220px' }}>
              <div style={{
                width: 36, height: 36, borderRadius: '10px',
                background: 'rgba(14, 165, 233, 0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Bell size={18} color="#0EA5E9" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--color-text)' }}>
                  เปิดรับการแจ้งเตือนจากเบราว์เซอร์
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-gray-500)', lineHeight: 1.4 }}>
                  เพื่อให้ระบบเตือนทันทีเมื่อมีสลิปใหม่หรือลูกหอแจ้งซ่อม
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              <button
                onClick={async () => {
                  await requestNotifPermission();
                }}
                className="btn btn-primary btn-sm"
                style={{
                  padding: '0.45rem 1rem',
                  fontSize: '0.8125rem',
                  borderRadius: '10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
              >
                <Bell size={14} /> เปิดแจ้งเตือน
              </button>
              <button
                onClick={() => {
                  setDismissedNotifBanner(true);
                  sessionStorage.setItem('horcare_dismiss_notif_banner', 'true');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-gray-400)',
                  cursor: 'pointer',
                  padding: '0.35rem',
                  display: 'flex',
                  alignItems: 'center',
                  borderRadius: '6px',
                }}
                aria-label="ปิดการแจ้งเตือนนี้"
                title="ปิดชั่วคราว"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}
      <Suspense fallback={<PageLoader />}>
        {currentView === 'dashboard' && (
          <Dashboard
            config={config}
            stats={stats}
            currentMonth={currentMonth}
            recentBills={monthBills}
            allBills={bills}
            rooms={rooms}
            onUpdateRoom={updateRoom}
            uid={user?.uid}
            buildingId={activeBuildingId ?? undefined}
            buildingName={activeBuilding?.name}
            onGoToPayments={() => setCurrentView('payments')}
            license={profile?.license}
            onUpgrade={() => setCurrentView('pricing')}
          />
        )}

        {currentView === 'rooms' && (
          <RoomManagement
            rooms={rooms}
            config={config}
            commonFees={commonFees}
            onAddRoom={addRoom}
            onBulkCreate={addRoomsBulk}
            onSaveConfig={saveConfig}
            onUpdateRoom={updateRoom}
            onDeleteRoom={deleteRoom}
            maxRooms={maxRooms}
            isTrial={profile?.license === 'free'}
            onUpgrade={() => setCurrentView('pricing')}
            uid={user?.uid}
            buildingId={activeBuildingId ?? undefined}
            isPaid={hasPaidSubscription}
          />
        )}

        {currentView === 'tenants' && user && activeBuildingId && (
          <TenantsPage
            rooms={rooms}
            uid={user.uid}
            buildingId={activeBuildingId}
            isPaid={hasPaidSubscription}
            onUpgrade={() => setCurrentView('pricing')}
            onUpdateRoom={updateRoom}
            buildingType={config?.building_type}
            config={config}
          />
        )}

        {currentView === 'maintenance' && user && activeBuildingId && (
          <MaintenancePage
            uid={user.uid}
            buildingId={activeBuildingId}
          />
        )}

        {currentView === 'cleaning' && (
          maidSession ? (
            <MaidPortalView
              session={maidSession}
              buildingName={activeBuilding?.name}
              onGoToRecording={() => setCurrentView('recording')}
              onLogout={handleMaidLogout}
            />
          ) : (
            user && activeBuildingId && hasPaidSubscription && (
              <CleaningPage
                uid={user.uid}
                buildingId={activeBuildingId}
              />
            )
          )
        )}

        {currentView === 'operations' && user && activeBuildingId && (
          <OperationsPage
            uid={user.uid}
            buildingId={activeBuildingId}
            rooms={rooms}
            lowStockCount={lowStockCount}
            fines={fines}
            commonFees={commonFees}
            onAddFine={addFine}
            onUpdateFine={updateFine}
            onDeleteFine={deleteFine}
            onAddCommonFee={addCommonFee}
            onUpdateCommonFee={updateCommonFee}
            onDeleteCommonFee={deleteCommonFee}
          />
        )}

        {currentView === 'recording' && (
          <MeterRecording
            rooms={rooms}
            config={config}
            commonFees={commonFees}
            currentMonth={currentMonth}
            onSaveBill={saveBill}
            getBillForRoom={getBillForRoom}
            getPreviousBill={getPreviousBill}
            onMonthChange={handleMonthChange}
            buildingId={activeBuildingId ?? undefined}
            canUseMeterPhoto={isPlusOrAbove(profile?.license ?? 'free')}
            ownerUid={maidSession ? undefined : user?.uid}
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
            canSendLine={lineEnabled}
            onUpgrade={() => setCurrentView('pricing')}
          />
        )}

        {currentView === 'archives' && (
          <DocumentArchive
            bills={bills}
            rooms={rooms}
            config={config}
            isPaid={hasPaidSubscription}
            onUpgrade={() => setCurrentView('pricing')}
          />
        )}

        {currentView === 'payments' && (
          <PaymentsPage
            bills={bills}
            rooms={rooms}
            config={config}
            currentMonth={currentMonth}
            onMonthChange={handleMonthChange}
            onUpdatePayment={updateBillPayment}
            uid={user?.uid}
            buildingId={activeBuildingId ?? undefined}
          />
        )}



        {currentView === 'announcements' && user && activeBuildingId && !maidSession && (
          <AnnouncementsPage ownerUid={user.uid} buildingId={activeBuildingId} />
        )}

        {currentView === 'messages' && user && activeBuildingId && !maidSession && (
          <MessagesPage
            ownerUid={user.uid}
            buildingId={activeBuildingId}
            unitName={terms.unitName}
            threads={lineThreads}
            loading={threadsLoading}
            error={threadsError}
          />
        )}

        {currentView === 'workorders' && user && activeBuildingId && !maidSession && (
          <WorkOrdersPage
            ownerUid={user.uid}
            buildingId={activeBuildingId}
            rooms={rooms}
            unitName={terms.unitName}
          />
        )}

        {currentView === 'parcels' && user && activeBuildingId && !maidSession && (
          <ParcelsPage
            ownerUid={user.uid}
            buildingId={activeBuildingId}
            rooms={rooms}
            unitName={terms.unitName}
          />
        )}

        {currentView === 'security' && user && !maidSession && (
          <SecurityPage
            ownerUid={user.uid}
            buildings={buildings}
            config={config}
            onSaveConfig={saveConfig}
          />
        )}

        {currentView === 'settings' && (
          <Settings
            config={config}
            onSaveConfig={saveConfig}
            themeId={themeId}
            onSetTheme={setTheme}
            mode={mode}
            onSetMode={setMode}
            emailVerified={emailVerified}
            userEmail={user?.email ?? ''}
            onSendVerifyEmail={sendVerifyEmailViaResend}
            onRefreshEmailVerified={refreshEmailVerified}
            isPaid={hasPaidSubscription}
            onUpgrade={() => setCurrentView('pricing')}
            uid={user?.uid}
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
      </Suspense>
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

      {/* Feature locked modal (payments / tenants / maintenance / operations) */}
      {showFeatureLockedModal && (
        <FeatureLockedModal
          featureName={showFeatureLockedModal}
          onClose={() => setShowFeatureLockedModal(null)}
          onUpgrade={() => {
            setShowFeatureLockedModal(null);
            setCurrentView('pricing');
          }}
        />
      )}

      {/* Delete Building Confirm Modal */}
      {deleteBuildingConfirm && (() => {
        const b = buildings.find(x => x.id === deleteBuildingConfirm);
        if (!b) return null;
        return (
          <div
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(4px)',
              zIndex: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '1rem',
            }}
            onClick={() => setDeleteBuildingConfirm(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                maxWidth: '380px', width: '100%', background: '#fff',
                borderRadius: '20px', overflow: 'hidden',
                boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
              }}
            >
              <div style={{
                background: 'linear-gradient(135deg, #DC2626, #EF4444)',
                padding: '1.75rem 1.5rem', textAlign: 'center',
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 0.75rem',
                }}>
                  <TrashIcon size={28} color="#fff" />
                </div>
                <h3 style={{ color: '#fff', fontWeight: 800, fontSize: '1.1rem', margin: '0 0 0.25rem' }}>
                  ลบตึก "{b.name}"?
                </h3>
                <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.8125rem', margin: 0 }}>
                  ข้อมูลทั้งหมดในตึกนี้จะถูกลบ และไม่สามารถย้อนกลับได้
                </p>
              </div>
              <div style={{ padding: '1.25rem 1.5rem', display: 'flex', gap: '0.75rem' }}>
                <button
                  onClick={() => setDeleteBuildingConfirm(null)}
                  style={{
                    flex: 1, padding: '0.75rem', borderRadius: '10px',
                    background: 'none', border: '1px solid #E5E7EB',
                    cursor: 'pointer', fontWeight: 600, color: '#6B7280',
                  }}
                >
                  ยกเลิก
                </button>
                <button
                  onClick={() => handleDeleteBuilding(deleteBuildingConfirm)}
                  style={{
                    flex: 2, padding: '0.75rem', borderRadius: '10px',
                    background: 'linear-gradient(135deg, #DC2626, #EF4444)',
                    border: 'none', cursor: 'pointer',
                    fontWeight: 700, color: '#fff', fontSize: '0.9rem',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    boxShadow: '0 4px 16px rgba(220,38,38,0.4)',
                  }}
                >
                  <TrashIcon size={16} /> ลบตึก
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Add Building / Branch Modal */}
      <AddBuildingModal
        isOpen={isAddBuildingModalOpen}
        onClose={() => setIsAddBuildingModalOpen(false)}
        onAdd={handleAddBuildingSubmit}
      />
    </div>

  );
}

export default App;
