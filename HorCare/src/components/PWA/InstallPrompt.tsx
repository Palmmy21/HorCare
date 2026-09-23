import { useState, useEffect, useCallback } from 'react';
import { Download, X, Share, PlusSquare, CheckCircle2 } from 'lucide-react';
import horcareLogo from '../../assets/horcare_logo.png';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

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

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() => {
    return (window as unknown as { __pwaInstallPrompt?: BeforeInstallPromptEvent | null }).__pwaInstallPrompt || null;
  });
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [installing, setInstalling] = useState(false);

  // Check if standalone or dismissed recently
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

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
    if (ios) {
      setIsIOS(true);
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

    // Allow manual trigger from sidebar/settings: immediately trigger install if prompt is ready
    const manualOpenHandler = async () => {
      if (ios) {
        setShowIOSGuide(true);
        return;
      }
      const prompt = (window as unknown as { __pwaInstallPrompt?: BeforeInstallPromptEvent | null }).__pwaInstallPrompt || deferredPrompt;
      if (prompt) {
        try {
          await prompt.prompt();
          const { outcome } = await prompt.userChoice;
          if (outcome === 'accepted') {
            setShowBanner(false);
            return;
          }
        } catch (err) {
          console.error('[PWA] Prompt error:', err);
        }
      }
      setShowBanner(true);
    };
    window.addEventListener('open-pwa-install', manualOpenHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('pwa-prompt-available', onPrompt);
      window.removeEventListener('open-pwa-install', manualOpenHandler);
    };
  }, [checkShouldShow, deferredPrompt]);

  const handleInstall = async () => {
    if (isIOS) {
      setShowIOSGuide(true);
      return;
    }

    const prompt = deferredPrompt || (window as unknown as { __pwaInstallPrompt?: BeforeInstallPromptEvent | null }).__pwaInstallPrompt;

    if (prompt) {
      setInstalling(true);
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') {
          setShowBanner(false);
        }
      } catch (err) {
        console.error('[PWA] Install error:', err);
      } finally {
        setInstalling(false);
      }
      return;
    }

    // If install prompt is not available, close banner smoothly without showing alert()
    setShowBanner(false);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem('pwa_install_dismissed_time', Date.now().toString());
  };

  if (!showBanner || isPWAStandalone()) return null;

  return (
    <>
      <div className="install-prompt-wrapper">
        <div className="install-prompt-card">
          {/* App Icon */}
          <div className="install-prompt-logo-box">
            <img src={horcareLogo} alt="HorCare" className="install-prompt-logo-img" />
          </div>

          {/* Info */}
          <div className="install-prompt-info">
            <div className="install-prompt-badge">
              <CheckCircle2 size={11} color="#10B981" />
              <span>แอปพลิเคชันทางการ</span>
            </div>
            <div className="install-prompt-title">ติดตั้ง HorCare</div>
            <div className="install-prompt-desc">เปิดใช้งานเร็วขึ้น ลื่นไหลเหมือนแอปมือถือ ไม่ต้องเข้าเบราว์เซอร์</div>
          </div>

          {/* Actions */}
          <div className="install-prompt-actions">
            <button
              onClick={handleInstall}
              disabled={installing}
              className="install-prompt-btn-install"
            >
              <Download size={14} />
              <span>{isIOS ? 'วิธีติดตั้ง' : installing ? 'กำลังติดตั้ง...' : 'ติดตั้ง'}</span>
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

      {/* iOS Installation Guide Modal */}
      {showIOSGuide && (
        <div className="modal-overlay" onClick={() => setShowIOSGuide(false)} style={{ zIndex: 9999 }}>
          <div
            className="modal"
            style={{ maxWidth: '360px', padding: '1.5rem', borderRadius: '24px' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <img src={horcareLogo} alt="HorCare" style={{ width: 32, height: 32, borderRadius: 8 }} />
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: 'var(--color-gray-900)' }}>
                  ติดตั้งบน iPhone / iPad
                </h3>
              </div>
              <button className="btn-icon" onClick={() => setShowIOSGuide(false)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                background: 'var(--color-gray-50)', padding: '0.75rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', background: 'rgba(14, 165, 233, 0.12)',
                  color: '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem', flexShrink: 0
                }}>
                  1
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                  กดปุ่ม <strong>แชร์</strong> (<Share size={14} style={{ verticalAlign: '-2px', display: 'inline', color: '#0EA5E9' }} /> กล่องลูกศรขึ้น) ด้านล่างของเบราว์เซอร์ Safari
                </div>
              </div>

              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                background: 'var(--color-gray-50)', padding: '0.75rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', background: 'rgba(14, 165, 233, 0.12)',
                  color: '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem', flexShrink: 0
                }}>
                  2
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                  เลื่อนลงมาแล้วกด <PlusSquare size={14} style={{ verticalAlign: '-2px', display: 'inline', color: '#10B981' }} /> <strong>"เพิ่มไปยังหน้าจอโฮม"</strong> (Add to Home Screen)
                </div>
              </div>

              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.75rem',
                background: 'var(--color-gray-50)', padding: '0.75rem', borderRadius: '14px', border: '1px solid var(--color-gray-200)',
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%', background: 'rgba(14, 165, 233, 0.12)',
                  color: '#0EA5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem', flexShrink: 0
                }}>
                  3
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-gray-700)', lineHeight: 1.5 }}>
                  กด <strong>"เพิ่ม"</strong> (Add) ที่มุมบนขวา เป็นอันเสร็จสิ้น
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowIOSGuide(false)}
              style={{
                width: '100%', marginTop: '1.25rem', padding: '0.75rem',
                borderRadius: '12px', background: 'linear-gradient(135deg, #0EA5E9, #10B981)',
                color: '#fff', border: 'none', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer',
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
