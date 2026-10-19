import { getApiBaseUrl } from '@/lib/api';
import authService from '@/features/auth/authService';
import logger from '@/lib/logger';
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
            // Step 1: Initialize session on backend if not already created
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
                        path: item.path
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
            }
            let lastTime = Date.now();
            let lastLoaded = item.bytesUploaded;
            let currentSpeed = item.speed || 0;
            // Step 2: Upload chunks starting from current chunkIndex
            while (item.chunkIndex < item.totalChunks) {
                if (item.status !== 'uploading') {
                    // Upload was paused or cancelled
                    return;
                }
                const chunkIdx = item.chunkIndex;
                const start = chunkIdx * item.chunkSize;
                const end = Math.min(start + item.chunkSize, item.filesize);
                const chunkBlob = item.file.slice(start, end);
                let success = false;
                let lastErr = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    if (item.status !== 'uploading')
                        return;
                    try {
                        item.abortController = new AbortController();
                        const chunkFormData = new FormData();
                        chunkFormData.append('upload_id', item.uploadId);
                        chunkFormData.append('chunk_index', chunkIdx.toString());
                        chunkFormData.append('chunk_file', chunkBlob, item.filename);
                        const chunkRes = await fetch(`${baseUrl}/files/upload/chunk`, {
                            method: 'POST',
                            headers: { ...authHeaders },
                            credentials: 'include',
                            signal: item.abortController.signal,
                            body: chunkFormData
                        });
                        if (!chunkRes.ok) {
                            const errData = await chunkRes.json().catch(() => ({}));
                            throw new Error(errData.detail || `Chunk upload failed (${chunkRes.status})`);
                        }
                        success = true;
                        break;
                    }
                    catch (err) {
                        if (item.status !== 'uploading' || err.name === 'AbortError') {
                            // Intentionally paused/cancelled
                            return;
                        }
                        lastErr = err;
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
                if (!success) {
                    throw new Error(`Failed to upload chunk ${chunkIdx + 1}/${item.totalChunks}: ${lastErr?.message || 'Network error'}`);
                }
                // Chunk uploaded successfully
                item.chunkIndex = chunkIdx + 1;
                item.bytesUploaded += (end - start);
                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000;
                if (timeDiff >= 0.3) {
                    const bytesDiff = item.bytesUploaded - lastLoaded;
                    const instantSpeed = bytesDiff / timeDiff;
                    currentSpeed = currentSpeed === 0 ? instantSpeed : 0.7 * currentSpeed + 0.3 * instantSpeed;
                    lastTime = now;
                    lastLoaded = item.bytesUploaded;
                }
                item.speed = currentSpeed;
                const remaining = item.filesize - item.bytesUploaded;
                item.eta = currentSpeed > 0 ? Math.round(remaining / currentSpeed) : 0;
                item.progress = Math.min(99, Math.round((item.bytesUploaded / item.filesize) * 100));
                this.notifyListeners();
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
            }
            catch (fetchErr) {
                if (item.status !== 'uploading' || fetchErr.name === 'AbortError')
                    return;
                logger.warn('[UploadManager] complete request dropped, polling status...', fetchErr);
            }
            if (initialResponse?.status === 'completed' && initialResponse?.file) {
                item.status = 'completed';
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
