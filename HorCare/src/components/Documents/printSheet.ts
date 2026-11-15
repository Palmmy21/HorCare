/**
 * Printing a document page (contract, invoice) straight from the browser — the พิมพ์ button, and also Ctrl+P while a
 * document is open. Only the A4 sheet is printed, as real text, at its A4 layout, and the browser breaks pages between
 * `.doc-block`s (documents.css, @media print). Without this, printing the screen printed the app around the sheet
 * (or blank pages: index.css hides everything it does not know about when printing).
 */

/** Copy of a sheet at its A4 layout. Canvases (QR codes) are copied by hand — cloneNode leaves them blank. */
export function cloneSheet(sheet: HTMLElement): HTMLElement {
  const node = sheet.cloneNode(true) as HTMLElement;
  node.classList.remove('doc-sheet--fluid'); // a phone shows the re-flowed page; paper is always A4
  node.style.minHeight = '0';
  const from = sheet.querySelectorAll('canvas');
  node.querySelectorAll('canvas').forEach((c, i) => {
    const src = from[i];
    if (!src) return;
    c.width = src.width; c.height = src.height;
    c.getContext('2d')?.drawImage(src, 0, 0);
  });
  return node;
}

const HOST_ID = 'doc-print-host';
const PRINTING = 'doc-printing';

/** Document sheets open on screen (a viewer or the contract editor), newest last: Ctrl+P prints the newest. */
const open: HTMLElement[] = [];

export function registerPrintableSheet(el: HTMLElement): () => void {
  open.push(el);
  return () => { const i = open.indexOf(el); if (i >= 0) open.splice(i, 1); };
}

function mount(sheet: HTMLElement) {
  unmount();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.appendChild(cloneSheet(sheet));
  document.body.appendChild(host);
  document.documentElement.classList.add(PRINTING);
}

function unmount() {
  document.getElementById(HOST_ID)?.remove();
  document.documentElement.classList.remove(PRINTING);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => {
    if (document.getElementById(HOST_ID)) return; // the พิมพ์ button already set it up
    const sheet = open[open.length - 1];
    if (sheet?.isConnected) mount(sheet);
  });
  window.addEventListener('afterprint', unmount);
}

/** In-app browsers (LINE, Facebook) ignore window.print(): there the PDF is opened instead. */
export function canPrintNatively(): boolean {
  if (typeof window.print !== 'function') return false;
  return !/\bLine\/|FBAN|FBAV|Instagram/i.test(navigator.userAgent);
}

/** Open the browser's print dialog for this sheet only. */
export function printSheet(sheet: HTMLElement): void {
  mount(sheet);
  window.print();
  // afterprint clears it; a browser whose print() returns before the dialog closes still fires afterprint later
}
