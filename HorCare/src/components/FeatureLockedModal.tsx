import { X, Lock, Zap } from 'lucide-react';

interface Props {
  featureName: string;
  onClose: () => void;
  onUpgrade: () => void;
}

/**
 * Modal แสดงเมื่อ Free plan user พยายามเข้าถึง feature ที่ต้องชำระเงิน
 */
export default function FeatureLockedModal({ featureName, onClose, onUpgrade }: Props) {
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
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '400px', width: '100%',
          borderRadius: '20px', overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{
          background: 'linear-gradient(135deg, #0A6CC2 0%, #0A6CC2 55%, #3D8FD6 100%)',
          padding: '2rem 1.75rem 1.5rem',
          textAlign: 'center',
          position: 'relative',
        }}>
          <button
            onClick={onClose}
            style={{
              position: 'absolute', top: '1rem', right: '1rem',
              background: 'rgba(255,255,255,0.2)', border: 'none',
              borderRadius: '50%', width: 32, height: 32,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', color: '#fff',
            }}
          >
            <X size={18} />
          </button>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: 'rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1rem',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          }}>
            <Lock size={32} color="#fff" />
          </div>
          <h3 style={{ color: '#fff', fontWeight: 800, fontSize: '1.25rem', margin: '0 0 0.375rem' }}>
            {featureName}
          </h3>
          <p style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.875rem', margin: 0 }}>
            ฟีเจอร์นี้สำหรับแพ็กเกจที่ชำระเงินแล้วเท่านั้น
          </p>
        </div>

        <div style={{ padding: '1.5rem 1.75rem', background: '#fff' }}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(10, 108, 194, 0.08), rgba(10, 108, 194, 0.05))',
            border: '1px solid rgba(10, 108, 194, 0.22)',
            borderRadius: '12px', padding: '0.875rem 1rem',
            marginBottom: '1.25rem',
            display: 'flex', alignItems: 'center', gap: '0.625rem',
          }}>
            <Zap size={18} color="#0A6CC2" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.8125rem', color: '#102A43', lineHeight: 1.5 }}>
              เริ่มต้นเพียง <strong style={{ color: '#0A6CC2' }}>฿399/เดือน</strong> สำหรับแพ็กเกจ Pro
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '0.75rem', borderRadius: '10px',
                background: 'none', border: '1px solid #DCE5EF',
                cursor: 'pointer', fontWeight: 600, color: '#557089',
              }}
            >
              ปิด
            </button>
            <button
              onClick={onUpgrade}
              style={{
                flex: 2, padding: '0.75rem', borderRadius: '10px',
                background: 'linear-gradient(135deg, #0A6CC2, #0A6CC2)',
                border: 'none', cursor: 'pointer',
                fontWeight: 700, color: '#fff', fontSize: '0.9rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                boxShadow: '0 4px 16px rgba(10, 108, 194, 0.35)',
              }}
            >
              <Zap size={16} />
              ดูแพ็กเกจ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
