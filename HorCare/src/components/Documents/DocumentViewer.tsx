import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer, X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { PaperSheet } from './PaperSheet';
import { downloadPaperPdf, printPaperPdf } from './paperPdf';

/** A document on its own screen: the A4 page, with "download PDF" and "print" that produce the same page. */
export function DocumentViewer({ title, filename, onClose, children, actions }: {
  title: string;
  /** PDF file name, without the extension */
  filename: string;
  onClose: () => void;
  children: ReactNode;
  /** extra buttons for the bar (e.g. "sign") */
  actions?: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'pdf' | 'print' | null>(null);

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
