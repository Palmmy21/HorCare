import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckSquare, Download, FileText, Image as ImageIcon, Loader2, Share2, Square, X } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import type { BillLanguage, DormConfig, MonthlyBill, Room } from '../../types';
import type { PayAccount } from '../../shared/banks';
import { InvoiceDocument } from '../Documents/InvoiceDocument';
import { buildPaperPdfMany, sheetCanvas } from '../Documents/paperPdf';
import { invoiceNumber } from '../../shared/invoice';
import { UNIT_CATEGORY_LABELS, categoryOf } from '../../shared/unitCategory';
import { formatCurrency, formatMonthThai } from '../../utils/calculations';
import { triggerFileDownload } from '../../utils/fileDownload';
import { safeFileNames, zipStore } from '../../utils/zip';
import '../Documents/documents.css';

type ShareNav = Navigator & { canShare?: (d: ShareData) => boolean };
type Format = 'images' | 'pdf';
type Pick = 'all' | 'unpaid' | 'paid';

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function canShareFiles(files: File[]): boolean {
  const nav = navigator as ShareNav;
  try { return !!nav.share && !!nav.canShare && nav.canShare({ files }); } catch { return false; }
}

const canvasBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('encode_failed'))), type, q));

/**
 * Many A4 invoices at once — as pictures (one per bill, for LINE or the photo album) or one PDF. On a phone that can
 * share files (iPhone, Android) the result goes to the share sheet, where "บันทึกรูปภาพ / Save Images" puts the pictures
 * straight into Photos; elsewhere the pictures download as one ZIP.
 *
 * Sharing must start from a tap, and drawing many bills takes longer than a tap stays valid, so the files are made
 * first and a second tap shares them.
 */
export default function BulkInvoiceExport({ bills, rooms, config, payTo, uid, buildingId, month, unitName, initialIds, initialFormat = 'images', autoStart = false, onClose }: {
  bills: MonthlyBill[];
  rooms: Room[];
  config: DormConfig;
  payTo: PayAccount | null;
  uid?: string;
  buildingId?: string;
  month: string;
  unitName: string;
  /** start with only these bills ticked (one bill's "รูปสำหรับ LINE") */
  initialIds?: string[];
  initialFormat?: Format;
  /** skip the choosing step */
  autoStart?: boolean;
  onClose: () => void;
}) {
  const sorted = useMemo(() => [...bills].sort((a, b) => a.room_number.localeCompare(b.room_number, 'th', { numeric: true })), [bills]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialIds ?? sorted.map(b => b.id)));
  const [format, setFormat] = useState<Format>(initialFormat);
  const [roomLang, setRoomLang] = useState(true);
  const [phase, setPhase] = useState<'pick' | 'working' | 'ready' | 'error'>(autoStart ? 'working' : 'pick');
  const [progress, setProgress] = useState(0);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const hiddenRef = useRef<HTMLDivElement>(null);
  const namesLoaded = useRef<Promise<void>>(Promise.resolve());

  // tenant names for "เรียกเก็บจาก" — staff without tenant.read just get "ผู้เช่าห้อง …"
  useEffect(() => {
    if (!uid || !buildingId) return;
    let off = false;
    namesLoaded.current = getDocs(collection(db, `users/${uid}/buildings/${buildingId}/tenants`))
      .then(snap => { if (!off) setNames(new Map(snap.docs.map(d => [d.id, String(d.data().full_name ?? '')]))); })
      .catch(() => { /* no permission: names stay blank */ });
    return () => { off = true; };
  }, [uid, buildingId]);

  const bc = config.bill_customization;
  const roomOf = useMemo(() => new Map(rooms.map(r => [r.id, r])), [rooms]);
  const chosen = sorted.filter(b => selected.has(b.id));
  const secondLang: BillLanguage | null = bc?.bilingual_mode ? bc.secondary_language || 'en' : null;
  const langOf = (b: MonthlyBill): BillLanguage => (roomLang ? roomOf.get(b.room_id)?.language || bc?.default_language || 'th' : 'th');
  const baseName = (b: MonthlyBill) => `ใบแจ้งหนี้_${unitName}${b.room_number}_${month}`;

  const pick = (p: Pick) => setSelected(new Set(sorted.filter(b => p === 'all' || (p === 'paid') === (b.payment_status === 'paid')).map(b => b.id)));
  const toggle = (id: string) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // draw the ticked bills once they are on the hidden page
  useEffect(() => {
    if (phase !== 'working') return;
    let cancelled = false;
    (async () => {
      await namesLoaded.current; // so the pictures carry the tenants' names
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const nodes = Array.from(hiddenRef.current?.querySelectorAll<HTMLElement>('.doc-sheet') ?? []);
      if (!nodes.length) throw new Error('nothing_to_draw');
      setProgress(0);
      let out: File[];
      if (format === 'pdf') {
        const pdf = await buildPaperPdfMany(nodes, n => { if (!cancelled) setProgress(n); });
        const blob = pdf.output('blob');
        out = [new File([blob], `ใบแจ้งหนี้_${month}_${nodes.length}รายการ.pdf`, { type: 'application/pdf' })];
      } else {
        const fileNames = safeFileNames(chosen.map(b => `${baseName(b)}.jpg`));
        out = [];
        for (let i = 0; i < nodes.length; i++) {
          if (cancelled) return;
          const blob = await canvasBlob(await sheetCanvas(nodes[i]), 'image/jpeg', 0.92);
          out.push(new File([blob], fileNames[i], { type: 'image/jpeg' }));
          setProgress(i + 1);
        }
      }
      if (cancelled) return;
      setFiles(out);
      setPhase('ready');
    })().catch(err => {
      console.error('bulk invoice export failed:', err);
      if (!cancelled) { setError('สร้างไฟล์ไม่สำเร็จ กรุณาลองใหม่'); setPhase('error'); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per start; the inputs are frozen while working
  }, [phase]);

  const shareable = files.length > 0 && canShareFiles(files);

  const share = async () => {
    try {
      await navigator.share({ files, title: `ใบแจ้งหนี้ ${formatMonthThai(month)}` });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') { console.warn('share failed, downloading instead:', err); download(); }
    }
  };

  const download = () => {
    if (files.length === 1) { triggerFileDownload(files[0], files[0].name); return; }
    void Promise.all(files.map(async f => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))).then(entries => {
      const zip = zipStore(entries);
      triggerFileDownload(new Blob([zip as BlobPart], { type: 'application/zip' }), `ใบแจ้งหนี้_${month}.zip`);
    });
  };

  const ios = isIOS();
  const total = chosen.length;

  return createPortal(
    <div className="modal-overlay" onClick={phase === 'working' ? undefined : onClose} style={{ zIndex: 100000 }}>
      <div className="modal bie-modal" role="dialog" aria-modal="true" aria-label="ดาวน์โหลดใบแจ้งหนี้หลายรายการ" onClick={e => e.stopPropagation()}>
        <div className="modal-header bie-head">
          <h3 className="modal-title"><Download size={18} aria-hidden /> ดาวน์โหลดใบแจ้งหนี้ · {formatMonthThai(month)}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={phase === 'working'} aria-label="ปิด"><X size={18} /></button>
        </div>

        {phase === 'pick' && (
          <>
            <div className="modal-body bie-body">
              <div className="bie-row">
                <span className="bie-label">รูปแบบ</span>
                <div className="bie-seg">
                  <button type="button" className={format === 'images' ? 'is-on' : ''} onClick={() => setFormat('images')}><ImageIcon size={15} /> รูปภาพ (1 รูป/บิล)</button>
                  <button type="button" className={format === 'pdf' ? 'is-on' : ''} onClick={() => setFormat('pdf')}><FileText size={15} /> PDF รวมไฟล์เดียว</button>
                </div>
              </div>
              <div className="bie-row">
                <span className="bie-label">ภาษา</span>
                <div className="bie-seg">
                  <button type="button" className={roomLang ? 'is-on' : ''} onClick={() => setRoomLang(true)}>ตามภาษาของผู้เช่าแต่ละห้อง</button>
                  <button type="button" className={!roomLang ? 'is-on' : ''} onClick={() => setRoomLang(false)}>ไทยทั้งหมด</button>
                </div>
              </div>
              <div className="bie-row">
                <span className="bie-label">เลือก</span>
                <div className="bie-quick">
                  <button type="button" onClick={() => pick('all')}>ทั้งหมด</button>
                  <button type="button" onClick={() => pick('unpaid')}>ยังไม่ชำระ</button>
                  <button type="button" onClick={() => pick('paid')}>ชำระแล้ว</button>
                  <button type="button" onClick={() => setSelected(new Set())}>ไม่เลือก</button>
                </div>
              </div>
              <ul className="bie-list">
                {sorted.map(b => {
                  const room = roomOf.get(b.room_id);
                  const on = selected.has(b.id);
                  return (
                    <li key={b.id}>
                      <button type="button" className={on ? 'is-on' : ''} onClick={() => toggle(b.id)} aria-pressed={on}>
                        {on ? <CheckSquare size={18} /> : <Square size={18} />}
                        <span className="bie-room">{b.room_number}</span>
                        <span className="bie-name">
                          {names.get(b.room_id) || '—'}
                          {room?.unit_category && <small> · {UNIT_CATEGORY_LABELS[categoryOf(room, config.building_type)]}</small>}
                        </span>
                        <span className={`bie-status ${b.payment_status === 'paid' ? 'paid' : ''}`}>{b.payment_status === 'paid' ? 'ชำระแล้ว' : 'ยังไม่ชำระ'}</span>
                        <span className="bie-amount">{formatCurrency(b.total_bill)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {format === 'images' && ios && <p className="bie-hint">บน iPhone/iPad: เมื่อสร้างเสร็จ กด "บันทึกลงอัลบั้มรูป" แล้วเลือก <b>บันทึกรูปภาพ</b> รูปจะเข้าแอปรูปภาพทันที</p>}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>ยกเลิก</button>
              <button type="button" className="btn btn-primary" disabled={total === 0} onClick={() => setPhase('working')}>
                <Download size={16} /> สร้าง {total} {format === 'pdf' ? 'บิลเป็น PDF' : 'รูป'}
              </button>
            </div>
          </>
        )}

        {phase === 'working' && (
          <div className="modal-body bie-status-box">
            <Loader2 size={28} className="spin" aria-hidden />
            <div className="bie-big">กำลังสร้าง {progress}/{total}</div>
            <div className="bie-bar"><span style={{ width: `${total ? (progress / total) * 100 : 0}%` }} /></div>
            <p className="bie-hint">กรุณาอย่าปิดหน้านี้</p>
          </div>
        )}

        {phase === 'ready' && (
          <>
            <div className="modal-body bie-status-box">
              <div className="bie-big">พร้อมแล้ว {format === 'pdf' ? `PDF ${total} บิล` : `${files.length} รูป`}</div>
              {shareable && format === 'images' && (
                <p className="bie-hint">
                  {ios ? <>กด "บันทึกลงอัลบั้มรูป" แล้วเลือก <b>บันทึกรูปภาพ</b> (Save Images) — หรือเลือก LINE เพื่อส่งต่อได้เลย</> : <>กด "บันทึก / แชร์" แล้วเลือกบันทึกลงแกลเลอรี หรือส่งเข้า LINE</>}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>ปิด</button>
              <button type="button" className={shareable ? 'btn btn-outline' : 'btn btn-primary'} onClick={download}>
                <Download size={16} /> {files.length > 1 ? 'ดาวน์โหลด ZIP' : 'ดาวน์โหลด'}
              </button>
              {shareable && (
                <button type="button" className="btn btn-primary" onClick={() => void share()}>
                  <Share2 size={16} /> {format === 'images' ? (ios ? 'บันทึกลงอัลบั้มรูป' : 'บันทึก / แชร์') : 'แชร์ / บันทึกไฟล์'}
                </button>
              )}
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="modal-body bie-status-box"><p className="imp-error" role="alert">{error}</p></div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>ปิด</button>
              <button type="button" className="btn btn-primary" onClick={() => setPhase('working')}>ลองใหม่</button>
            </div>
          </>
        )}
      </div>

      {/* the ticked bills, laid out at A4 width off screen, for drawing */}
      {phase === 'working' && (
        <div ref={hiddenRef} aria-hidden style={{ position: 'fixed', left: -20000, top: 0, width: 794, pointerEvents: 'none' }}>
          {chosen.map(b => {
            const room = roomOf.get(b.room_id);
            return (
              <div key={b.id} className="doc-sheet" style={{ minHeight: 0, boxShadow: 'none', marginBottom: 24 }} data-name={invoiceNumber(b)}>
                <InvoiceDocument
                  bill={b}
                  issuer={{ name: bc?.dorm_name, address: bc?.dorm_address, phone: bc?.dorm_phone, logo: bc?.dorm_logo }}
                  tenantName={names.get(b.room_id) || undefined}
                  unitWord={room?.unit_category ? UNIT_CATEGORY_LABELS[categoryOf(room, config.building_type)] : unitName}
                  dueDay={bc?.due_day}
                  payTo={payTo}
                  lang={langOf(b)}
                  secondLang={secondLang}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>,
    document.body,
  );
}
