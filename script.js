document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const workspace = document.getElementById('workspace');
    const resultsGrid = document.getElementById('results-grid');
    const processBtn = document.getElementById('process-btn');
    const downloadStickerBtn = document.getElementById('download-sticker-btn');
    const resetBtn = document.getElementById('reset-btn');
    const addMoreCell = document.getElementById('add-more-cell');
    const mainTitle = document.getElementById('main-title');
    const btnText = document.querySelector('.btn-text');
    const spinner = document.querySelector('.loading-spinner');

    // Lightbox Elements
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.querySelector('.lightbox-close');

    // Lightbox State
    let scale = 1;
    let pointX = 0;
    let pointY = 0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;

    // Lightbox Logic
    const updateTransform = () => {
        lightboxImg.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
    };

    const resetLightbox = () => {
        scale = 1;
        pointX = 0;
        pointY = 0;
        isDragging = false;
        updateTransform();
    };

    // Preset buttons
    const presetBtns = document.querySelectorAll('.preset-card');
    const activePresetEl = document.querySelector('.preset-card.active');

    // Constants
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
    const PRESETS = {
        mild: {
            iterations: 10,
            quality: 0.2,
            greenLevel: 20,
            blurAmount: 0.8,
            scaleFactor: 0.98
        },
        medium: {
            iterations: 20,
            quality: 0.15,
            greenLevel: 70,
            blurAmount: 1.5,
            scaleFactor: 0.9
        },
        heavy: {
            iterations: 35,
            quality: 0.05,
            greenLevel: 50,
            blurAmount: 2.0,
            scaleFactor: 0.8
        }
    };

    // State
    let fileQueue = []; // Array of { file, id, processedBlob }
    let currentPreset = (activePresetEl && activePresetEl.dataset.preset) || 'medium';
    let isProcessing = false;

    // Worker pool
    const WORKER_POOL_SIZE = Math.min(navigator.hardwareConcurrency || 2, 4);
    let workerPool = [];

    function getWorkerPool() {
        if (workerPool.length > 0) return workerPool;
        for (let i = 0; i < WORKER_POOL_SIZE; i++) {
            try {
                workerPool.push(new Worker('image-worker.js'));
            } catch (e) {
                console.warn('Worker 创建失败，将使用主线程处理', e);
            }
        }
        return workerPool;
    }

    function readFileAsArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }



    // Lightbox: click image to open; skip delete / add-more clicks
    resultsGrid.addEventListener('click', (e) => {
        if (e.target.closest('.result-item-delete') || e.target.closest('.add-more-cell')) return;
        if (e.target.tagName === 'IMG') {
            lightboxImg.src = e.target.src;
            resetLightbox();
            lightbox.classList.remove('hidden');
        }
    });

    lightboxClose.addEventListener('click', () => {
        lightbox.classList.add('hidden');
    });

    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
            lightbox.classList.add('hidden');
        }
    });

    lightbox.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        scale += delta;
        scale = Math.min(Math.max(0.1, scale), 5);
        updateTransform();
    });

    lightboxImg.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX - pointX;
        startY = e.clientY - pointY;
        e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        pointX = e.clientX - startX;
        pointY = e.clientY - startY;
        updateTransform();
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Touch support for Lightbox (mobile)
    let lastTouchDist = 0;
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouchDragging = false;

    lightboxImg.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
            // Pinch-to-zoom start
            lastTouchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        } else if (e.touches.length === 1) {
            // Single finger drag start
            isTouchDragging = true;
            touchStartX = e.touches[0].clientX - pointX;
            touchStartY = e.touches[0].clientY - pointY;
        }
        e.preventDefault();
    }, { passive: false });

    lightbox.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
            // Pinch-to-zoom
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            if (lastTouchDist > 0) {
                const delta = (dist - lastTouchDist) * 0.01;
                scale = Math.min(Math.max(0.1, scale + delta), 5);
                updateTransform();
            }
            lastTouchDist = dist;
            e.preventDefault();
        } else if (e.touches.length === 1 && isTouchDragging) {
            // Single finger drag
            pointX = e.touches[0].clientX - touchStartX;
            pointY = e.touches[0].clientY - touchStartY;
            updateTransform();
            e.preventDefault();
        }
    }, { passive: false });

    lightbox.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) lastTouchDist = 0;
        if (e.touches.length === 0) isTouchDragging = false;
    });

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.style.background = '#FAFAFA';
    });
    uploadZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadZone.style.background = '';
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.style.background = '';
        if (e.dataTransfer.files.length) {
            handleFiles(Array.from(e.dataTransfer.files));
        }
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFiles(Array.from(e.target.files));
        }
        e.target.value = '';
    });

    if (addMoreCell) addMoreCell.addEventListener('click', () => fileInput.click());

    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            presetBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPreset = btn.dataset.preset;
        });
    });

    processBtn.addEventListener('click', async () => {
        if (fileQueue.length === 0 || isProcessing) return;
        await processBatch();
    });

    resetBtn.addEventListener('click', () => {
        fileQueue = [];
        isProcessing = false;
        while (resultsGrid.firstChild) resultsGrid.removeChild(resultsGrid.firstChild);
        workspace.classList.add('hidden');
        uploadZone.style.display = '';
        fileInput.value = '';
        // Title is managed by GSAP animation — no change needed
        if (addMoreCell) resultsGrid.appendChild(addMoreCell);
        downloadStickerBtn.classList.add('disabled');
        document.querySelector('.app-container').classList.remove('workspace-active');
    });

    downloadStickerBtn.addEventListener('click', () => {
        if (downloadStickerBtn.classList.contains('disabled')) return;
        downloadBatch(true);
    });

    async function downloadBatch(isSticker) {
        if (fileQueue.some(item => !item.processedBlob)) return;

        const link = document.createElement('a');

        // Single file: download directly
        if (fileQueue.length === 1) {
            let blob = fileQueue[0].processedBlob;
            if (isSticker) blob = await resizeImageBlob(blob, 150);
            link.href = URL.createObjectURL(blob);
            link.download = `${isSticker ? 'sticker' : 'patina'}_${Date.now()}.jpg`;
            link.click();
            return;
        }

        // Multiple files: pack as ZIP
        const zip = new JSZip();
        for (let i = 0; i < fileQueue.length; i++) {
            const item = fileQueue[i];
            if (item.processedBlob) {
                let blob = item.processedBlob;
                let filename = `patina_${i + 1}.jpg`;
                if (isSticker) {
                    blob = await resizeImageBlob(blob, 150);
                    filename = `sticker_${i + 1}.jpg`;
                }
                zip.file(filename, blob);
            }
        }

        const content = await zip.generateAsync({ type: "blob" });
        link.href = URL.createObjectURL(content);
        link.download = `electronic_patina_${isSticker ? 'stickers' : 'original'}_${Date.now()}.zip`;
        link.click();
    }

    function resizeImageBlob(blob, targetWidth) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const ratio = img.height / img.width;
                const targetHeight = targetWidth * ratio;

                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');

                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
                canvas.toBlob(resolve, 'image/jpeg', 0.9);
            };
            img.src = URL.createObjectURL(blob);
        });
    }


    function compressIfNeeded(file) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                if (img.width <= 1024) {
                    resolve(file);
                    return;
                }
                const targetWidth = 800;
                const ratio = img.height / img.width;
                const targetHeight = Math.round(targetWidth * ratio);

                const canvas = document.createElement('canvas');
                canvas.width = targetWidth;
                canvas.height = targetHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

                canvas.toBlob((blob) => {
                    const compressedFile = new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    });
                    resolve(compressedFile);
                }, 'image/jpeg', 0.92);
            };
            img.onerror = () => resolve(file);
            img.src = URL.createObjectURL(file);
        });
    }

    async function handleFiles(files) {
        const validFiles = files.filter(f => {
            if (!f.type.match('image.*')) return false;
            if (f.size > MAX_FILE_SIZE) return false;
            return true;
        });

        if (validFiles.length === 0) {
            alert('Please upload image files under 5MB.');
            return;
        }

        const wasEmpty = fileQueue.length === 0;


        for (const file of validFiles) {
            const compressed = await compressIfNeeded(file);
            const id = Math.random().toString(36).substr(2, 9);
            fileQueue.push({
                id: id,
                file: compressed,
                processedBlob: null
            });
            createGridItem(id, compressed);
        }

        if (wasEmpty) {
            uploadZone.style.display = 'none';
            workspace.classList.remove('hidden');

            document.querySelector('.app-container').classList.add('workspace-active');
        }
    }

    function removeItem(id) {
        fileQueue = fileQueue.filter(item => item.id !== id);
        const el = document.getElementById(`item-${id}`);
        if (el) el.remove();
        updateDownloadButtons();
        if (fileQueue.length === 0) {
            workspace.classList.add('hidden');
            uploadZone.style.display = '';
            fileInput.value = '';

            downloadStickerBtn.classList.add('disabled');
            document.querySelector('.app-container').classList.remove('workspace-active');
        }
    }

    function updateDownloadButtons() {
        const allProcessed = fileQueue.length > 0 && fileQueue.every(item => item.processedBlob);
        if (allProcessed) downloadStickerBtn.classList.remove('disabled');
        else downloadStickerBtn.classList.add('disabled');
    }

    function createGridItem(id, file) {
        const div = document.createElement('div');
        div.className = 'result-item';
        div.id = `item-${id}`;

        const img = document.createElement('img');
        const reader = new FileReader();
        reader.onload = e => img.src = e.target.result;
        reader.readAsDataURL(file);

        const status = document.createElement('div');
        status.className = 'result-status';
        status.textContent = 'Pending';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'result-item-delete';
        delBtn.setAttribute('aria-label', '删除');
        delBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="pointer-events:none;">
            <path d="M8.4 17L7 15.6L10.6 12L7 8.42499L8.4 7.02499L12 10.625L15.575 7.02499L16.975 8.42499L13.375 12L16.975 15.6L15.575 17L12 13.4L8.4 17Z" fill="white"/>
        </svg>`;
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeItem(id);
        });

        div.appendChild(img);
        div.appendChild(status);
        div.appendChild(delBtn);
        if (addMoreCell) resultsGrid.insertBefore(div, addMoreCell);
        else resultsGrid.appendChild(div);
    }

    async function processBatch() {
        isProcessing = true;
        setLoading(true);
        downloadStickerBtn.classList.add('disabled');
        resetBtn.classList.add('disabled');

        const settings = PRESETS[currentPreset];
        const pool = getWorkerPool();

        if (pool.length === 0) {
            // Fallback: process on main thread when no workers available
            for (const item of fileQueue) {
                const itemEl = document.getElementById(`item-${item.id}`);
                const statusEl = itemEl.querySelector('.result-status');
                itemEl.classList.add('processing');
                statusEl.textContent = 'Processing...';
                try {
                    const blob = await applyPatinaToImage(item.file, settings);
                    item.processedBlob = blob;
                    itemEl.querySelector('img').src = URL.createObjectURL(blob);
                    itemEl.classList.remove('processing');
                    itemEl.classList.add('done');
                } catch (error) {
                    console.error(error);
                    statusEl.textContent = 'Failed';
                }
            }
            setLoading(false);
            isProcessing = false;
            downloadStickerBtn.classList.remove('disabled');
            resetBtn.classList.remove('disabled');
            return;
        }

        // Read all files as ArrayBuffers in parallel
        const buffers = await Promise.all(fileQueue.map(item => readFileAsArrayBuffer(item.file)));
        const pendingTasks = fileQueue.map((item, i) => ({
            id: item.id,
            imageBuffer: buffers[i],
            settings
        }));
        let completed = 0;
        const total = pendingTasks.length;

        function assignNext(worker) {
            if (pendingTasks.length === 0) {
                if (completed === total) done();
                return;
            }
            const task = pendingTasks.shift();
            worker.postMessage(task, [task.imageBuffer]);
        }

        function done() {
            setLoading(false);
            isProcessing = false;
            updateDownloadButtons();
            resetBtn.classList.remove('disabled');
        }

        function onWorkerMessage(worker, e) {
            const { id, blob, error } = e.data;
            const item = fileQueue.find(x => x.id === id);
            const itemEl = document.getElementById(`item-${id}`);
            const statusEl = itemEl?.querySelector('.result-status');

            if (error) {
                console.error('Worker 处理失败:', error);
                if (statusEl) statusEl.textContent = 'Failed';
                itemEl?.classList.remove('processing');
            } else {
                item.processedBlob = blob;
                if (itemEl) {
                    itemEl.querySelector('img').src = URL.createObjectURL(blob);
                    itemEl.classList.remove('processing');
                    itemEl.classList.add('done');
                }
            }
            completed++;
            assignNext(worker);
        }

        // Mark all items as processing and dispatch to workers
        fileQueue.forEach(item => {
            const itemEl = document.getElementById(`item-${item.id}`);
            if (itemEl) {
                itemEl.classList.add('processing');
                const statusEl = itemEl.querySelector('.result-status');
                if (statusEl) statusEl.textContent = 'Processing...';
            }
        });

        pool.forEach(worker => {
            worker.onmessage = (e) => onWorkerMessage(worker, e);
            worker.onerror = () => {
                completed++;
                if (completed === total) done();
            };
            assignNext(worker);
        });
    }

    function applyPatinaToImage(file, settings) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = async () => {
                    const blob = await processImageOnCanvas(img, settings);
                    resolve(blob);
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function processImageOnCanvas(img, { iterations, quality, greenLevel, blurAmount, scaleFactor }) {
        const MAX_DIM = 1000;
        let w = img.width;
        let h = img.height;
        if (w > MAX_DIM || h > MAX_DIM) {
            const ratio = w / h;
            if (w > h) { w = MAX_DIM; h = MAX_DIM / ratio; }
            else { h = MAX_DIM; w = MAX_DIM * ratio; }
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        let currentDataUrl = canvas.toDataURL('image/jpeg', 1.0);

        const loopCount = Math.ceil(iterations / 2);

        for (let i = 0; i < loopCount; i++) {
            await new Promise(resolve => {
                const tmpImg = new Image();
                tmpImg.onload = () => {
                    const s = scaleFactor - (Math.random() * 0.02);
                    const sw = w * s;
                    const sh = h * s;

                    ctx.drawImage(tmpImg, 0, 0, sw, sh);
                    ctx.drawImage(canvas, 0, 0, sw, sh, 0, 0, w, h);

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
                    resolve();
                };
                tmpImg.src = currentDataUrl;
            });
            if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
        }

        return new Promise(resolve => {
            const final = new Image();
            final.onload = () => {
                ctx.filter = `contrast(1.1) brightness(0.95)`;
                ctx.drawImage(final, 0, 0, w, h);
                ctx.filter = 'none';
                canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
            };
            final.src = currentDataUrl;
        });
    }

    function setLoading(isLoading) {
        if (isLoading) {
            processBtn.classList.add('disabled');
            if (spinner) spinner.classList.remove('hidden');
            if (btnText) btnText.textContent = 'Processing...';
        } else {
            processBtn.classList.remove('disabled');
            if (spinner) spinner.classList.add('hidden');
            if (btnText) btnText.textContent = 'Apply Patina';
        }
    }
});
