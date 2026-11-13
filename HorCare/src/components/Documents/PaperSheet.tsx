import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './documents.css';

/** A4 at 96 dpi. The page is always laid out at this width, so lines break the same on a phone and on paper. */
export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = Math.round((A4_WIDTH_PX * 297) / 210);

/** Below this width a scaled A4 page is too small to read, so the text re-flows to the screen instead. */
const FLUID_BELOW_PX = 560;

/**
 * A document page that looks like the printed one: laid out at A4 width and scaled down to fit the space. On a phone
 * the scaled page would be unreadable, so there it re-flows to the screen width (with the same wrapping rules, so
 * nothing runs off the edge). The PDF is always drawn from the A4 layout (paperPdf.ts).
 *
 * Mark each piece the PDF may not split (a paragraph, a table row, the signature block) with `className="doc-block"`.
 */
export function PaperSheet({ children, onSheet }: { children: ReactNode; /** the page element, for PDF export */ onSheet?: (el: HTMLDivElement | null) => void }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ scale: 1, height: A4_HEIGHT_PX, left: 0, fluid: false });

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const avail = outer.clientWidth;
      if (avail < FLUID_BELOW_PX) { setBox(b => (b.fluid ? b : { scale: 1, height: 0, left: 0, fluid: true })); return; }
      const scale = Math.min(1, avail / A4_WIDTH_PX);
      setBox({ scale, height: inner.offsetHeight * scale, left: Math.max(0, (avail - A4_WIDTH_PX * scale) / 2), fluid: false });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
    // the sheet element is a new one after switching between paper and re-flowed: observe that one
  }, [box.fluid]);

  const setInner = (el: HTMLDivElement | null) => {
    innerRef.current = el;
    onSheet?.(el);
  };

  return (
    <div ref={outerRef} style={{ width: '100%' }}>
      {box.fluid ? (
        <div ref={setInner} className="doc-sheet doc-sheet--fluid">{children}</div>
      ) : (
        <div style={{ position: 'relative', height: box.height }}>
          <div style={{ position: 'absolute', top: 0, left: box.left, width: A4_WIDTH_PX, transform: `scale(${box.scale})`, transformOrigin: 'top left' }}>
            <div ref={setInner} className="doc-sheet">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}
