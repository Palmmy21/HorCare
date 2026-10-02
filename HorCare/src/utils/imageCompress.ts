/** Shrink a photo onto a canvas and return base64 JPEG (without the data-URL header). */
export async function compressImage(file: File, maxSide = 1200): Promise<{ base64: string; mimeType: string }> {
    const url = URL.createObjectURL(file);
    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error('cannot decode image'));
            el.src = url;
        });
        let { width, height } = img;
        if (width > maxSide || height > maxSide) {
            const ratio = Math.min(maxSide / width, maxSide / height);
            width = Math.round(width * ratio);
            height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height);

        // Lower the quality until it fits the API's size guard.
        let quality = 0.82;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        while (dataUrl.length > 5_500_000 && quality > 0.3) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
    } finally {
        URL.revokeObjectURL(url);
    }
}
