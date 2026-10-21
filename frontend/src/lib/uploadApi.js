// File uploads to Telegram storage: small files in one request (with progress), large ones in
// resumable chunks with retries, then polling while the server saves them to Telegram.
import authService from '@/features/auth/authService';
import logger from '@/lib/logger';
import { getApiBaseUrl } from '@/lib/api';

export const formatSpeed = (bytesPerSec) => {
    if (bytesPerSec <= 0)
        return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytesPerSec) / Math.log(k)));
    return parseFloat((bytesPerSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export const formatEta = (seconds) => {
    if (!isFinite(seconds) || seconds <= 0)
        return '';
    if (seconds > 3600)
        return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    if (seconds > 60)
        return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
    return `${Math.round(seconds)}s`;
};

export async function uploadFileChunked(file, path = '/', onProgress) {
    const baseUrl = getApiBaseUrl();
    const apiUrl = baseUrl ? `${baseUrl}` : '';
    const authHeaders = authService.getAuthHeaders();
    // Step 1: Init chunked upload
    const initRes = await fetch(`${apiUrl}/files/upload/init`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
        },
        credentials: 'include',
        body: JSON.stringify({
            filename: file.name,
            filesize: file.size,
            path: path || '/Home'
        })
    });
    if (!initRes.ok) {
        const errData = await initRes.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to initialize chunked upload');
    }
    const initData = await initRes.json();
    const uploadId = initData.upload_id;
    const CHUNK_SIZE = initData.chunk_size || 20 * 1024 * 1024;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let bytesUploaded = 0;
    let lastTime = Date.now();
    let lastLoaded = 0;
    let currentSpeed = 0;
    // Step 2: Upload chunks sequentially with auto-retry
    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        const start = chunkIdx * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);
        let success = false;
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const chunkFormData = new FormData();
                chunkFormData.append('upload_id', uploadId);
                chunkFormData.append('chunk_index', chunkIdx.toString());
                chunkFormData.append('chunk_file', chunkBlob, file.name);
                const chunkRes = await fetch(`${apiUrl}/files/upload/chunk`, {
                    method: 'POST',
                    headers: {
                        ...authHeaders
                    },
                    credentials: 'include',
                    body: chunkFormData
                });
                if (!chunkRes.ok) {
                    const errData = await chunkRes.json().catch(() => ({}));
                    throw new Error(errData.detail || `Chunk upload failed (${chunkRes.status})`);
                }
                success = true;
                bytesUploaded += (end - start);
                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000;
                if (timeDiff >= 0.3) {
                    const bytesDiff = bytesUploaded - lastLoaded;
                    const instantSpeed = bytesDiff / timeDiff;
                    currentSpeed = currentSpeed === 0 ? instantSpeed : 0.7 * currentSpeed + 0.3 * instantSpeed;
                    lastTime = now;
                    lastLoaded = bytesUploaded;
                }
                if (onProgress) {
                    const percent = Math.min(99, Math.round((bytesUploaded / file.size) * 100));
                    const remaining = file.size - bytesUploaded;
                    const etaSec = currentSpeed > 0 ? remaining / currentSpeed : 0;
                    onProgress(percent, bytesUploaded, file.size, formatSpeed(currentSpeed), formatEta(etaSec));
                }
                break;
            }
            catch (err) {
                lastErr = err;
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
        if (!success) {
            throw new Error(`Failed to upload chunk ${chunkIdx + 1}/${totalChunks}: ${lastErr?.message || 'Network error'}`);
        }
    }
    // Step 3: Trigger completion (processed in background on server)
    const completeFormData = new FormData();
    completeFormData.append('upload_id', uploadId);
    let initialResponseData = null;
    try {
        const completeRes = await fetch(`${apiUrl}/files/upload/complete`, {
            method: 'POST',
            headers: {
                ...authHeaders
            },
            credentials: 'include',
            body: completeFormData
        });
        if (completeRes.ok) {
            initialResponseData = await completeRes.json().catch(() => null);
        }
    }
    catch (fetchErr) {
        logger.warn('[API] /files/upload/complete connection dropped, checking status...', fetchErr);
    }
    // Fast path: if already completed
    if (initialResponseData?.status === 'completed' && initialResponseData?.file) {
        if (onProgress) {
            onProgress(100, file.size, file.size, '', '');
        }
        return {
            message: initialResponseData.message || 'File uploaded successfully',
            file: initialResponseData.file
        };
    }
    // Step 4: Poll status until complete (handles large files saving to Telegram cloud)
    if (onProgress) {
        onProgress(99, file.size, file.size, 'Saving to Telegram cloud...', '');
    }
    const pollIntervalMs = 2000;
    const maxPollTimeMs = 30 * 60 * 1000; // 30 minutes max for large files
    const startTime = Date.now();
    while (Date.now() - startTime < maxPollTimeMs) {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        try {
            const statusRes = await fetch(`${apiUrl}/files/upload/status/${uploadId}`, {
                headers: {
                    ...authHeaders
                },
                credentials: 'include'
            });
            if (statusRes.ok) {
                const statusData = await statusRes.json();
                if (statusData.status === 'completed') {
                    if (onProgress) {
                        onProgress(100, file.size, file.size, '', '');
                    }
                    return {
                        message: statusData.message || 'File uploaded successfully',
                        file: statusData.file
                    };
                }
                else if (statusData.status === 'error') {
                    throw new Error(statusData.error || 'Upload failed while saving to Telegram');
                }
                else {
                    // Still processing
                    if (onProgress) {
                        onProgress(99, file.size, file.size, 'Saving to Telegram cloud...', '');
                    }
                }
            }
            else if (statusRes.status === 404) {
                throw new Error('Upload session expired or not found');
            }
        }
        catch (err) {
            if (err.message && (err.message.includes('saving to Telegram') || err.message.includes('expired or not found'))) {
                throw err;
            }
            logger.warn('[API] Polling upload status transient error:', err);
        }
    }
    throw new Error('Upload completion timed out. Please check your drive.');
}

export async function uploadFile(file, path = '/', onProgress) {
    // Automatically use chunked uploader for large files (> 50MB) for maximum resilience
    if (file.size > 50 * 1024 * 1024) {
        return uploadFileChunked(file, path, onProgress);
    }
    const baseUrl = getApiBaseUrl();
    const apiUrl = baseUrl ? `${baseUrl}` : '';
    const formData = new FormData();
    formData.append('file', file);
    formData.append('path', path);
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${apiUrl}/files/upload`, true);
        xhr.withCredentials = true;
        // Add auth headers
        const authHeaders = authService.getAuthHeaders();
        Object.entries(authHeaders).forEach(([key, value]) => {
            xhr.setRequestHeader(key, value);
        });
        let lastTime = Date.now();
        let lastLoaded = 0;
        let currentSpeed = 0;
        let lastCallbackTime = 0;
        // Track real upload progress (0% to 99% while sending data to server)
        if (xhr.upload && onProgress) {
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && event.total > 0) {
                    const now = Date.now();
                    const timeDiff = (now - lastTime) / 1000;
                    if (timeDiff >= 0.3) {
                        const bytesDiff = event.loaded - lastLoaded;
                        const instantSpeed = bytesDiff / timeDiff;
                        currentSpeed = currentSpeed === 0 ? instantSpeed : 0.7 * currentSpeed + 0.3 * instantSpeed;
                        lastTime = now;
                        lastLoaded = event.loaded;
                    }
                    // Throttle progress state updates to every 250ms for smooth rendering
                    if (now - lastCallbackTime >= 250 || event.loaded === event.total) {
                        lastCallbackTime = now;
                        const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
                        const remainingBytes = event.total - event.loaded;
                        const etaSeconds = currentSpeed > 0 ? remainingBytes / currentSpeed : 0;
                        const speedStr = currentSpeed > 0 ? formatSpeed(currentSpeed) : '';
                        const etaStr = etaSeconds > 0 ? formatEta(etaSeconds) : '';
                        onProgress(percent, event.loaded, event.total, speedStr, etaStr);
                    }
                }
            };
        }
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                if (onProgress) {
                    onProgress(100, file.size, file.size, '', '');
                }
                try {
                    const data = JSON.parse(xhr.responseText);
                    resolve(data);
                }
                catch (e) {
                    resolve({ message: "File uploaded successfully" });
                }
            }
            else if (xhr.status === 401) {
                reject(new Error("Authentication required. Please log in again."));
            }
            else {
                let errorMessage = `Failed to upload file: ${xhr.statusText || xhr.status}`;
                try {
                    const errorData = JSON.parse(xhr.responseText);
                    if (errorData.detail) {
                        errorMessage = errorData.detail;
                    }
                }
                catch (_) { }
                reject(new Error(errorMessage));
            }
        };
        xhr.onerror = () => {
            reject(new Error("Network error during file upload. Please check your connection."));
        };
        xhr.onabort = () => {
            reject(new Error("Upload aborted."));
        };
        // No premature timeout: let large files complete as long as data transfers
        xhr.timeout = 0;
        xhr.send(formData);
    });
}
