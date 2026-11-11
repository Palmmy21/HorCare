// @vitest-environment node
// The slip QR is found in real-looking pictures: a small QR low on a tall phone screenshot, recompressed as JPEG.
import { describe, expect, it, vi } from 'vitest';
import QRCode from 'qrcode';
import { Jimp } from 'jimp';

vi.mock('./_firebase.js', () => ({ admin: {} }));
import { decodeSlipQR } from './_slip.js';

const PAYLOAD = '0046000600000101030140225202611111234567890123456785102TH91049C3A';

async function slipPicture(qrSide: number, x: number, y: number, quality = 60): Promise<Buffer> {
    const qr = await Jimp.read(await QRCode.toBuffer(PAYLOAD, { margin: 1, width: qrSide }));
    const page = new Jimp({ width: 1080, height: 2200, color: 0xffffffff });
    // some "text" lines so it is not a blank page
    for (let i = 0; i < 20; i++) page.composite(new Jimp({ width: 700, height: 18, color: 0x333333ff }), 120, 180 + i * 60);
    page.composite(qr, x, y);
    return page.getBuffer('image/jpeg', { quality });
}

describe('finding the QR on a slip', () => {
    it('reads a small QR in the bottom-right of a tall JPEG screenshot', async () => {
        const r = await decodeSlipQR(await slipPicture(150, 860, 1950));
        expect(r.payload).toBe(PAYLOAD);
        expect(r.looksLikeSlip).toBe(true);
    }, 30_000);

    it('reads a QR in the middle, and says nothing for a picture with no QR', async () => {
        expect((await decodeSlipQR(await slipPicture(260, 410, 1500))).payload).toBe(PAYLOAD);
        const plain = await new Jimp({ width: 600, height: 800, color: 0xffffffff }).getBuffer('image/jpeg');
        expect(await decodeSlipQR(plain)).toEqual({ payload: null, looksLikeSlip: false });
    }, 30_000);
});
