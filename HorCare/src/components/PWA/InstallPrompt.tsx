import { useState, useEffect } from 'react';
import { Download, X, Smartphone } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export default function InstallPrompt() {
    const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [showBanner, setShowBanner] = useState(false);
    const [isIOS, setIsIOS] = useState(false);
    const [showIOSGuide, setShowIOSGuide] = useState(false);

    useEffect(() => {
        const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream;
        const isStandalone =
            window.matchMedia('(display-mode: standalone)').matches ||
            (navigator as Navigator & { standalone?: boolean }).standalone === true;

        if (isStandalone || localStorage.getItem('pwa_install_dismissed') === 'true') return;

        if (ios) {
            setIsIOS(true);
            const timer = setTimeout(() => setShowBanner(true), 3000);
            return () => clearTimeout(timer);
        }

        const handler = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e as BeforeInstallPromptEvent);
            setShowBanner(true);
        };
        window.addEventListener('beforeinstallprompt', handler);
        return () => window.removeEventListener('beforeinstallprompt', handler);
    }, []);

    const handleInstall = async () => {
        if (!deferredPrompt) return;
        await deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') setShowBanner(false);
        setDeferredPrompt(null);
    };

    const handleDismiss = () => {
        setShowBanner(false);
        localStorage.setItem('pwa_install_dismissed', 'true');
    };

    if (!showBanner) return null;

    return (
        <>
            <div className="install-prompt">
                <div className="install-prompt-icon">
                    <Smartphone size={20} />
                </div>
                <div className="install-prompt-text">
                    <span className="install-prompt-title">ติดตั้ง HorCare</span>
                    <span className="install-prompt-sub">ใช้งานเหมือนแอปพลิเคชัน ไม่ต้องเปิดเบราว์เซอร์</span>
                </div>
                <div className="install-prompt-actions">
                    {isIOS ? (
                        <button className="btn btn-primary btn-sm" onClick={() => setShowIOSGuide(true)}>
                            วิธีติดตั้ง
                        </button>
                    ) : (
                        <button className="btn btn-primary btn-sm" onClick={handleInstall}>
                            <Download size={14} /> ติดตั้ง
                        </button>
                    )}
                    <button className="btn-icon" onClick={handleDismiss} title="ปิด">
                        <X size={16} />
                    </button>
                </div>
            </div>

            {showIOSGuide && (
                <div className="modal-overlay" onClick={() => setShowIOSGuide(false)}>
                    <div className="modal" style={{ maxWidth: '320px' }} onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 style={{ margin: 0 }}>ติดตั้งบน iPhone / iPad</h3>
                            <button className="btn-icon" onClick={() => setShowIOSGuide(false)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="modal-body" style={{ fontSize: '0.9rem', lineHeight: 1.7 }}>
                            <ol style={{ paddingLeft: '1.25rem', margin: 0 }}>
                                <li>กดปุ่ม <strong>Share</strong> (กล่องลูกศรขึ้น) ด้านล่างของ Safari</li>
                                <li>เลื่อนลงแล้วกด <strong>"Add to Home Screen"</strong></li>
                                <li>กด <strong>Add</strong> ที่มุมบนขวา</li>
                            </ol>
                            <p style={{ marginTop: '0.75rem', color: 'var(--color-gray-500)', fontSize: '0.8rem', marginBottom: 0 }}>
                                HorCare จะปรากฏบนหน้าจอหลักเหมือนแอปปกติ
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
