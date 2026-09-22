/**
 * Safely converts a data URL (base64) to a Blob.
 * Avoids fetch(dataUrl) which can fail or be rejected in mobile webviews / Chromium browsers.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

/**
 * Robust download helper for mobile (Samsung Internet, Chrome Android, Safari iOS) and desktop.
 * Converts data URL or Blob to an Object URL and clicks a temporary download anchor.
 * Ensures compatibility with Android Chromium / Samsung security policies that block direct data: URI downloads.
 */
export function triggerFileDownload(blobOrDataUrl: Blob | string, fileName: string): void {
    const blob = typeof blobOrDataUrl === 'string' ? dataUrlToBlob(blobOrDataUrl) : blobOrDataUrl;
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
    }, 2500);
}
