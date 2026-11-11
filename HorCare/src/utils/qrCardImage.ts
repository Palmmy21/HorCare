// A room's registration QR as a JPEG picture: the same card that is printed (property name, room, QR, how to use it,
// the code), drawn on a canvas so it can be saved, sent in a chat or handed to a print shop. Browser only.
import QRCode from 'qrcode';

export interface QrCardInput {
    /** What the QR opens: `<app>/r/<code>`. */
    link: string;
    /** "ห้อง", "แผง", … */
    unitName: string;
    roomNumber: string;
    dormName?: string;
    code: string;
}

const W = 1080;
const H = 1440;
const QR_SIZE = 760;
const FONT = "Anuphan, 'Leelawadee UI', 'Noto Sans Thai', sans-serif";

/** Shrink the font until the text fits the card's width. */
function fitText(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, maxWidth: number): void {
    let px = size;
    do {
        ctx.font = `${weight} ${px}px ${FONT}`;
        px -= 4;
    } while (ctx.measureText(text).width > maxWidth && px > 24);
}

export async function renderQrCardJpeg(card: QrCardInput): Promise<Blob> {
    // canvas text uses the page's fonts only once they are loaded
    await document.fonts?.ready;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas unavailable');

    ctx.fillStyle = '#FFFFFF';                       // JPEG has no transparency
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (card.dormName) {
        ctx.fillStyle = '#557089';
        fitText(ctx, card.dormName, 500, 48, W - 160);
        ctx.fillText(card.dormName, W / 2, 110);
    }
    ctx.fillStyle = '#102A43';
    const title = `${card.unitName} ${card.roomNumber}`;
    fitText(ctx, title, 800, 112, W - 160);
    ctx.fillText(title, W / 2, 220);

    // level M, as on the printed card: a card on a door gets scuffed. Drawn module by module so the edges stay sharp.
    const qr = QRCode.create(card.link, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const quiet = 2;
    const cell = Math.floor(QR_SIZE / (n + quiet * 2));
    const size = cell * (n + quiet * 2);
    const left = Math.round((W - size) / 2);
    const top = 320;
    ctx.fillStyle = '#000000';
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (qr.modules.get(y, x)) ctx.fillRect(left + (x + quiet) * cell, top + (y + quiet) * cell, cell, cell);
        }
    }

    ctx.fillStyle = '#334E68';
    ctx.font = `500 44px ${FONT}`;
    ctx.fillText('สแกนด้วยมือถือ แล้วทำตามหน้าจอ', W / 2, top + size + 90);
    ctx.fillText('รับบิลและแจ้งชำระผ่าน LINE ได้ทันที', W / 2, top + size + 150);
    ctx.fillStyle = '#8FA3B8';
    ctx.font = `500 34px ui-monospace, Menlo, Consolas, monospace`;
    ctx.fillText(card.code, W / 2, top + size + 240);

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('could not make the image'))), 'image/jpeg', 0.92);
    });
}

/** Hand a file to the browser to save. */
export function downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
