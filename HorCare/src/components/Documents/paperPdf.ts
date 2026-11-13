import type { jsPDF as JsPDF } from 'jspdf';
import { A4_HEIGHT_PX, A4_WIDTH_PX } from './PaperSheet';
import { pageBands } from './pageBands';

/** Top/bottom margin of continuation pages, in sheet pixels (≈13 mm). */
const PAGE_MARGIN_PX = 48;
const SCALE = 2;

/**
 * A copy of the sheet at full A4 width, off screen: the on-screen sheet may be scaled down (or re-flowed on a phone),
 * and the PDF must be drawn from the real size. Canvases (QR codes) are copied by hand — cloneNode leaves them blank.
 */
function offscreenCopy(sheet: HTMLElement): { node: HTMLElement; dispose: () => void } {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${A4_WIDTH_PX}px;pointer-events:none;`;
  const node = sheet.cloneNode(true) as HTMLElement;
  node.classList.remove('doc-sheet--fluid'); // a phone shows the re-flowed page; the PDF is always A4
  node.style.minHeight = '0';
  host.appendChild(node);
  document.body.appendChild(host);
  const from = sheet.querySelectorAll('canvas');
  node.querySelectorAll('canvas').forEach((c, i) => {
    const src = from[i];
    if (!src) return;
    c.width = src.width; c.height = src.height;
    c.getContext('2d')?.drawImage(src, 0, 0);
  });
  return { node, dispose: () => host.remove() };
}

async function libs() {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  await document.fonts?.ready;
  return { html2canvas, jsPDF };
}

/** A sheet already laid out at A4 width, drawn as one tall picture. */
export async function sheetCanvas(node: HTMLElement): Promise<HTMLCanvasElement> {
  const { html2canvas } = await libs();
  return html2canvas(node, { scale: SCALE, useCORS: true, backgroundColor: '#FFFFFF', logging: false, windowWidth: A4_WIDTH_PX });
}

/** Add one A4-width sheet to the PDF as pages that break only between `.doc-block`s. */
export async function appendSheet(pdf: JsPDF, node: HTMLElement, startOnNewPage: boolean): Promise<void> {
  const top = node.getBoundingClientRect().top;
  const blocks = Array.from(node.querySelectorAll<HTMLElement>('.doc-block')).map(el => {
    const r = el.getBoundingClientRect();
    return { top: r.top - top, bottom: r.bottom - top };
  });
  const total = node.offsetHeight;
  const canvas = await sheetCanvas(node);
  const mmPerPx = 210 / A4_WIDTH_PX;
  const bands = pageBands(blocks, total, A4_HEIGHT_PX, PAGE_MARGIN_PX);
  bands.forEach((band, i) => {
    const h = Math.max(1, Math.round((band.end - band.start) * SCALE));
    const slice = document.createElement('canvas');
    slice.width = canvas.width;
    slice.height = h;
    const ctx = slice.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, slice.width, h);
    ctx.drawImage(canvas, 0, Math.round(band.start * SCALE), canvas.width, h, 0, 0, canvas.width, h);
    if (i > 0 || startOnNewPage) pdf.addPage();
    const y = i === 0 ? 0 : PAGE_MARGIN_PX * mmPerPx;
    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, y, 210, (band.end - band.start) * mmPerPx, undefined, 'FAST');
    if (bands.length > 1) {
      pdf.setFontSize(8);
      pdf.setTextColor(140);
      pdf.text(`${i + 1} / ${bands.length}`, 200, 291, { align: 'right' });
    }
  });
}

/** The sheet as an A4 PDF, page breaks only between `.doc-block`s. */
export async function buildPaperPdf(sheet: HTMLElement) {
  const { jsPDF } = await libs();
  const { node, dispose } = offscreenCopy(sheet);
  try {
    const pdf = new jsPDF('p', 'mm', 'a4');
    await appendSheet(pdf, node, false);
    return pdf;
  } finally {
    dispose();
  }
}

/** Several sheets (already A4 width, e.g. a hidden list of invoices) in one PDF, each starting on its own page. */
export async function buildPaperPdfMany(nodes: HTMLElement[], onProgress?: (done: number) => void) {
  const { jsPDF } = await libs();
  const pdf = new jsPDF('p', 'mm', 'a4');
  for (let i = 0; i < nodes.length; i++) {
    await appendSheet(pdf, nodes[i], i > 0);
    onProgress?.(i + 1);
  }
  return pdf;
}

/** The sheet as one A4-width JPEG (e.g. to save to the photo album or send on LINE). */
export async function buildPaperImage(sheet: HTMLElement): Promise<Blob> {
  const { node, dispose } = offscreenCopy(sheet);
  try {
    const canvas = await sheetCanvas(node);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', 0.92));
  } finally {
    dispose();
  }
}

export async function downloadPaperPdf(sheet: HTMLElement, filename: string): Promise<void> {
  const pdf = await buildPaperPdf(sheet);
  pdf.save(filename.replace(/[\\/:*?"<>|]+/g, '_'));
}

/**
 * Open the PDF for printing. The tab is opened before the PDF is built, inside the click, so the browser does not
 * treat it as a pop-up.
 */
export async function printPaperPdf(sheet: HTMLElement): Promise<void> {
  const win = window.open('', '_blank');
  try {
    const pdf = await buildPaperPdf(sheet);
    const url = pdf.output('bloburl') as unknown as string;
    if (win) win.location.href = url; else window.location.href = url;
  } catch (err) {
    win?.close();
    throw err;
  }
}
