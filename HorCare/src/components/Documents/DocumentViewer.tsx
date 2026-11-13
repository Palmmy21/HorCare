import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, Image as ImageIcon, Printer, Share2, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { PaperSheet } from './PaperSheet';
import { buildPaperImage, downloadPaperPdf, printPaperPdf } from './paperPdf';
import { triggerFileDownload } from '../../utils/fileDownload';

type ShareNav = Navigator & { canShare?: (d: ShareData) => boolean };
const shareableFile = (f: File) => { try { return !!(navigator as ShareNav).canShare?.({ files: [f] }) && !!navigator.share; } catch { return false; } };

/** A document on its own screen: the A4 page, with "download PDF" and "print" that produce the same page. */
export function DocumentViewer({ title, filename, onClose, children, actions, allowImage = false }: {
  title: string;
  /** PDF file name, without the extension */
  filename: string;
  onClose: () => void;
  children: ReactNode;
  /** extra buttons for the bar (e.g. "sign") */
  actions?: ReactNode;
  /** a "picture" button: on a phone it goes to the share sheet (iPhone: บันทึกรูปภาพ → Photos), elsewhere it downloads */
  allowImage?: boolean;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'pdf' | 'print' | 'image' | null>(null);
  // sharing needs a fresh tap, and drawing the picture outlasts the first one: keep it for a second tap
  const [image, setImage] = useState<File | null>(null);

  const makeImage = async () => {
    if (!sheetRef.current || busy) return;
    setBusy('image');
    try {
      const file = new File([await buildPaperImage(sheetRef.current)], `${filename}.jpg`, { type: 'image/jpeg' });
      if (shareableFile(file)) setImage(file);
      else triggerFileDownload(file, file.name);
    } catch (err) {
      console.error('document image failed:', err);
      toast.error('สร้างรูปไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setBusy(null);
    }
  };
  const shareImage = async () => {
    if (!image) return;
    try { await navigator.share({ files: [image], title }); setImage(null); }
    catch (err) { if ((err as Error).name !== 'AbortError') { triggerFileDownload(image, image.name); setImage(null); } }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const run = async (kind: 'pdf' | 'print') => {
    if (!sheetRef.current || busy) return;
    setBusy(kind);
    try {
      if (kind === 'pdf') await downloadPaperPdf(sheetRef.current, `${filename}.pdf`);
      else await printPaperPdf(sheetRef.current);
    } catch (err) {
      console.error('document export failed:', err);
      toast.error(kind === 'pdf' ? 'สร้างไฟล์ PDF ไม่สำเร็จ กรุณาลองใหม่' : 'เปิดหน้าพิมพ์ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setBusy(null);
    }
  };

  return createPortal(
    <div className="doc-viewer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="doc-viewer-bar">
        <div className="doc-viewer-title">{title}</div>
        {actions}
        {allowImage && (image ? (
          <button type="button" className="doc-viewer-btn primary doc-viewer-pulse" onClick={() => void shareImage()} title="บันทึกลงอัลบั้มรูป / แชร์">
            <Share2 size={16} /> <span className="doc-viewer-label">บันทึกลงอัลบั้ม</span>
          </button>
        ) : (
          <button type="button" className="doc-viewer-btn" onClick={() => void makeImage()} disabled={!!busy} title="บันทึกเป็นรูปภาพ">
            <ImageIcon size={16} /> <span className="doc-viewer-label">{busy === 'image' ? 'กำลังสร้าง…' : 'รูปภาพ'}</span>
          </button>
        ))}
        <button type="button" className="doc-viewer-btn" onClick={() => run('print')} disabled={!!busy} title="พิมพ์">
          <Printer size={16} /> <span className="doc-viewer-label">{busy === 'print' ? 'กำลังเตรียม…' : 'พิมพ์'}</span>
        </button>
        <button type="button" className="doc-viewer-btn primary" onClick={() => run('pdf')} disabled={!!busy} title="ดาวน์โหลด PDF">
          <Download size={16} /> <span className="doc-viewer-label">{busy === 'pdf' ? 'กำลังสร้าง…' : 'PDF'}</span>
        </button>
        <button type="button" className="doc-viewer-btn" onClick={onClose} aria-label="ปิด"><X size={16} /></button>
      </div>
      <div className="doc-viewer-body">
        <PaperSheet onSheet={el => { sheetRef.current = el; }}>{children}</PaperSheet>
      </div>
    </div>,
    document.body,
  );
}
