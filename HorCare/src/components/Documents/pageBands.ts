/**
 * Where a tall document is cut into A4 pages. Cuts fall only between blocks (paragraphs, table rows, the signature
 * block), never through a line of text; a single block taller than a page is the only thing ever split.
 *
 * All values are in the document's CSS pixels. The first page starts at the top of the sheet (its own top padding is
 * the page margin); later pages get `margin` above and below.
 */
export interface Band { start: number; end: number }

export function pageBands(blocks: { top: number; bottom: number }[], total: number, pageHeight: number, margin: number): Band[] {
  const inside = (y: number) => blocks.some(b => b.top < y - 0.5 && b.bottom > y + 0.5);
  // a cut just below a block, where no other block is in the way
  const cuts = [...new Set(blocks.map(b => Math.ceil(b.bottom)))].filter(y => !inside(y)).sort((a, b) => a - b);
  const lastContent = blocks.length ? Math.max(...blocks.map(b => b.bottom)) : total;

  const bands: Band[] = [];
  let start = 0;
  while (start < total) {
    const room = bands.length === 0 ? pageHeight - margin : pageHeight - 2 * margin;
    const limit = start + room;
    if (limit >= total) { bands.push({ start, end: total }); break; }
    let cut = Math.max(start, ...cuts.filter(y => y <= limit));
    if (cut <= start + room * 0.2) cut = limit; // nothing to cut between (one block taller than a page): split it
    bands.push({ start, end: cut });
    start = cut;
    if (start >= lastContent - 0.5) break; // only the bottom padding is left: no blank page
  }
  return bands;
}
