import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { uploadManager } from './uploadManager';
import { downloadManager } from './downloadManager';
import { transferManager } from './transferManager';
import { api } from '@/lib/api';
import { countRemoteTasks } from './transferGrouping';
export const useTransferManager = () => {
    const [uploads, setUploads] = useState(() => uploadManager.getUploads());
    const [downloads, setDownloads] = useState(() => downloadManager.getDownloads());
    const [remoteTransfers, setRemoteTransfers] = useState([]);
    useEffect(() => {
        const unsubUpload = uploadManager.subscribe(setUploads);
        const unsubDownload = downloadManager.subscribe(setDownloads);
        return () => {
            unsubUpload();
            unsubDownload();
        };
    }, []);
    const remotePollRunning = useRef(false);
    const fetchRemoteTransfers = useCallback(async () => {
        // A slow answer must not pile up behind the next poll
        if (remotePollRunning.current)
            return;
        remotePollRunning.current = true;
        try {
            const res = await api.getRemoteTasks();
            if (res && Array.isArray(res.tasks)) {
                const groups = res.groups || {};
                const mapped = res.tasks.map(t => ({
                    ...t,
                    group_summary: t.group_id ? groups[t.group_id] : undefined,
                    id: t.task_id,
                    name: t.filename || 'Remote Transfer',
                    size: t.filesize || 0,
                    bytesUploaded: t.transferred_bytes || 0,
                    speed: t.speed_bps || 0,
                    eta: t.eta_seconds || 0,
                    type: 'remote'
                }));
                setRemoteTransfers(mapped);
            }
        }
        catch {
            // Ignore background poll errors
        }
        finally {
            remotePollRunning.current = false;
        }
    }, []);
    const hasActiveRemote = useMemo(() => remoteTransfers.some(r => r.status === 'downloading' || r.status === 'uploading_tg' || r.status === 'queued' || r.status === 'discovering' || r.status === 'paused_quota'), [remoteTransfers]);
    useEffect(() => {
        fetchRemoteTransfers();
        const intervalTime = hasActiveRemote ? 1500 : 8000;
        const interval = setInterval(fetchRemoteTransfers, intervalTime);
        return () => clearInterval(interval);
    }, [fetchRemoteTransfers, hasActiveRemote]);
    // Listen to remoteTransferAdded custom event
    useEffect(() => {
        const handleRemoteAdded = () => fetchRemoteTransfers();
        window.addEventListener('remoteTransferAdded', handleRemoteAdded);
        return () => window.removeEventListener('remoteTransferAdded', handleRemoteAdded);
    }, [fetchRemoteTransfers]);
    const activeUploads = useMemo(() => uploads.filter(u => u.status === 'uploading' || u.status === 'queued'), [uploads]);
    const activeDownloads = useMemo(() => downloads.filter(d => d.status === 'downloading' || d.status === 'queued'), [downloads]);
    const activeRemote = useMemo(() => remoteTransfers.filter(r => r.status === 'downloading' || r.status === 'uploading_tg' || r.status === 'queued' || r.status === 'discovering' || r.status === 'paused_quota'), [remoteTransfers]);
    // Folder leeches send a summary instead of every file, so counts come from it
    const remoteCounts = useMemo(() => countRemoteTasks(remoteTransfers), [remoteTransfers]);
    const totalActiveCount = activeUploads.length + activeDownloads.length + remoteCounts.active;
    // Moving now, waiting their turn, and paused by Google Drive's daily limit (not counted as busy)
    const running = uploads.filter(u => u.status === 'uploading').length + downloads.filter(d => d.status === 'downloading').length + remoteCounts.running;
    const waiting = uploads.filter(u => u.status === 'queued').length + downloads.filter(d => d.status === 'queued').length + remoteCounts.waiting;
    const busyCount = running + waiting;
    const stats = useMemo(() => {
        return {
            activeUploads: activeUploads.length,
            activeDownloads: activeDownloads.length,
            activeRemote: remoteCounts.active,
            totalActive: totalActiveCount,
            running,
            waiting,
            pausedByGoogle: remoteCounts.pausedQuota,
            completedUploads: uploads.filter(u => u.status === 'completed').length,
            completedDownloads: downloads.filter(d => d.status === 'completed').length,
            completedRemote: remoteCounts.completed,
            failedUploads: uploads.filter(u => u.status === 'failed').length,
            failedDownloads: downloads.filter(d => d.status === 'failed').length,
            failedRemote: remoteCounts.failed,
            pausedCount: uploads.filter(u => u.status === 'paused').length + downloads.filter(d => d.status === 'paused').length
        };
    }, [uploads, downloads, remoteCounts, activeUploads, activeDownloads, totalActiveCount, running, waiting]);
    // Upload Actions
    const pauseUpload = useCallback((id) => uploadManager.pauseUpload(id), []);
    const resumeUpload = useCallback((id) => uploadManager.resumeUpload(id), []);
    const cancelUpload = useCallback((id) => uploadManager.cancelUpload(id), []);
    const retryUpload = useCallback((id) => uploadManager.retryUpload(id), []);
    // Download Actions
    const pauseDownload = useCallback((id) => downloadManager.pauseDownload(id), []);
    const resumeDownload = useCallback((id) => downloadManager.resumeDownload(id), []);
    const cancelDownload = useCallback((id) => downloadManager.cancelDownload(id), []);
    const retryDownload = useCallback((download) => {
        downloadManager.cancelDownload(download.id);
        downloadManager.addDownload(download.url, download.filename);
    }, []);
    // Remote Transfer Actions
    const cancelRemoteTransfer = useCallback(async (taskId) => {
        try {
            await api.cancelRemoteTask(taskId);
            setRemoteTransfers(prev => prev.map(t => t.task_id === taskId ? { ...t, status: 'cancelled', phase: 'Cancelled by user' } : t));
        }
        catch (e) {
            console.error(e);
        }
    }, []);
    const cancelRemoteGroup = useCallback(async (groupId) => {
        try {
            await api.cancelRemoteGroup(groupId);
            setRemoteTransfers(prev => prev.map(t => t.group_id === groupId && (t.status === 'queued' || t.status === 'downloading' || t.status === 'uploading_tg' || t.status === 'discovering' || t.status === 'paused_quota') ? { ...t, status: 'cancelled', phase: 'Cancelled by user' } : t));
        }
        catch (e) {
            console.error(e);
        }
    }, []);
    const resumeRemoteGroup = useCallback(async (groupId) => {
        try {
            await api.resumeRemoteGroup(groupId);
            fetchRemoteTransfers();
        }
        catch (e) {
            console.error(e);
        }
    }, [fetchRemoteTransfers]);
    const retryRemoteTransfer = useCallback(async (taskId) => {
        try {
            await api.retryRemoteTransfer(taskId);
            fetchRemoteTransfers();
        }
        catch (e) {
            console.error(e);
        }
    }, [fetchRemoteTransfers]);
    const clearCompletedRemote = useCallback(async () => {
        try {
            await api.clearCompletedRemoteTasks();
            setRemoteTransfers(prev => prev.filter(t => t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'failed'));
        }
        catch (e) {
            console.error(e);
        }
    }, []);
    // Bulk Actions
    const pauseAll = useCallback(() => transferManager.pauseAll(), []);
    const resumeAll = useCallback(() => transferManager.resumeAll(), []);
    const cancelAll = useCallback(() => {
        transferManager.cancelAll();
        // Cancel all active remote tasks as well; a folder leech is cancelled as a whole, since only
        // a few of its waiting files are in the list
        const active = remoteTransfers.filter(r => r.status === 'downloading' || r.status === 'uploading_tg' || r.status === 'queued' || r.status === 'discovering' || r.status === 'paused_quota');
        new Set(active.filter(r => r.group_id).map(r => r.group_id)).forEach(cancelRemoteGroup);
        active.filter(r => !r.group_id).forEach(r => cancelRemoteTransfer(r.task_id));
    }, [remoteTransfers, cancelRemoteTransfer, cancelRemoteGroup]);
    const clearCompleted = useCallback(() => {
        transferManager.clearCompleted();
        clearCompletedRemote();
    }, [clearCompletedRemote]);
    return {
        uploads,
        downloads,
        remoteTransfers,
        activeUploads,
        activeDownloads,
        activeRemote,
        totalActiveCount,
        busyCount,
        stats,
        pauseUpload,
        resumeUpload,
        cancelUpload,
        retryUpload,
        pauseDownload,
        resumeDownload,
        cancelDownload,
        retryDownload,
        cancelRemoteTransfer,
        cancelRemoteGroup,
        resumeRemoteGroup,
        retryRemoteTransfer,
        clearCompletedRemote,
        refreshRemoteTransfers: fetchRemoteTransfers,
        pauseAll,
        resumeAll,
        cancelAll,
        clearCompleted
    };
};
