// API base URL - will use proxy in development
import logger from '@/lib/logger';
import authService from '@/features/auth/authService';
import { uploadFile, uploadFileChunked } from '@/lib/uploadApi';
const getDefaultApiUrl = () => {
    const savedUrl = localStorage.getItem("serverUrl");
    if (savedUrl) {
        return savedUrl;
    }
    return import.meta.env.VITE_API_URL || '/api';
};
const API_BASE_URL = getDefaultApiUrl();
const SERVER_URL_KEY = "serverUrl";
// Function to get the API base URL
export const getApiBaseUrl = () => {
    // Check if there's a custom server URL in localStorage
    const customUrl = localStorage.getItem(SERVER_URL_KEY);
    if (customUrl) {
        return customUrl;
    }
    // Return default URL (port 8148)
    if (typeof window !== 'undefined') {
        // Check if running in Tauri
        const isTauri = authService.isTauri();
        if (isTauri) {
            // In Tauri, always use localhost:8148 by default
            return 'http://localhost:8148';
        }
        // For web, use the origin where the app is served
        return window.location.origin;
    }
    return import.meta.env.VITE_API_URL || '';
};
// Function to update the API base URL
export const updateApiBaseUrl = (url) => {
    if (url) {
        localStorage.setItem(SERVER_URL_KEY, url);
    }
    else {
        localStorage.removeItem(SERVER_URL_KEY);
    }
};
// Function to reset API base URL to default
export const resetApiBaseUrl = () => {
    localStorage.removeItem(SERVER_URL_KEY);
};
// Function to construct full API URLs
export const getFullApiUrl = (endpoint) => {
    const baseUrl = getApiBaseUrl();
    // If we have a custom base URL, append the endpoint
    if (baseUrl) {
        // Ensure the endpoint starts with a slash
        const formattedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        return `${baseUrl}${formattedEndpoint}`;
    }
    // For same-origin requests, use the endpoint directly (no /api prefix)
    return endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
};
// The Tauri HTTP plugin (desktop app) is loaded on demand; browsers use fetch
let http = null;
const isTauriEnv = typeof window !== 'undefined' && Boolean(window.__TAURI__);
let httpReady = isTauriEnv
    ? import('@tauri-apps/plugin-http').then((module) => {
        http = module;
    }).catch((error) => {
        logger.error('[API] Failed to load Tauri HTTP plugin:', error);
        httpReady = null;
    })
    : null;
// Every request carries the sign-in headers from authService
function addAuthHeaders(options = {}) {
    const headers = {};
    new Headers(options.headers || {}).forEach((value, key) => {
        headers[key] = value;
    });
    Object.entries(authService.getAuthHeaders()).forEach(([key, value]) => {
        headers[key] = value;
    });
    return { ...options, headers };
}
// fetch with a timeout (and the Tauri HTTP plugin in the desktop app). Never logs headers or bodies.
export const fetchWithTimeout = async (url, options = {}, timeout = 30000) => {
    const mergedOptions = addAuthHeaders(options);
    if (isTauriEnv) {
        try {
            if (httpReady)
                await httpReady;
            if (http) {
                // Cookies don't apply in the desktop app; it signs in with the token header
                return await http.fetch(url, {
                    method: mergedOptions.method || 'GET',
                    headers: mergedOptions.headers,
                    body: mergedOptions.body instanceof FormData ? mergedOptions.body : (typeof mergedOptions.body === 'string' ? mergedOptions.body : (mergedOptions.body ? JSON.stringify(mergedOptions.body) : undefined)),
                    credentials: mergedOptions.credentials === 'include' ? undefined : 'omit',
                });
            }
        }
        catch (error) {
            logger.error('[API] Tauri HTTP request failed, falling back to fetch:', error?.message || String(error));
        }
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        controller.abort(new Error(`Request timed out after ${Math.round(timeout / 1000)}s`));
    }, timeout);
    try {
        return await fetch(url, { ...mergedOptions, signal: controller.signal });
    }
    catch (error) {
        if (error?.name === 'AbortError' || error?.message?.toLowerCase().includes('aborted')) {
            throw new Error(`Request timed out after ${Math.round(timeout / 1000)}s. Please try again.`);
        }
        throw error;
    }
    finally {
        clearTimeout(timeoutId);
    }
};

/** An error from the server, with its HTTP status and the server's own message when it gave one. */
export class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

// FastAPI sends {"detail": "..."} or, for validation errors, {"detail": [{"msg": "..."}, ...]}
export function messageFromBody(body, fallback) {
    const detail = body?.detail;
    if (typeof detail === 'string' && detail.trim())
        return detail;
    if (Array.isArray(detail) && detail.length)
        return detail.map((d) => d?.msg || String(d)).join('; ');
    if (typeof body?.message === 'string' && body.message.trim())
        return body.message;
    return fallback;
}

async function errorFromResponse(response, fallback) {
    const body = await response.json().catch(() => null);
    const message = messageFromBody(body, response.status === 401 ? 'Authentication required. Please log in again.' : fallback);
    return new ApiError(message, response.status);
}

/**
 * One request to the TeleStore API. Sends cookies and the sign-in headers, encodes a JSON or
 * FormData body, and on failure throws an ApiError carrying the server's message.
 * Options: method, body, query (object; empty values skipped), timeout, fallback (error text),
 * soft (value to return instead of throwing), raw (return the Response).
 */
export async function request(path, { method = 'GET', body, query, timeout, fallback = 'Request failed', soft, raw = false } = {}) {
    let url = `${getApiBaseUrl() || ''}${path}`;
    if (query) {
        const params = new URLSearchParams();
        Object.entries(query).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '')
                params.append(key, String(value));
        });
        const qs = params.toString();
        if (qs)
            url += `?${qs}`;
    }
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const options = { method, credentials: 'include', headers: {} };
    if (body !== undefined) {
        options.body = isForm ? body : JSON.stringify(body);
        if (!isForm)
            options.headers['Content-Type'] = 'application/json';
    }
    const response = await fetchWithTimeout(url, options, timeout);
    if (!response.ok) {
        if (soft !== undefined)
            return soft;
        throw await errorFromResponse(response, fallback);
    }
    if (raw)
        return response;
    if (response.status === 204)
        return null;
    const text = await response.text();
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}

const post = (path, body, opts = {}) => request(path, { method: 'POST', body, ...opts });
const put = (path, body, opts = {}) => request(path, { method: 'PUT', body, ...opts });
const enc = encodeURIComponent;
const withToken = (url) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    return token ? `${url}?token=${enc(token)}` : url;
};

const mapUser = (user) => ({
    id: user.id,
    username: user.username,
    email: user.email,
    telegramUserId: user.telegram_user_id,
    telegramUsername: user.telegram_username,
    permissions: user.permissions,
    createdAt: user.created_at,
    lastActive: user.last_active,
    userType: user.user_type,
});

export const api = {
    // ── Files and folders ──────────────────────────────────────────────
    fetchFiles: (path = '/', page, pageSize, sortBy, sortOrder) => request('/files', { query: { path, page, page_size: pageSize, sort_by: sortBy, sort_order: sortOrder }, timeout: 5000, fallback: 'Failed to fetch files' }),
    createFolder: (folderName, currentPath) => post('/folders/create', { folderName, currentPath }, { timeout: 3000, fallback: 'Failed to create folder' }),
    createFolderPath: (fullPath) => post('/folders/create-path', { fullPath }, { timeout: 3000, fallback: 'Failed to create folder path' }),
    toggleStar: (fileId, starred) => post('/files/star', { file_id: fileId, starred }, { fallback: 'Failed to update star status' }),
    trashFile: (fileId) => post('/files/trash', { file_id: fileId }, { fallback: 'Failed to move item to trash' }),
    restoreFile: (fileId) => post('/files/restore', { file_id: fileId }, { fallback: 'Failed to restore item from trash' }),
    emptyTrash: () => post('/files/trash/empty', undefined, { fallback: 'Failed to empty trash' }),
    deleteForever: (fileId) => post('/files/delete', { file_id: fileId }, { fallback: 'Failed to permanently delete item' }),
    getStorageAnalytics: () => request('/files/analytics', { fallback: 'Failed to fetch storage analytics' }),
    uploadFile: (file, path = '/', onProgress) => uploadFile(file, path, onProgress),
    uploadFileChunked: (file, path = '/', onProgress) => uploadFileChunked(file, path, onProgress),

    // ── Account and users ──────────────────────────────────────────────
    checkAuth: () => request('/auth/check', { timeout: 3000, fallback: 'Failed to check sign-in' }),
    async logout() {
        const data = await post('/auth/logout', undefined, { timeout: 3000, fallback: 'Failed to log out' });
        if (typeof window !== 'undefined')
            localStorage.removeItem('auth_token');
        return data;
    },
    async fetchUserProfile() {
        const data = await request('/user/profile', { timeout: 3000, fallback: 'Failed to fetch user profile' });
        return {
            username: data.username,
            email: data.email,
            telegram_user_id: data.telegram_user_id,
            telegram_username: data.telegram_username,
            telegram_first_name: data.telegram_first_name,
            telegram_last_name: data.telegram_last_name,
            telegram_profile_picture: data.telegram_profile_picture,
        };
    },
    async isUserOwner() {
        const data = await request('/user/is-owner', { timeout: 3000, fallback: 'Failed to check owner status' });
        return { is_owner: data.is_owner, owner_telegram_id: data.owner_telegram_id };
    },
    async getUsers() {
        const data = await request('/user', { timeout: 3000, fallback: 'Failed to fetch users' });
        return { users: (data.users || []).map(mapUser) };
    },
    addUser: (userData) => post('/user', userData, { timeout: 3000, fallback: 'Failed to add user' }),
    updateUser: (userId, userData) => put(`/user/${userId}`, userData, { timeout: 3000, fallback: 'Failed to update user' }),
    async deleteUser(userId) {
        await request(`/user/${userId}`, { method: 'DELETE', timeout: 3000, fallback: 'Failed to delete user' });
    },
    changeUserPassword: (userId, passwordData) => put(`/user/${userId}/password`, passwordData, { timeout: 5000, fallback: 'Failed to change password' }),
    getUserIndexChat: () => request('/user/index-chat', { timeout: 3000, fallback: 'Failed to fetch index chat' }),
    updateUserIndexChat: (indexChatData) => put('/user/index-chat', indexChatData, { timeout: 3000, fallback: 'Failed to update index chat' }),

    // ── Private Vault ──────────────────────────────────────────────────
    getVaultStatus: () => request('/vault/status', { fallback: 'Failed to fetch vault status' }),
    requestVaultSetupOtp: (email) => post('/vault/setup/request-otp', { email }, { fallback: 'Failed to send verification code' }),
    verifyVaultOtp: (otp_code, purpose = 'Private Vault Setup', email) => post('/vault/verify-otp', { otp_code, purpose, email }, { fallback: 'Invalid verification code' }),
    verifyAndCreateVault: (email, otp_code, pin) => post('/vault/setup/verify-and-create', { email, otp_code, pin }, { fallback: 'Failed to create vault' }),
    unlockVault: (pin) => post('/vault/unlock', { pin }, { fallback: 'Incorrect PIN' }),
    lockVault: () => post('/vault/lock', undefined, { fallback: 'Failed to lock vault' }),
    requestForgotPinOtp: () => post('/vault/forgot-pin/request-otp', undefined, { fallback: 'Failed to request reset code' }),
    resetVaultPin: (otp_code, new_pin) => post('/vault/forgot-pin/reset', { otp_code, new_pin }, { fallback: 'Failed to reset PIN' }),
    changeVaultPin: (current_pin, new_pin) => post('/vault/change-pin', { current_pin, new_pin }, { fallback: 'Failed to change PIN' }),
    updateVaultSettings: (settings) => put('/vault/settings', settings, { fallback: 'Failed to save vault settings' }),
    requestRecoveryEmailOtp: (email, pin) => post('/vault/recovery-email/request-otp', { email, pin }, { fallback: 'Failed to send verification code' }),
    confirmRecoveryEmail: (email, pin, otp_code) => post('/vault/recovery-email/confirm', { email, pin, otp_code }, { fallback: 'Failed to change recovery email' }),
    moveIntoVault: (fileId, targetPath = '/Vault') => post('/vault/move-in', { file_id: fileId, target_path: targetPath }, { fallback: 'Failed to move item to Vault' }),
    moveOutOfVault: (fileId, targetPath = '/Home') => post('/vault/move-out', { file_id: fileId, target_path: targetPath }, { fallback: 'Failed to move item out of Vault' }),
    createVaultFolder: (folderName, currentPath = '/Vault') => post('/vault/create-folder', { folder_name: folderName, current_path: currentPath }, { fallback: 'Failed to create folder in Vault' }),

    // ── Cloud leech (remote transfers) ─────────────────────────────────
    // Scanning a deep Google Drive folder can take minutes
    addRemoteTransfer: (url, destination_path = '/Home') => post('/transfers/remote/add', { url, destination_path }, { timeout: 300000, fallback: 'Failed to start remote transfer' }),
    uploadTorrentFile(file, destination_path = '/Home') {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('destination_path', destination_path);
        return post('/transfers/remote/upload-torrent', formData, { timeout: 120000, fallback: 'Failed to upload torrent file' });
    },
    getRemoteTasks: () => request('/transfers/remote/tasks', { soft: { tasks: [] } }),
    cancelRemoteTask: (task_id) => post('/transfers/remote/cancel', { task_id }, { fallback: 'Failed to cancel remote transfer' }),
    cancelRemoteGroup: (group_id) => post('/transfers/remote/cancel-group', { group_id }, { fallback: 'Failed to cancel folder transfers' }),
    resumeRemoteGroup: (group_id) => post('/transfers/remote/resume-group', { group_id }, { fallback: 'Failed to resume folder transfers' }),
    retryRemoteTransfer: (task_id) => post('/transfers/remote/retry', { task_id }, { fallback: 'Failed to retry remote transfer' }),
    clearCompletedRemoteTasks: () => post('/transfers/remote/clear-completed', undefined, { fallback: 'Failed to clear completed tasks' }),

    // ── Streaming cache ────────────────────────────────────────────────
    getMediaCacheStats: () => request('/media/cache/stats', { soft: null }),
    clearMediaCache: () => post('/media/cache/clear', undefined, { fallback: 'Failed to clear media cache' }),

    // ── Google Drive ───────────────────────────────────────────────────
    fetchCloudAccounts: () => request('/cloud/accounts', { fallback: 'Failed to fetch cloud accounts' }),
    getGoogleAuthUrl: (customClientId, customClientSecret, redirectUri) => post('/cloud/gdrive/auth-url', { custom_client_id: customClientId, custom_client_secret: customClientSecret, redirect_uri: redirectUri }, { fallback: 'Failed to generate Google Drive auth URL' }),
    async disconnectCloudAccount(accountId) {
        await request(`/cloud/accounts/${accountId}`, { method: 'DELETE', fallback: 'Failed to disconnect cloud account' });
    },
    fetchCloudFiles: (accountId, folderId = 'root', pageSize = 50, pageToken, query, sortBy, sortOrder) => request(`/cloud/${accountId}/files`, { query: { folder_id: folderId, page_size: pageSize, page_token: pageToken, query, sort_by: sortBy, sort_order: sortOrder }, timeout: 15000, fallback: 'Failed to fetch cloud files' }),
    async deleteCloudFile(accountId, fileId, permanent = false) {
        await post(`/cloud/${accountId}/files/delete`, { file_id: fileId, permanent }, { fallback: 'Failed to delete file from Google Drive' });
    },
    async renameCloudFile(accountId, fileId, newName) {
        await post(`/cloud/${accountId}/files/rename`, { file_id: fileId, new_name: newName }, { fallback: 'Failed to rename file in Google Drive' });
    },
    async createCloudFolder(accountId, folderName, parentId = 'root') {
        await post(`/cloud/${accountId}/files/mkdir`, { folder_name: folderName, parent_id: parentId }, { fallback: 'Failed to create folder in Google Drive' });
    },
    transferCloudToTelegram: (accountId, sourceFileId, destinationPath = '/Home', operation = 'copy') => post(`/cloud/${accountId}/transfer-to-telegram`, { source_file_id: sourceFileId, destination_path: destinationPath, operation }, { fallback: 'Failed to start cloud transfer' }),
    transferTelegramToCloud: (accountId, sourceFileIds, sourceFolderPaths, targetFolderId = 'root', operation = 'copy') => post(`/cloud/${accountId}/transfer-from-telegram`, { source_file_ids: sourceFileIds, source_folder_paths: sourceFolderPaths, target_folder_id: targetFolderId, operation }, { fallback: 'Failed to start transfer to Google Drive' }),
    transferCloudInternal: (accountId, fileIds, targetFolderId = 'root', operation = 'copy') => post(`/cloud/${accountId}/files/transfer-internal`, { file_ids: fileIds, target_folder_id: targetFolderId, operation }, { fallback: `Failed to ${operation} items in Google Drive` }),
    uploadToCloud(accountId, file, folderId = 'root') {
        const formData = new FormData();
        formData.append('file', file);
        return request(`/cloud/${accountId}/upload`, { method: 'POST', body: formData, query: { folder_id: folderId || 'root' }, timeout: 300000, fallback: 'Failed to upload file to Google Drive' });
    },
    fetchCloudStorageQuota: (accountId) => request(`/cloud/${accountId}/storage`, { timeout: 15000, fallback: 'Failed to fetch cloud storage quota' }),
    async starCloudFile(accountId, fileId, starred) {
        await post(`/cloud/${accountId}/files/star`, { file_id: fileId, starred }, { fallback: 'Failed to update star in Google Drive' });
    },
    async restoreCloudFile(accountId, fileId) {
        await post(`/cloud/${accountId}/files/restore`, { file_id: fileId }, { fallback: 'Failed to restore file in Google Drive' });
    },
    async emptyCloudTrash(accountId) {
        await post(`/cloud/${accountId}/trash/empty`, undefined, { fallback: 'Failed to empty Google Drive trash' });
    },
    getCloudStreamUrl: (accountId, fileId) => withToken(`${getApiBaseUrl() || ''}/cloud/${enc(accountId)}/stream/${enc(fileId)}`),
    getCloudDownloadUrl: (accountId, fileId) => withToken(`${getApiBaseUrl() || ''}/cloud/${enc(accountId)}/download/${enc(fileId)}`),
};
