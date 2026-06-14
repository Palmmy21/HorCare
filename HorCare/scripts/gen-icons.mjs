// One-off: generate app logo + PWA icons from the master logo PNGs.
// Usage: node scripts/gen-icons.mjs <full-logo.png> <compact-logo.png>
import { Jimp } from 'jimp';

const [, , srcFull, srcIcon] = process.argv;
if (!srcFull || !srcIcon) {
    console.error('usage: node scripts/gen-icons.mjs <full-logo.png> <compact-logo.png>');
    process.exit(1);
}

const OUT = new URL('../public/', import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, '$1');

async function resizeTo(src, size) {
    const img = await Jimp.read(src);
    img.resize({ w: size, h: size });
    return img;
}

// Solid-white canvas with the logo composited on top (iOS / maskable need
// an opaque background — transparent edges render black or get cropped).
// `scale` shrinks the logo into the canvas to create a safe zone.
async function onWhite(src, size, scale = 1) {
    const canvas = new Jimp({ width: size, height: size, color: 0xffffffff });
    const inner = Math.round(size * scale);
    const img = await resizeTo(src, inner);
    canvas.composite(img, Math.round((size - inner) / 2), Math.round((size - inner) / 2));
    return canvas;
}

// Full logo — login page + og:image
await (await resizeTo(srcFull, 1024)).write(`${OUT}logo.png`);

// Compact mark (transparent) — sidebar, favicon, push notifications
await (await resizeTo(srcIcon, 512)).write(`${OUT}logo-icon.png`);

// PWA icons
await (await resizeTo(srcIcon, 192)).write(`${OUT}pwa-192.png`);
await (await resizeTo(srcIcon, 512)).write(`${OUT}pwa-512.png`);
// maskable: keep the mark inside the central ~80% safe zone so the
// launcher's circle/squircle mask doesn't clip it
await (await onWhite(srcIcon, 512, 0.78)).write(`${OUT}pwa-maskable-512.png`);

// iOS home-screen icon — slight breathing room, iOS rounds the corners itself
await (await onWhite(srcIcon, 180, 0.88)).write(`${OUT}apple-touch-icon.png`);

console.log('icons generated in', OUT);
