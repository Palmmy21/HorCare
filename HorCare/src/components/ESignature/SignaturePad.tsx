import { useRef, useState, useEffect, useCallback } from 'react';
import { RotateCcw, Trash2, Download, Check, PenTool } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

interface SignaturePadProps {
  onSave: (dataUrl: string) => void;
  initialDataUrl?: string;
  label?: string;
  subtitle?: string;
  signerName?: string;
  height?: number;
}

export default function SignaturePad({
  onSave,
  initialDataUrl,
  label = 'ลงลายมือชื่ออิเล็กทรอนิกส์ (Digital Signature)',
  subtitle = 'ใช้เมาส์ หรือนิ้วมือ / ปากกาสไตลัส เพื่อลงลายมือชื่อ',
  signerName,
  height = 190,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [inkColor, setInkColor] = useState<string>('#1D4ED8'); // Default royal blue
  const [strokeWidth, setStrokeWidth] = useState<number>(2.5);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Point[]>([]);
  const [hasSignature, setHasSignature] = useState(false);

  // Redraw all strokes on canvas with high DPI and quadratic curves
  const redrawCanvas = useCallback((allStrokes: Stroke[], previewUrl?: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If an initial image exists and no strokes yet, render it
    if (previewUrl && allStrokes.length === 0) {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
      };
      img.src = previewUrl;
      return;
    }

    // Render each stroke with smooth curves
    allStrokes.forEach(stroke => {
      if (stroke.points.length === 0) return;
      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.points.length === 1) {
        ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.width / 2, 0, Math.PI * 2);
        ctx.fillStyle = stroke.color;
        ctx.fill();
        return;
      }

      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length - 1; i++) {
        const xc = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
        const yc = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, xc, yc);
      }
      // Last point
      const last = stroke.points[stroke.points.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    });
  }, []);

  // Setup DPI scaling and resize handling
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
      redrawCanvas(strokes, initialDataUrl);
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [height, initialDataUrl, redrawCanvas, strokes]);

  // Set initial signature if provided
  useEffect(() => {
    if (initialDataUrl) {
      setHasSignature(true);
      redrawCanvas([], initialDataUrl);
    }
  }, [initialDataUrl, redrawCanvas]);

  // Coordinates helper
  const getCoordinates = (e: React.MouseEvent | React.TouchEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    if ('touches' in e) {
      e.stopPropagation();
    }
    const pt = getCoordinates(e);
    if (!pt) return;
    setIsDrawing(true);
    setCurrentStroke([pt]);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    if ('touches' in e) {
      e.stopPropagation();
    }
    const pt = getCoordinates(e);
    if (!pt) return;

    const newStroke = [...currentStroke, pt];
    setCurrentStroke(newStroke);

    // Fast local rendering of active stroke
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (newStroke.length >= 2) {
      const p1 = newStroke[newStroke.length - 2];
      const p2 = newStroke[newStroke.length - 1];
      ctx.beginPath();
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (currentStroke.length > 0) {
      const completedStroke: Stroke = {
        points: currentStroke,
        color: inkColor,
        width: strokeWidth,
      };
      const updatedStrokes = [...strokes, completedStroke];
      setStrokes(updatedStrokes);
      setCurrentStroke([]);
      setHasSignature(true);
      redrawCanvas(updatedStrokes);

      // Export base64
      exportSignature();
    }
  };

  const exportSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    onSave(dataUrl);
  };

  const handleClear = () => {
    setStrokes([]);
    setCurrentStroke([]);
    setHasSignature(false);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    onSave('');
  };

  const handleUndo = () => {
    if (strokes.length === 0) return;
    const updated = strokes.slice(0, -1);
    setStrokes(updated);
    if (updated.length === 0) {
      setHasSignature(false);
      onSave('');
    }
    redrawCanvas(updated);
    if (updated.length > 0) {
      setTimeout(exportSignature, 50);
    }
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasSignature) return;
    const link = document.createElement('a');
    link.download = `signature-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div
      onClick={e => e.stopPropagation()}
      style={{
        background: '#FFFFFF',
        border: '1.5px solid var(--color-gray-200)',
        borderRadius: '16px',
        padding: '1.25rem',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.04)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--color-gray-800)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <PenTool size={16} color="#2563EB" />
            {label}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--color-gray-500)', marginTop: '2px' }}>
            {signerName ? `ผู้ลงนาม: ${signerName}` : subtitle}
          </div>
        </div>

        {/* Toolbar: Color & Stroke width */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Ink color */}
          <div style={{ display: 'flex', background: 'var(--color-gray-100)', padding: '2px', borderRadius: '8px' }}>
            {[
              { color: '#1D4ED8', label: 'น้ำเงิน' },
              { color: '#111827', label: 'ดำ' },
            ].map(c => (
              <button
                key={c.color}
                type="button"
                onClick={() => setInkColor(c.color)}
                style={{
                  width: '26px',
                  height: '24px',
                  borderRadius: '6px',
                  border: 'none',
                  background: inkColor === c.color ? '#FFFFFF' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  boxShadow: inkColor === c.color ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                }}
                title={`หมึก${c.label}`}
              >
                <span style={{ width: 12, height: 12, borderRadius: '50%', background: c.color }} />
              </button>
            ))}
          </div>

          {/* Stroke thickness */}
          <div style={{ display: 'flex', background: 'var(--color-gray-100)', padding: '2px', borderRadius: '8px' }}>
            {[
              { width: 2, label: 'ปกติ' },
              { width: 3.5, label: 'หนา' },
            ].map(w => (
              <button
                key={w.width}
                type="button"
                onClick={() => setStrokeWidth(w.width)}
                style={{
                  padding: '2px 8px',
                  borderRadius: '6px',
                  border: 'none',
                  background: strokeWidth === w.width ? '#FFFFFF' : 'transparent',
                  fontSize: '0.75rem',
                  fontWeight: strokeWidth === w.width ? 700 : 500,
                  color: strokeWidth === w.width ? 'var(--color-gray-800)' : 'var(--color-gray-500)',
                  cursor: 'pointer',
                  boxShadow: strokeWidth === w.width ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                }}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Canvas Container */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: `${height}px`,
          background: '#FAFAFA',
          border: '1.5px dashed var(--color-gray-300)',
          borderRadius: '12px',
          overflow: 'hidden',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          onTouchCancel={stopDrawing}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            cursor: 'crosshair',
          }}
        />

        {/* Signing Guide Baseline */}
        <div style={{
          position: 'absolute',
          bottom: '36px',
          left: '24px',
          right: '24px',
          borderBottom: '1px dashed rgba(156, 163, 175, 0.45)',
          pointerEvents: 'none',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          paddingBottom: '4px',
        }}>
          <span style={{ fontSize: '0.7rem', color: 'rgba(156, 163, 175, 0.8)', fontWeight: 600 }}>
            ✕ ลงลายมือชื่อเหนือเส้นนี้ (Sign above line)
          </span>
          {hasSignature && (
            <span style={{
              fontSize: '0.68rem',
              color: '#059669',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.2rem',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '0.1rem 0.4rem',
              borderRadius: '4px'
            }}>
              <Check size={11} strokeWidth={3} /> บันทึกลายเซ็นแล้ว
            </span>
          )}
        </div>
      </div>

      {/* Footer action buttons */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: '0.75rem',
        paddingTop: '0.5rem',
        borderTop: '1px solid var(--color-gray-100)',
      }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-gray-400)' }}>
          {strokes.length > 0 ? `${strokes.length} เส้นลายเซ็น` : 'ยังไม่มีลายเซ็น'}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={handleUndo}
            disabled={strokes.length === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.35rem 0.65rem',
              borderRadius: '8px',
              border: '1px solid var(--color-gray-200)',
              background: '#FFFFFF',
              color: strokes.length === 0 ? 'var(--color-gray-300)' : 'var(--color-gray-600)',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: strokes.length === 0 ? 'not-allowed' : 'pointer',
              transition: 'all 0.15s ease',
            }}
            title="ย้อนกลับเส้นล่าสุด"
          >
            <RotateCcw size={13} /> ย้อนกลับ
          </button>

          <button
            type="button"
            onClick={handleClear}
            disabled={!hasSignature && strokes.length === 0}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              padding: '0.35rem 0.65rem',
              borderRadius: '8px',
              border: '1px solid #FECACA',
              background: '#FFF5F5',
              color: '#DC2626',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: (!hasSignature && strokes.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (!hasSignature && strokes.length === 0) ? 0.5 : 1,
              transition: 'all 0.15s ease',
            }}
            title="ล้างเพื่อเซ็นใหม่"
          >
            <Trash2 size={13} /> ล้างใหม่
          </button>

          {hasSignature && (
            <button
              type="button"
              onClick={handleDownload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.35rem 0.65rem',
                borderRadius: '8px',
                border: '1px solid #BFDBFE',
                background: '#EFF6FF',
                color: '#2563EB',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              title="ดาวน์โหลดไฟล์ลายเซ็น PNG"
            >
              <Download size={13} /> PNG
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
