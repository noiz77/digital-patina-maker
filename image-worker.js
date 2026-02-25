/**
 * 图片包浆处理 Web Worker
 * 使用 OffscreenCanvas 在后台线程执行，不阻塞主线程；主线程可并发调度多 worker 提高吞吐。
 */

function dataURLToBlob(dataURL) {
    const [header, base64] = dataURL.split(',');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const mime = (header.match(/data:([^;]+);/) || [])[1] || 'image/jpeg';
    return new Blob([bytes], { type: mime });
}

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
    let currentDataUrl = canvas.toDataURL('image/jpeg', 1.0);

    for (let i = 0; i < loopCount; i++) {
        const frameBlob = dataURLToBlob(currentDataUrl);
        const tmpBitmap = await createImageBitmap(frameBlob);

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
        currentDataUrl = canvas.toDataURL('image/jpeg', q);
    }

    // 最后一帧：对比度/亮度后输出 Blob
    const finalBlob = dataURLToBlob(currentDataUrl);
    const finalBitmap = await createImageBitmap(finalBlob);
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
