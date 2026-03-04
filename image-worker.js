

async function processPatinaInWorker(imageBuffer, settings) {
    const { iterations, quality, greenLevel, blurAmount, scaleFactor } = settings;
    const MAX_DIM = 1000;

    const blob = new Blob([imageBuffer]);
    const bitmap = await createImageBitmap(blob);
    let w = bitmap.width;
    let h = bitmap.height;
    if (w > MAX_DIM || h > MAX_DIM) {
        const ratio = w / h;
        if (w > h) {
            w = MAX_DIM;
            h = Math.round(MAX_DIM / ratio);
        } else {
            h = MAX_DIM;
            w = Math.round(MAX_DIM * ratio);
        }
    }

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const loopCount = Math.ceil(iterations / 2);

    // OffscreenCanvas does not support toDataURL; iterate via convertToBlob + createImageBitmap
    let currentBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 1.0 });

    for (let i = 0; i < loopCount; i++) {
        const tmpBitmap = await createImageBitmap(currentBlob);

        const s = scaleFactor - (Math.random() * 0.02);
        const sw = w * s;
        const sh = h * s;

        ctx.drawImage(tmpBitmap, 0, 0, sw, sh);
        ctx.drawImage(canvas, 0, 0, sw, sh, 0, 0, w, h);
        tmpBitmap.close();

        if (blurAmount > 0) {
            ctx.filter = `blur(${blurAmount * 0.5}px) contrast(1.05)`;
            ctx.drawImage(canvas, 0, 0);
            ctx.filter = 'none';
        }

        if (greenLevel > 0) {
            const alpha = (greenLevel / 100) * 0.03;
            ctx.fillStyle = `rgba(0, 255, 0, ${alpha})`;
            ctx.globalCompositeOperation = 'overlay';
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';
        }

        const q = Math.max(0.01, quality * (0.9 + Math.random() * 0.2));
        currentBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: q });
    }

    // Final pass: apply contrast/brightness and output blob
    const finalBitmap = await createImageBitmap(currentBlob);
    ctx.filter = 'contrast(1.1) brightness(0.95)';
    ctx.drawImage(finalBitmap, 0, 0, w, h);
    ctx.filter = 'none';
    finalBitmap.close();

    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

self.onmessage = async (e) => {
    const { id, imageBuffer, settings } = e.data;
    try {
        const blob = await processPatinaInWorker(imageBuffer, settings);
        self.postMessage({ id, blob });
    } catch (err) {
        self.postMessage({ id, error: err.message || String(err) });
    }
};
