import { QRCodeSVG } from 'qrcode.react';
import { Copy, ScanLine } from 'lucide-react';
import toast from 'react-hot-toast';
import { joinUrl } from '../../shared/joinCodes';

/**
 * A registration QR: scanning it in LINE opens the LIFF page, which knows who is scanning and links them —
 * nothing to type or send (api/_liff-join.ts). The code itself stays visible for anyone who prefers to type it.
 */
export default function JoinQr({ code, size = 148, hint = 'สแกนด้วย LINE แล้วลงทะเบียนอัตโนมัติ' }: { code: string; size?: number; hint?: string }) {
  const url = joinUrl(window.location.origin, code);
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast.success('คัดลอกลิงก์แล้ว'); } catch { toast.error('คัดลอกไม่สำเร็จ'); } };
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ background: '#fff', padding: 8, borderRadius: 10, border: '1px solid var(--color-gray-200, #DCE5EF)', lineHeight: 0 }}>
        <QRCodeSVG value={url} size={size} level="M" aria-label={`QR ลงทะเบียน ${code}`} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text, #1A3350)' }}>
          <ScanLine size={15} aria-hidden /> {hint}
        </span>
        <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #557089)' }}>รหัส {code}</span>
        <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={() => void copy()}>
          <Copy size={12} aria-hidden /> คัดลอกลิงก์ลงทะเบียน
        </button>
      </div>
    </div>
  );
}
