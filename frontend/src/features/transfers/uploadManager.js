import { getApiBaseUrl } from '@/lib/api';
import authService from '@/features/auth/authService';
import logger from '@/lib/logger';
// Chunks of one file sent at the same time. The server writes each at its own place in the file.
const PARALLEL_CHUNKS = 4;
const RESUME_KEY = 'telestore.uploadResume';

const chunkLength = (item, index) => Math.min(item.chunkSize, item.filesize - index * item.chunkSize);

function wait(ms, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
}

// Which server session belongs to which file, so a reload can continue it: the user picks the same
// file again (a page can't keep a file across a reload) and the missing chunks are sent.
const fileKey = (item) => [item.path, item.filename, item.filesize, item.file?.lastModified || 0].join('|');

function readResumeMap() {
    try {
        return JSON.parse(localStorage.getItem(RESUME_KEY) || '{}');
    }
    catch {
        return {};
    }
}

function readResumeId(item) {
    return readResumeMap()[fileKey(item)] || null;
}

function saveResumeId(item) {
    try {
        const map = readResumeMap();
        map[fileKey(item)] = item.uploadId;
        localStorage.setItem(RESUME_KEY, JSON.stringify(map));
    }
    catch {
        // Storage blocked: uploads still work, they just can't continue after a reload
    }
}

function clearResumeId(item) {
    try {
        const map = readResumeMap();
        delete map[fileKey(item)];
        localStorage.setItem(RESUME_KEY, JSON.stringify(map));
    }
    catch {
        // Storage blocked
    }
}

export class UploadManager {
    uploads = new Map();
    queue = [];
    activeUploads = new Set();
    maxConcurrentUploads = 2;
    listeners = [];
    constructor() {
        // Initialize UploadManager
    }
    // Subscribe to updates
    subscribe(listener) {
        this.listeners.push(listener);
        listener(this.getUploads());
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }
    notifyListeners() {
        const list = this.getUploads();
        this.listeners.forEach(l => l(list));
    }
    getUploads() {
        return Array.from(this.uploads.values());
    }
    getUpload(id) {
        return this.uploads.get(id);
    }
    generateId() {
        return 'up_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    }
    // Add file to upload queue
    addUpload(file, path = '/Home') {
        const id = this.generateId();
        const defaultChunkSize = 20 * 1024 * 1024; // 20 MB
        const totalChunks = Math.max(1, Math.ceil(file.size / defaultChunkSize));
        const item = {
            id,
            file,
            filename: file.name,
            filesize: file.size,
            path: path || '/Home',
            status: 'queued',
            progress: 0,
            bytesUploaded: 0,
            chunkIndex: 0,
            totalChunks,
            chunkSize: defaultChunkSize
        };
        this.uploads.set(id, item);
        this.queue.push(id);
        this.notifyListeners();
        this.processQueue();
        logger.info('[UploadManager] Added upload to queue', { id, filename: file.name, size: file.size });
        return id;
    }
    // Pause a specific upload
    pauseUpload(id) {
        const item = this.uploads.get(id);
        if (!item)
            return;
        if (item.status === 'uploading') {
            item.status = 'paused';
            if (item.abortController) {
                item.abortController.abort();
            }
            this.activeUploads.delete(id);
            logger.info('[UploadManager] Paused upload', { id, filename: item.filename, chunkIndex: item.chunkIndex });
        }
        else if (item.status === 'queued') {
            this.queue = this.queue.filter(qid => qid !== id);
            item.status = 'paused';
        }
        this.notifyListeners();
        this.processQueue();
    }
    // Resume a paused upload
    resumeUpload(id) {
        const item = this.uploads.get(id);
        if (!item || item.status !== 'paused')
            return;
        item.status = 'queued';
        item.error = undefined;
        if (!this.queue.includes(id)) {
            this.queue.push(id);
        }
        logger.info('[UploadManager] Resumed upload', { id, filename: item.filename, chunkIndex: item.chunkIndex });
        this.notifyListeners();
        this.processQueue();
    }
    // Cancel an upload (and tell backend to purge temporary storage)
    cancelUpload(id) {
        const item = this.uploads.get(id);
        if (!item)
            return;
        const wasActive = item.status === 'uploading';
        item.status = 'cancelled';
        item.endTime = new Date();
        if (item.abortController) {
            item.abortController.abort();
        }
        this.activeUploads.delete(id);
        this.queue = this.queue.filter(qid => qid !== id);
        // If server upload_id exists, tell backend to purge disk storage immediately
        if (item.uploadId) {
            this.abortServerSession(item.uploadId).catch(err => {
                logger.warn('[UploadManager] Failed to abort server session:', err);
            });
        }
        logger.info('[UploadManager] Cancelled upload', { id, filename: item.filename });
        this.notifyListeners();
        this.processQueue();
    }
    // Retry a failed or cancelled upload
    retryUpload(id) {
        const item = this.uploads.get(id);
        if (!item)
            return;
        item.status = 'queued';
        item.progress = 0;
        item.bytesUploaded = 0;
        item.chunkIndex = 0;
        item.uploadId = undefined;
        item.received = undefined;
        item.error = undefined;
        item.startTime = undefined;
        item.endTime = undefined;
        if (!this.queue.includes(id)) {
            this.queue.push(id);
        }
        this.notifyListeners();
        this.processQueue();
    }
    // Bulk Controls
    pauseAll() {
        this.uploads.forEach(item => {
            if (item.status === 'uploading' || item.status === 'queued') {
                this.pauseUpload(item.id);
            }
        });
    }
    resumeAll() {
        this.uploads.forEach(item => {
            if (item.status === 'paused') {
                this.resumeUpload(item.id);
            }
        });
    }
    cancelAll() {
        this.uploads.forEach(item => {
            if (item.status === 'uploading' || item.status === 'queued' || item.status === 'paused') {
                this.cancelUpload(item.id);
            }
        });
    }
    clearCompleted() {
        const toDelete = [];
        this.uploads.forEach((item, id) => {
            if (item.status === 'completed' || item.status === 'cancelled' || item.status === 'failed') {
                toDelete.push(id);
            }
        });
        toDelete.forEach(id => this.uploads.delete(id));
        this.notifyListeners();
    }
    async abortServerSession(uploadId) {
        try {
            const baseUrl = getApiBaseUrl() || '';
            const authHeaders = authService.getAuthHeaders();
            await fetch(`${baseUrl}/files/upload/abort`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...authHeaders,
                },
                credentials: 'include',
                body: JSON.stringify({ upload_id: uploadId })
            });
        }
        catch (e) {
            logger.error('Error aborting server upload session:', e);
        }
    }
    async processQueue() {
        while (this.queue.length > 0 && this.activeUploads.size < this.maxConcurrentUploads) {
            const nextId = this.queue.shift();
            if (!nextId)
                continue;
            const item = this.uploads.get(nextId);
            if (!item || item.status !== 'queued')
                continue;
            this.activeUploads.add(nextId);
            item.status = 'uploading';
            if (!item.startTime)
                item.startTime = new Date();
            this.notifyListeners();
            this.executeUpload(nextId);
        }
    }
    async executeUpload(id) {
        const item = this.uploads.get(id);
        if (!item)
            return;
        const baseUrl = getApiBaseUrl() || '';
        const authHeaders = authService.getAuthHeaders();
        try {
            // Step 1: Initialize session on backend if not already created. The same file to the
            // same folder after a page reload continues the server's session (resume_upload_id).
            if (!item.uploadId) {
                item.abortController = new AbortController();
                const initRes = await fetch(`${baseUrl}/files/upload/init`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...authHeaders,
                    },
                    credentials: 'include',
                    signal: item.abortController.signal,
                    body: JSON.stringify({
                        filename: item.filename,
                        filesize: item.filesize,
                        path: item.path,
                        resume_upload_id: readResumeId(item) || undefined,
                    })
                });
                if (!initRes.ok) {
                    const errData = await initRes.json().catch(() => ({}));
                    throw new Error(errData.detail || 'Failed to initialize chunked upload');
                }
                const initData = await initRes.json();
                item.uploadId = initData.upload_id;
                if (initData.chunk_size) {
                    item.chunkSize = initData.chunk_size;
                    item.totalChunks = Math.max(1, Math.ceil(item.filesize / item.chunkSize));
                }
                item.received = new Set(initData.received || []);
                item.bytesUploaded = [...item.received].reduce((sum, i) => sum + chunkLength(item, i), 0);
                saveResumeId(item);
            }
            item.received = item.received || new Set();
            // Step 2: Send the missing chunks, several at once (the server writes each at its own
            // place, so order doesn't matter). 429 means "the disk buffer is full, try shortly".
            item.abortController = new AbortController();
            const signal = item.abortController.signal;
            const pending = Array.from({ length: item.totalChunks }, (_, i) => i).filter((i) => !item.received.has(i));
            let fatal = null;
            let lastTime = Date.now();
            let lastLoaded = item.bytesUploaded;
            let currentSpeed = item.speed || 0;
            const reportProgress = () => {
                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000;
                if (timeDiff >= 0.3) {
                    const instantSpeed = (item.bytesUploaded - lastLoaded) / timeDiff;
                    currentSpeed = currentSpeed === 0 ? instantSpeed : 0.7 * currentSpeed + 0.3 * instantSpeed;
                    lastTime = now;
                    lastLoaded = item.bytesUploaded;
                }
                item.speed = currentSpeed;
                item.eta = currentSpeed > 0 ? Math.round((item.filesize - item.bytesUploaded) / currentSpeed) : 0;
                item.progress = Math.min(99, Math.round((item.bytesUploaded / item.filesize) * 100));
                item.chunkIndex = item.received.size;
                this.notifyListeners();
            };
            const sendChunk = async (index) => {
                const start = index * item.chunkSize;
                const blob = item.file.slice(start, start + chunkLength(item, index));
                let failures = 0;
                while (!signal.aborted && !fatal) {
                    try {
                        const res = await fetch(`${baseUrl}/files/upload/chunk/${encodeURIComponent(item.uploadId)}/${index}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/octet-stream', ...authHeaders },
                            credentials: 'include',
                            signal,
                            body: blob,
                        });
                        if (res.status === 429) {
                            const data = await res.json().catch(() => ({}));
                            await wait((Number(res.headers.get('Retry-After')) || data.retry_after || 3) * 1000, signal);
                            continue;
                        }
                        if (!res.ok) {
                            const data = await res.json().catch(() => ({}));
                            const detail = typeof data.detail === 'string' ? data.detail : data.detail?.message;
                            const error = new Error(detail || `Chunk upload failed (${res.status})`);
                            // The server gave up on this upload (a part failed on Telegram, bad chunk)
                            if (res.status === 400 || res.status === 404 || (res.status === 500 && /Upload failed/.test(detail || '')))
                                error.fatal = true;
                            throw error;
                        }
                        if (!item.received.has(index)) {
                            item.received.add(index);
                            item.bytesUploaded += chunkLength(item, index);
                            reportProgress();
                        }
                        return;
                    }
                    catch (err) {
                        if (signal.aborted || err.name === 'AbortError')
                            return;
                        failures += 1;
                        if (err.fatal || failures >= 4) {
                            fatal = new Error(`Failed to upload chunk ${index + 1}/${item.totalChunks}: ${err.message || 'Network error'}`);
                            return;
                        }
                        await wait(1000 * failures, signal);
                    }
                }
            };
            const worker = async () => {
                while (pending.length && !fatal && !signal.aborted && item.status === 'uploading')
                    await sendChunk(pending.shift());
            };
            await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, pending.length || 1) }, worker));
            if (item.status !== 'uploading')
                return; // paused or cancelled: the chunks already received stay on the server
            if (fatal) {
                clearResumeId(item);
                throw fatal;
            }
            // Step 3: Trigger completion on backend
            if (item.status !== 'uploading')
                return;
            const completeFormData = new FormData();
            completeFormData.append('upload_id', item.uploadId);
            item.abortController = new AbortController();
            let initialResponse = null;
            try {
                const completeRes = await fetch(`${baseUrl}/files/upload/complete`, {
                    method: 'POST',
                    headers: { ...authHeaders },
                    credentials: 'include',
                    signal: item.abortController.signal,
                    body: completeFormData
                });
                if (completeRes.ok) {
                    initialResponse = await completeRes.json().catch(() => null);
                }
                else if (completeRes.status === 409) {
                    // The server is missing bytes: never save a file with a gap in it
                    const errData = await completeRes.json().catch(() => ({}));
                    throw Object.assign(new Error(errData.detail?.message || "Upload incomplete. Please try again."), { fatal: true });
                }
            }
            catch (fetchErr) {
                if (fetchErr.fatal)
                    throw fetchErr;
                if (item.status !== 'uploading' || fetchErr.name === 'AbortError')
                    return;
                logger.warn('[UploadManager] complete request dropped, polling status...', fetchErr);
            }
            if (initialResponse?.status === 'completed' && initialResponse?.file) {
                item.status = 'completed';
                clearResumeId(item);
                item.progress = 100;
                item.resultFile = initialResponse.file;
                item.endTime = new Date();
                this.activeUploads.delete(id);
                this.notifyListeners();
                this.processQueue();
                window.dispatchEvent(new CustomEvent('uploadCompleted', { detail: { file: initialResponse.file } }));
                return;
            }
            // Step 4: Poll status until backend saves to Telegram
            const pollIntervalMs = 2000;
            const maxPollTimeMs = 30 * 60 * 1000; // 30 minutes
            const startPollTime = Date.now();
            while (Date.now() - startPollTime < maxPollTimeMs) {
                if (item.status !== 'uploading')
                    return;
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                if (item.status !== 'uploading')
                    return;
                try {
                    item.abortController = new AbortController();
                    const statusRes = await fetch(`${baseUrl}/files/upload/status/${item.uploadId}`, {
                        headers: { ...authHeaders },
                        credentials: 'include',
                        signal: item.abortController.signal
                    });
                    if (statusRes.ok) {
                        const statusData = await statusRes.json();
                        if (statusData.status === 'completed') {
                            item.status = 'completed';
                            clearResumeId(item);
                            item.progress = 100;
                            item.resultFile = statusData.file;
                            item.endTime = new Date();
                            this.activeUploads.delete(id);
                            this.notifyListeners();
                            this.processQueue();
                            window.dispatchEvent(new CustomEvent('uploadCompleted', { detail: { file: statusData.file } }));
                            return;
                        }
                        else if (statusData.status === 'error') {
                            throw new Error(statusData.error || 'Upload processing failed on server');
                        }
                    }
                }
                catch (pollErr) {
                    if (item.status !== 'uploading' || pollErr.name === 'AbortError')
                        return;
                    logger.warn('[UploadManager] Polling status check error:', pollErr);
                }
            }
            throw new Error('Upload timed out waiting for server completion');
        }
        catch (err) {
            if (item.status === 'paused' || item.status === 'cancelled') {
                return;
            }
            logger.error('[UploadManager] Upload failed', { id, error: err });
            item.status = 'failed';
            item.error = err?.message || 'Upload failed';
            item.endTime = new Date();
            this.activeUploads.delete(id);
            this.notifyListeners();
            this.processQueue();
            if (err?.message?.includes('TELEGRAM_NOT_VERIFIED')) {
                window.dispatchEvent(new CustomEvent('telegramNotVerified'));
            }
            else if (err?.message?.includes('User index chat not found')) {
                window.dispatchEvent(new CustomEvent('indexChatNotFound'));
            }
        }
    }
    hasActiveUploads() {
        return this.activeUploads.size > 0;
    }
}
export const uploadManager = new UploadManager();
