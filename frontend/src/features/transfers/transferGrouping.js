// frontend/src/features/transfers/transferGrouping.js
export function groupRemoteTransfers(remoteTransfers) {
    const groupMap = new Map();
    const singleRemoteItems = [];
    remoteTransfers.forEach(r => {
        const item = {
            ...r,
            type: 'remote',
            filesize: r.filesize || 0,
            bytesUploaded: r.transferred_bytes || 0,
            downloaded: r.transferred_bytes || 0,
            file: null,
            startTime: r.created_at
        };
        if (r.group_id) {
            if (!groupMap.has(r.group_id)) {
                groupMap.set(r.group_id, []);
            }
            groupMap.get(r.group_id).push(item);
        }
        else {
            singleRemoteItems.push(item);
        }
    });
    const groupedRemoteItems = [];
    groupMap.forEach((subItems, groupId) => {
        const completedCount = subItems.filter(i => i.status === 'completed').length;
        const failedCount = subItems.filter(i => i.status === 'failed').length;
        const cancelledCount = subItems.filter(i => i.status === 'cancelled').length;
        const isDownloading = subItems.some(i => i.status === 'downloading');
        const isUploading = subItems.some(i => i.status === 'uploading_tg');
        const isDiscovering = subItems.some(i => i.status === 'discovering');
        const isPausedQuota = subItems.some(i => i.status === 'paused_quota');
        const isQueued = subItems.some(i => i.status === 'queued');
        let status = 'queued';
        if (isDownloading)
            status = 'downloading';
        else if (isUploading)
            status = 'uploading_tg';
        else if (isDiscovering)
            status = 'discovering';
        else if (isPausedQuota)
            status = 'paused_quota';
        else if (completedCount === subItems.length && subItems.length > 0)
            status = 'completed';
        else if (cancelledCount === subItems.length && subItems.length > 0)
            status = 'cancelled';
        else if (failedCount === subItems.length && subItems.length > 0)
            status = 'failed';
        else if (isQueued)
            status = 'queued';
        // Nothing left running: some files failed (the rest finished or were cancelled)
        else if (failedCount > 0)
            status = 'failed';
        else if (cancelledCount > 0)
            status = 'cancelled';
        const totalBytes = subItems.reduce((acc, i) => acc + (i.filesize || 0), 0);
        const transferredBytes = subItems.reduce((acc, i) => acc + (i.transferred_bytes || 0), 0);
        const totalSpeed = subItems.reduce((acc, i) => acc + (i.speed_bps || 0), 0);
        const totalPeers = subItems.reduce((acc, i) => acc + (i.peer_count || 0), 0);
        let progress = 0;
        if (totalBytes > 0) {
            progress = Math.min(100, Math.round((transferredBytes / totalBytes) * 1000) / 10);
        }
        else if (subItems.length > 0) {
            progress = Math.min(100, Math.round((completedCount / subItems.length) * 1000) / 10);
        }
        const groupName = subItems[0].group_name || 'Folder Download';
        const groupType = subItems[0].group_type || 'folder';
        const destPath = subItems[0].destination_path || '/Home';
        const cooldownItem = subItems.find(i => i.cooldown_until);
        const cooldownUntil = cooldownItem?.cooldown_until;
        let phase = '';
        if (status === 'discovering') {
            phase = 'Analyzing folder structure in background...';
        }
        else if (status === 'paused_quota') {
            let targetTime = '24h';
            if (cooldownUntil) {
                try {
                    const d = new Date(cooldownUntil);
                    targetTime = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }
                catch { }
            }
            phase = `Google Drive quota limit reached. Auto-resumes at ${targetTime}`;
        }
        else if (status === 'completed') {
            phase = groupType === 'file' ? `Completed and assembled (${subItems.length} parts)` : `Completed all ${subItems.length} file(s)`;
        }
        else if (status === 'downloading' || status === 'uploading_tg') {
            const activeSub = subItems.find(i => i.status === 'downloading' || i.status === 'uploading_tg');
            phase = groupType === 'file'
                ? `Multi-node leeching [${completedCount}/${subItems.length} parts done]`
                : `Leeching [${completedCount + 1}/${subItems.length}]: ${activeSub?.filename || ''}`;
        }
        else if (status === 'failed') {
            phase = `${failedCount} of ${subItems.length} ${groupType === 'file' ? 'parts' : 'files'} failed`;
        }
        else if (status === 'cancelled') {
            phase = groupType === 'file' ? 'File transfer cancelled' : 'Folder transfer cancelled';
        }
        else {
            phase = groupType === 'file' ? `Queued (${subItems.length} parts)` : `Queued (${subItems.length} files)`;
        }
        groupedRemoteItems.push({
            isGroup: true,
            type: 'remote',
            id: groupId,
            task_id: groupId,
            group_id: groupId,
            group_name: groupName,
            group_type: groupType,
            filename: groupName,
            destination_path: destPath,
            status,
            phase,
            cooldown_until: cooldownUntil,
            filesize: totalBytes,
            transferred_bytes: transferredBytes,
            bytesUploaded: transferredBytes,
            downloaded: transferredBytes,
            speed_bps: totalSpeed,
            speed: totalSpeed,
            progress,
            eta_seconds: 0,
            eta: 0,
            peer_count: totalPeers,
            items: subItems,
            completedCount,
            totalCount: subItems.length,
            startTime: subItems[0].startTime
        });
    });
    return { groupedRemoteItems, singleRemoteItems };
}
