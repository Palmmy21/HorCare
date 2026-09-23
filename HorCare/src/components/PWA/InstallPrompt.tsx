import { useState, useEffect, useCallback } from 'react';
import { Download, X, Share, PlusSquare, CheckCircle2, Copy, MoreVertical, Smartphone, Monitor, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import horcareLogo from '../../assets/horcare_logo.png';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Check if the app is currently running as an installed standalone PWA */
export function isPWAStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.includes('android-app://')
  );
}

/** Detect iOS devices (iPhone, iPod, iPad, including iPadOS 13+ desktop-mode user agent) */
export function isIOSDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const isIOSPlatform = /iPad|iPhone|iPod/.test(ua);
  const isIPadOS = (window.navigator.platform === 'MacIntel' || ua.includes('Macintosh')) && window.navigator.maxTouchPoints > 1;
  return (isIOSPlatform || isIPadOS) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

/** Detect Android devices */
export function isAndroidDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android/i.test(window.navigator.userAgent);
}

/** Detect in-app webviews like LINE, Facebook, Messenger, Instagram, TikTok, etc. */
export function isInAppBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || window.navigator.vendor || '';
  return (
    /Line\/|FBAN|FBAV|Instagram|TikTok|musical_ly|ByteLocale|MicroMessenger|Snapchat/i.test(ua) ||
    (/Android/i.test(ua) && /Version\/[\d.]+/i.test(ua) && !/Chrome\/[\d.]+\s+Mobile/i.test(ua))
  );
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    return (window as unknown as { __pwaInstallPrompt?: BeforeInstallPromptEvent | null }).__pwaInstallPrompt || null;
  });
  const [showBanner, setShowBanner] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'ios' | 'android' | 'inapp' | 'desktop'>('android');
  const [installing, setInstalling] = useState(false);

  const isIOS = isIOSDevice();
  const isAndroid = isAndroidDevice();
  const inApp = isInAppBrowser();

  // Determine the best initial guide tab based on device
  const getInitialTab = useCallback((): 'ios' | 'android' | 'inapp' | 'desktop' => {
    if (inApp) return 'inapp';
    if (isIOS) return 'ios';
    if (isAndroid) return 'android';
    return 'desktop';
  }, [inApp, isIOS, isAndroid]);

  // Check if banner should show (skip if standalone or dismissed within 2 days)
  const checkShouldShow = useCallback(() => {
    if (isPWAStandalone()) return false;

    const dismissedTime = localStorage.getItem('pwa_install_dismissed_time');
    if (dismissedTime) {
      const elapsedDays = (Date.now() - parseInt(dismissedTime, 10)) / (1000 * 60 * 60 * 24);
      if (elapsedDays < 2) return false;
    }
    return true;
  }, []);

  useEffect(() => {
    if (isPWAStandalone()) return;

    setActiveTab(getInitialTab());

    // If on iOS or in-app browser, delay banner display slightly
    if (isIOS || inApp) {
      if (checkShouldShow()) {
        const timer = setTimeout(() => setShowBanner(true), 2500);
        return () => clearTimeout(timer);
      }
      return;
    }

    // Check if prompt was already captured before this component mounted
    const existingPrompt = (window as unknown as { __pwaInstallPrompt?: BeforeInstallPromptEvent | null }).__pwaInstallPrompt;
    if (existingPrompt) {
      setDeferredPrompt(existingPrompt);
      if (checkShouldShow()) {
        setShowBanner(true);
      }
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      const customEvt = e as CustomEvent<BeforeInstallPromptEvent>;
      const prompt = customEvt.detail || (e as BeforeInstallPromptEvent);
      (window as unknown as { __pwaInstallPrompt?: BeforeInstallPromptEvent }).__pwaInstallPrompt = prompt;
      setDeferredPrompt(prompt);
      if (checkShouldShow()) {
        setShowBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('pwa-prompt-available', onPrompt);

    // Allow manual trigger from sidebar / settings:
    const manualOpenHandler = async () => {
      const prompt = (window as unknown as { __pwaInstallPrompt?: BeforeInstallPromptEvent | null }).__pwaInstallPrompt || deferredPrompt;
      
      // If we have a native prompt on Android/desktop, trigger it directly
      if (prompt && !isIOS && !inApp) {
        try {
          await prompt.prompt();
          const { outcome } = await prompt.userChoice;
          if (outcome === 'accepted') {
            toast.success('กำลังติดตั้ง HorCare ลงในอุปกรณ์ของคุณ...');
            setShowBanner(false);
            setDeferredPrompt(null);
            (window as unknown as { __pwaInstallPrompt?: null }).__pwaInstallPrompt = null;
            return;
          }
        } catch (err) {
          console.error('[PWA] Prompt error:', err);
        }
      }

      // Otherwise, open the comprehensive guide modal tailored to user's device
      setActiveTab(getInitialTab());
      setShowGuideModal(true);
    };

    window.addEventListener('open-pwa-install', manualOpenHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('pwa-prompt-available', onPrompt);
      window.removeEventListener('open-pwa-install', manualOpenHandler);
    };
  }, [checkShouldShow, deferredPrompt, isIOS, inApp, getInitialTab]);

  const handleInstallClick = async () => {
    // 1. In-App browser: must open in external browser first
    if (inApp) {
      setActiveTab('inapp');
      setShowGuideModal(true);
      return;
    }

    // 2. iOS: cannot trigger programmatic prompt, must guide user
    if (isIOS) {
      setActiveTab('ios');
      setShowGuideModal(true);
      return;
    }

    // 3. Android / Desktop with available deferredPrompt
    const prompt = deferredPrompt || (window as unknown as { __pwaInstallPrompt?: BeforeInstallPromptEvent | null }).__pwaInstallPrompt;

    if (prompt) {
      setInstalling(true);
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
          toast.success('กำลังติดตั้ง HorCare ลงในอุปกรณ์ของคุณ 🎉');
          setShowBanner(false);
          setDeferredPrompt(null);
          (window as unknown as { __pwaInstallPrompt?: null }).__pwaInstallPrompt = null;
        } else {
          toast('คุณสามารถติดตั้งได้ตลอดเวลาจากเมนู', { icon: 'ℹ️' });
        }
      } catch (err) {
        console.error('[PWA] Install error:', err);
        setActiveTab(isAndroid ? 'android' : 'desktop');
        setShowGuideModal(true);
      } finally {
        setInstalling(false);
      }
      return;
    }

    // 4. Android / Desktop without deferredPrompt (browser delayed or dismissed prompt)
    // NEVER simply close the banner! Show the visual installation guide instead.
    setActiveTab(isAndroid ? 'android' : 'desktop');
    setShowGuideModal(true);
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      toast.success('คัดลอกลิงก์แล้ว! เปิด Safari หรือ Chrome แล้ววางลิงก์ได้เลย');
    } catch {
      toast.error('ไม่สามารถคัดลอกลิงก์ได้ กรุณาคัดลอก URL ด้านบน');
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('pwa_install_dismissed_time', Date.now().toString());
  };

  if (isPWAStandalone()) return null;

  return (
    <>
      {/* Bottom Floating Prompt Banner */}
      {showBanner && (
        <div className="install-prompt-wrapper">
          <div className="install-prompt-card">
            {/* App Icon */}
            <div className="install-prompt-logo-box">
              <img src={horcareLogo} alt="HorCare" className="install-prompt-logo-img" />
            </div>

            {/* Info */}
            <div className="install-prompt-info">
              <div className="install-prompt-badge">
                <CheckCircle2 size={12} color="#10B981" />
                <span>แอปพลิเคชันทางการ</span>
              </div>
              <div className="install-prompt-title">ติดตั้ง HorCare</div>
              <div className="install-prompt-desc">
                {isIOS
                  ? 'เพิ่มลงหน้าจอโฮม ใช้งานเร็วเหมือนแอปแท้'
                  : inApp
                  ? 'เปิดในเบราว์เซอร์เพื่อติดตั้งแอป'
                  : 'เปิดใช้งานเร็วขึ้น ลื่นไหล ไม่ต้องเข้าเว็บ'}
              </div>
            </div>

            {/* Actions */}
            <div className="install-prompt-actions">
              <button
                onClick={handleInstallClick}
                disabled={installing}
                className="install-prompt-btn-install"
              >
                <Download size={14} />
                <span>
                  {installing
                    ? 'กำลังติดตั้ง...'
                    : isIOS || inApp || !deferredPrompt
                    ? 'วิธีติดตั้ง'
                    : 'ติดตั้ง'}
                </span>
              </button>
              <button
                onClick={handleDismiss}
                className="install-prompt-btn-close"
                title="ไว้คราวหลัง"
                aria-label="ปิดการแจ้งเตือนติดตั้ง"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Universal Step-by-Step Installation Modal */}
      {showGuideModal && (
        <div className="modal-overlay" onClick={() => setShowGuideModal(false)} style={{ zIndex: 10000 }}>
          <div
            className="modal"
            style={{
              maxWidth: '430px',
              width: '92%',
              padding: '1.25rem',
              borderRadius: '24px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <img src={horcareLogo} alt="HorCare" style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'contain' }} />
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-gray-900)' }}>
                    ติดตั้งแอป HorCare
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-500)', fontWeight: 500 }}>
                    รองรับทั้ง iOS, Android และ คอมพิวเตอร์
                  </div>
                </div>
              </div>
              <button className="btn-icon" onClick={() => setShowGuideModal(false)} aria-label="ปิด">
                <X size={18} />
              </button>
            </div>

            {/* Platform Selection Tabs */}
            <div style={{
              display: 'flex',
              gap: '0.35rem',
              background: 'var(--color-gray-100)',
              padding: '4px',
              borderRadius: '14px',
              marginBottom: '1rem',
              overflowX: 'auto',
            }}>
              <button
                type="button"
                onClick={() => setActiveTab('ios')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  padding: '0.45rem 0.6rem',
                  borderRadius: '10px',
                  border: 'none',
                  fontSize: '0.78rem',
                  fontWeight: activeTab === 'ios' ? 700 : 500,
                  background: activeTab === 'ios' ? '#FFFFFF' : 'transparent',
                  color: activeTab === 'ios' ? '#0F172A' : 'var(--color-gray-600)',
                  boxShadow: activeTab === 'ios' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                <Smartphone size={13} color={activeTab === 'ios' ? '#0284C7' : 'currentColor'} />
                iPhone / iPad
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('android')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  padding: '0.45rem 0.6rem',
                  borderRadius: '10px',
                  border: 'none',
                  fontSize: '0.78rem',
                  fontWeight: activeTab === 'android' ? 700 : 500,
                  background: activeTab === 'android' ? '#FFFFFF' : 'transparent',
                  color: activeTab === 'android' ? '#0F172A' : 'var(--color-gray-600)',
                  boxShadow: activeTab === 'android' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                <Smartphone size={13} color={activeTab === 'android' ? '#10B981' : 'currentColor'} />
                Android
              </button>

              {inApp && (
                <button
                  type="button"
                  onClick={() => setActiveTab('inapp')}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.35rem',
                    padding: '0.45rem 0.6rem',
                    borderRadius: '10px',
                    border: 'none',
                    fontSize: '0.78rem',
                    fontWeight: activeTab === 'inapp' ? 700 : 500,
                    background: activeTab === 'inapp' ? '#FFFFFF' : 'transparent',
                    color: activeTab === 'inapp' ? '#E11D48' : 'var(--color-gray-600)',
                    boxShadow: activeTab === 'inapp' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <AlertTriangle size={13} color="#E11D48" />
                  เปิดใน LINE
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTab('desktop')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.35rem',
                  padding: '0.45rem 0.6rem',
                  borderRadius: '10px',
                  border: 'none',
                  fontSize: '0.78rem',
                  fontWeight: activeTab === 'desktop' ? 700 : 500,
                  background: activeTab === 'desktop' ? '#FFFFFF' : 'transparent',
                  color: activeTab === 'desktop' ? '#0F172A' : 'var(--color-gray-600)',
                  boxShadow: activeTab === 'desktop' ? '0 2px 6px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                <Monitor size={13} color={activeTab === 'desktop' ? '#6366F1' : 'currentColor'} />
                คอมพิวเตอร์
              </button>
            </div>

            {/* TAB CONTENT: iOS (Safari) */}
            {activeTab === 'ios' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{
                  padding: '0.65rem 0.85rem',
                  background: 'rgba(2, 132, 199, 0.08)',
                  borderRadius: '12px',
                  border: '1px solid rgba(2, 132, 199, 0.2)',
                  fontSize: '0.8rem',
                  color: '#0369A1',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}>
                  <Share size={15} color="#0284C7" />
                  <span>ระบบ iOS ต้องเปิดผ่าน <strong>Safari</strong> เพื่อติดตั้งแอป</span>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(14, 165, 233, 0.15)',
                    color: '#0284C7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    1
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    กดปุ่ม <strong>แชร์</strong> (<Share size={14} style={{ verticalAlign: '-2px', display: 'inline', color: '#0284C7' }} /> ไอคอนกล่องสี่เหลี่ยมลูกศรชี้ขึ้น) ที่แถบเมนูด้านล่างของ Safari
                  </div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(14, 165, 233, 0.15)',
                    color: '#0284C7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    2
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    เลื่อนหน้าต่างขึ้นแล้วกดเลือก <PlusSquare size={14} style={{ verticalAlign: '-2px', display: 'inline', color: '#10B981' }} /> <strong>"เพิ่มไปยังหน้าจอโฮม"</strong> (Add to Home Screen)
                  </div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(14, 165, 233, 0.15)',
                    color: '#0284C7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    3
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    กดปุ่ม <strong>"เพิ่ม"</strong> (Add) ที่มุมบนขวา แอปจะไปอยู่ที่หน้าจอมือถือของคุณทันที
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: Android (Chrome) */}
            {activeTab === 'android' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {deferredPrompt && (
                  <button
                    onClick={handleInstallClick}
                    disabled={installing}
                    style={{
                      width: '100%',
                      padding: '0.75rem 1rem',
                      borderRadius: '14px',
                      background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                      color: '#FFFFFF',
                      border: 'none',
                      fontWeight: 800,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                      marginBottom: '0.25rem',
                    }}
                  >
                    <Download size={16} />
                    {installing ? 'กำลังติดตั้ง...' : 'กดติดตั้งทันที (1 คลิก)'}
                  </button>
                )}

                <div style={{
                  padding: '0.65rem 0.85rem',
                  background: 'rgba(16, 185, 129, 0.08)',
                  borderRadius: '12px',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                  fontSize: '0.8rem',
                  color: '#047857',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}>
                  <MoreVertical size={15} color="#10B981" />
                  <span>สามารถติดตั้งผ่านเมนูของ <strong>Google Chrome</strong> ได้โดยตรง:</span>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)',
                    color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    1
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    กดปุ่ม <strong>จุด 3 จุด</strong> (<MoreVertical size={13} style={{ verticalAlign: '-2px', display: 'inline', color: '#0F172A' }} /> เมนู) ที่มุมบนขวาของ Google Chrome
                  </div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)',
                    color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    2
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    เลือกเมนู <strong>"ติดตั้งแอป"</strong> (Install App) หรือ <strong>"เพิ่มลงในหน้าจอหลัก"</strong> (Add to Home screen)
                  </div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)',
                    color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    3
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    กดยืนยัน <strong>"ติดตั้ง"</strong> แล้วรอสักครู่ ไอคอน HorCare จะปรากฏที่หน้าจอของคุณ
                  </div>
                </div>
              </div>
            )}

            {/* TAB CONTENT: In-App Browser (LINE / FB) */}
            {activeTab === 'inapp' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{
                  padding: '0.75rem 0.85rem',
                  background: 'rgba(239, 68, 68, 0.08)',
                  borderRadius: '12px',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  fontSize: '0.8rem',
                  color: '#B91C1C',
                  lineHeight: 1.5,
                }}>
                  <strong>⚠️ กำลังเปิดผ่านแอป LINE หรือ Facebook:</strong>
                  <div>ระบบของมือถือไม่อนุญาตให้ติดตั้งแอปผ่านเบราว์เซอร์ภายในของ LINE/FB กรุณาเปิดด้วยเบราว์เซอร์หลัก</div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.15)',
                    color: '#E11D48', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    1
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    กดปุ่ม <strong>จุด 3 จุด (⋯)</strong> หรือไอคอนแชร์ ที่มุมขวาบนหรือล่างของหน้าจอ LINE
                  </div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.15)',
                    color: '#E11D48', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    2
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    เลือก <strong>"เปิดด้วยเบราว์เซอร์อื่น"</strong> (Open in default browser / Safari / Chrome)
                  </div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.15)',
                    color: '#E11D48', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    3
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    เมื่อเปิดใน Safari หรือ Chrome แล้ว ให้กดปุ่ม <strong>"ติดตั้ง"</strong> หรือเพิ่มลงหน้าจอหลักตามขั้นตอนได้ทันที
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyLink}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '0.7rem',
                    borderRadius: '12px',
                    background: '#F1F5F9',
                    border: '1px solid #CBD5E1',
                    color: '#334155',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    marginTop: '0.25rem',
                  }}
                >
                  <Copy size={15} />
                  คัดลอกลิงก์เพื่อไปวางใน Chrome / Safari
                </button>
              </div>
            )}

            {/* TAB CONTENT: Desktop PC / Mac */}
            {activeTab === 'desktop' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(99, 102, 241, 0.15)',
                    color: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    1
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    มองหาไอคอน <strong>ติดตั้ง</strong> (<Download size={14} style={{ verticalAlign: '-2px', display: 'inline', color: '#6366F1' }} /> หรือไอคอนจอคอมพิวเตอร์) ที่แถบ Address bar ด้านบนขวาของ Chrome / Edge
                  </div>
                </div>

                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                  background: 'var(--color-gray-50)', padding: '0.85rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', background: 'rgba(99, 102, 241, 0.15)',
                    color: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem', flexShrink: 0
                  }}>
                    2
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                    กดปุ่มแล้วเลือก <strong>"ติดตั้ง"</strong> (Install) แอปจะถูกติดตั้งเป็นโปรแกรมบนเดสก์ท็อป พร้อมใช้งานทันที
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Close Button */}
            <button
              onClick={() => setShowGuideModal(false)}
              style={{
                width: '100%',
                marginTop: '1.25rem',
                padding: '0.75rem',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #0284C7 0%, #10B981 100%)',
                color: '#FFFFFF',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(2, 132, 199, 0.25)',
              }}
            >
              เข้าใจแล้ว
            </button>
          </div>
        </div>
      )}
    </>
  );
}
