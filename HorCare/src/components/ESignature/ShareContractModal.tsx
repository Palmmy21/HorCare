import { useEffect, useState } from 'react';
import {
  X, Copy, Check, Share2, Send, QrCode,
  ShieldCheck, Clock, FileText, Smartphone,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { toast } from 'react-hot-toast';
import type { SignedContractData, Room } from '../../types';
import { fetchPortalUrl } from '../../utils/portalLinks';

interface ShareContractModalProps {
  isOpen: boolean;
  onClose: () => void;
  contract: SignedContractData;
  room: Room;
  uid: string;
  buildingId: string;
  dormName?: string;
  onUpdateContractStatus?: (newStatus: 'pending_lessee') => Promise<void>;
}

export default function ShareContractModal({
  isOpen,
  onClose,
  contract,
  room,
  uid,
  buildingId,
  dormName = 'HorCare',
  onUpdateContractStatus,
}: ShareContractModalProps) {
  const [copied, setCopied] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState(false);
  // The room's portal link carries a secret only the server knows, so it is fetched when the modal opens.
  const [signUrl, setSignUrl] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetchPortalUrl(uid, buildingId, room.id, { sign: true })
      .then(url => { if (!cancelled) setSignUrl(url); })
      .catch(() => { if (!cancelled) toast.error('ดึงลิงก์ลงนามไม่สำเร็จ กรุณาลองใหม่'); });
    return () => { cancelled = true; };
  }, [isOpen, uid, buildingId, room.id]);

  if (!isOpen) return null;

  const isMarket = contract.contract_type === 'market_stall';
  const unitLabel = isMarket ? 'แผงค้า' : 'ห้อง';

  // Polite LINE prefilled message
  const shareMessage = `เรียน คุณ${contract.lessee_name || 'ผู้เช่า'}\n\nทางโครงการ ${dormName} ได้ออกร่าง ${contract.title || 'สัญญาเช่า'} (เลขที่: ${contract.contract_number})\nสำหรับ ${unitLabel} ${contract.unit_number}\n\nท่านสามารถตรวจสอบรายละเอียดข้อตกลงและลงนามสัญญาดิจิทัลออนไลน์ผ่านสมาร์ตโฟนได้ที่ลิงก์นี้:\n${signUrl}\n\nเมื่อลงนามเรียบร้อยแล้ว ระบบจะออกเอกสารฉบับสมบูรณ์พร้อมรหัสยืนยันอิเล็กทรอนิกส์ให้ทันที ขอบคุณครับ/ค่ะ 🙏`;

  const handleCopyLink = async () => {
    if (!signUrl) return;
    try {
      await navigator.clipboard.writeText(signUrl);
      setCopied(true);
      toast.success('คัดลอกลิงก์ส่งสัญญาเรียบร้อยแล้ว 📋');
      setTimeout(() => setCopied(false), 2500);

      // Auto upgrade draft -> pending_lessee if needed
      if (contract.status === 'draft' && onUpdateContractStatus) {
        onUpdateContractStatus('pending_lessee');
      }
    } catch {
      toast.error('ไม่สามารถคัดลอกลิงก์ได้ กรุณาคัดลอกด้วยตนเอง');
    }
  };

  const handleCopyMessage = async () => {
    if (!signUrl) return;
    try {
      await navigator.clipboard.writeText(shareMessage);
      setCopiedMsg(true);
      toast.success('คัดลอกข้อความพร้อมลิงก์แล้ว 💬');
      setTimeout(() => setCopiedMsg(false), 2500);

      if (contract.status === 'draft' && onUpdateContractStatus) {
        onUpdateContractStatus('pending_lessee');
      }
    } catch {
      toast.error('ไม่สามารถคัดลอกข้อความได้');
    }
  };

  const handleOpenLineShare = () => {
    if (!signUrl) return;
    if (contract.status === 'draft' && onUpdateContractStatus) {
      onUpdateContractStatus('pending_lessee');
    }
    const lineUrl = `https://line.me/R/msg/text/?${encodeURIComponent(shareMessage)}`;
    window.open(lineUrl, '_blank', 'noopener,noreferrer');
  };

  const handleNativeShare = async () => {
    if (!signUrl) return;
    if (navigator.share) {
      try {
        if (contract.status === 'draft' && onUpdateContractStatus) {
          onUpdateContractStatus('pending_lessee');
        }
        await navigator.share({
          title: `ร่าง${contract.title} - ${unitLabel} ${contract.unit_number}`,
          text: shareMessage,
          url: signUrl,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      handleCopyLink();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(16, 42, 67, 0.65)',
        backdropFilter: 'blur(8px)',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: '#FFFFFF',
          borderRadius: '24px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0,0,0,0.06)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '90vh',
          animation: 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            background: 'linear-gradient(135deg, #0A6CC2 0%, #08589F 100%)',
            color: '#FFFFFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.2)',
                backdropFilter: 'blur(8px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Send size={20} color="#FFFFFF" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>
                ส่งร่างสัญญาให้ผู้เช่าเซ็น
              </h3>
              <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.85)' }}>
                ผู้เช่าสามารถเปิดดูและลงนามดิจิทัลบนมือถือได้ทันที ไม่ต้องโหลดแอป
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#FFFFFF',
              transition: 'background 0.2s',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Contract Overview Box */}
          <div
            style={{
              padding: '1rem 1.25rem',
              backgroundColor: '#F4F7FB',
              borderRadius: '16px',
              border: '1px solid #DCE5EF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <FileText size={15} color="#0A6CC2" />
                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#102A43' }}>
                  {contract.title}
                </span>
              </div>
              <div style={{ fontSize: '0.825rem', color: '#557089' }}>
                ผู้เช่า: <strong style={{ color: '#1A3350' }}>{contract.lessee_name || '—'}</strong> • {unitLabel}:{' '}
                <strong style={{ color: '#1A3350' }}>{contract.unit_number}</strong>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#8FA3B8', marginTop: '0.2rem' }}>
                เลขที่สัญญา: <span style={{ fontFamily: 'var(--font-mono)' }}>{contract.contract_number}</span>
              </div>
            </div>

            {/* Status badge */}
            <div>
              {contract.lessee_signature ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '20px',
                    background: '#DCF2E4',
                    color: '#15803D',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    border: '1px solid #A7DDBB',
                  }}
                >
                  <ShieldCheck size={14} /> ลงนามเรียบร้อย
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '20px',
                    background: '#FDEBD3',
                    color: '#E8740C',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    border: '1px solid #F7B86C',
                  }}
                >
                  <Clock size={14} /> รอดำเนินการเซ็น
                </span>
              )}
            </div>
          </div>

          {/* Action 1: One-Click Quick Share Buttons */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={handleOpenLineShare}
              style={{
                flex: 1,
                background: '#06C755',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '14px',
                padding: '0.875rem 1rem',
                fontWeight: 700,
                fontSize: '0.925rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                boxShadow: '0 4px 12px rgba(6, 199, 85, 0.25)',
                transition: 'all 0.15s ease',
              }}
            >
              <Share2 size={18} />
              ส่งเข้า LINE ทันที
            </button>

            {typeof navigator.share === 'function' && (
              <button
                type="button"
                onClick={handleNativeShare}
                style={{
                  background: 'linear-gradient(135deg, #0A6CC2 0%, #08589F 100%)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '14px',
                  padding: '0.875rem 1.25rem',
                  fontWeight: 700,
                  fontSize: '0.925rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  boxShadow: '0 4px 12px rgba(10, 108, 194, 0.25)',
                }}
              >
                <Smartphone size={18} />
                แชร์ไปยังแอปอื่น
              </button>
            )}
          </div>

          {/* Direct Link Box */}
          <div>
            <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 700, color: '#29435E', marginBottom: '0.4rem' }}>
              🔗 ลิงก์ตรงสำหรับเซ็นสัญญา (Direct Sign URL)
            </label>
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                alignItems: 'center',
                background: '#EBF1F7',
                borderRadius: '12px',
                padding: '0.4rem 0.5rem 0.4rem 0.85rem',
                border: '1px solid #C3D0DE',
              }}
            >
              <input
                type="text"
                readOnly
                value={signUrl}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  fontSize: '0.825rem',
                  color: '#29435E',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <button
                type="button"
                onClick={handleCopyLink}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  background: copied ? '#22A35A' : '#0A6CC2',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.45rem 0.85rem',
                  fontWeight: 700,
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  flexShrink: 0,
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
              </button>
            </div>
          </div>

          {/* QR Code for On-the-spot Sign */}
          <div
            style={{
              padding: '1.25rem',
              backgroundColor: '#F4F7FB',
              borderRadius: '16px',
              border: '1px dashed #C3D0DE',
              display: 'flex',
              alignItems: 'center',
              gap: '1.25rem',
            }}
          >
            <div
              style={{
                background: '#FFFFFF',
                padding: '0.6rem',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                flexShrink: 0,
              }}
            >
              <QRCodeCanvas
                value={signUrl}
                size={110}
                level="M"
                includeMargin={false}
              />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 800, fontSize: '0.9rem', color: '#102A43', marginBottom: '0.3rem' }}>
                <QrCode size={16} color="#0A6CC2" />
                สแกนเซ็นสดต่อหน้า (In-Person QR)
              </div>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#557089', lineHeight: 1.45 }}>
                ให้ผู้เช่ายกกล้องมือถือสแกน QR Code นี้ จะเปิดหน้าสัญญาพร้อมช่องเซ็นชื่อดิจิทัลทันทีโดยไม่ต้องพิมพ์เอกสาร
              </p>
              <button
                type="button"
                onClick={handleCopyMessage}
                style={{
                  marginTop: '0.6rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  background: 'transparent',
                  border: '1px solid #C3D0DE',
                  borderRadius: '8px',
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.775rem',
                  fontWeight: 600,
                  color: '#3E5872',
                  cursor: 'pointer',
                }}
              >
                {copiedMsg ? <Check size={12} color="#22A35A" /> : <Copy size={12} />}
                {copiedMsg ? 'คัดลอกข้อความเต็มแล้ว' : 'คัดลอกข้อความทักทายพร้อมลิงก์'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            backgroundColor: '#F4F7FB',
            borderTop: '1px solid #DCE5EF',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '10px',
              border: '1px solid #C3D0DE',
              backgroundColor: '#FFFFFF',
              color: '#3E5872',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
}
