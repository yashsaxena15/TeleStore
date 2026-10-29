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
        // The server's summary counts every file in the group; the rows are only the ones moving
        // now, the next few waiting and recent history
        const summary = subItems[0].group_summary;
        const statusCount = (status) => summary ? (summary.counts[status] || 0) : subItems.filter(i => i.status === status).length;
        const totalCount = summary ? summary.total : subItems.length;
        const completedCount = statusCount('completed');
        const failedCount = statusCount('failed');
        const cancelledCount = statusCount('cancelled');
        const isDownloading = statusCount('downloading') > 0;
        const isUploading = statusCount('uploading_tg') > 0;
        const isDiscovering = statusCount('discovering') > 0;
        const isPausedQuota = statusCount('paused_quota') > 0;
        const isQueued = statusCount('queued') > 0;
        let status = 'queued';
        if (isDownloading)
            status = 'downloading';
        else if (isUploading)
            status = 'uploading_tg';
        else if (isDiscovering)
            status = 'discovering';
        else if (isPausedQuota)
            status = 'paused_quota';
        else if (completedCount === totalCount && totalCount > 0)
            status = 'completed';
        else if (cancelledCount === totalCount && totalCount > 0)
            status = 'cancelled';
        else if (failedCount === totalCount && totalCount > 0)
            status = 'failed';
        else if (isQueued)
            status = 'queued';
        // Nothing left running: some files failed (the rest finished or were cancelled)
        else if (failedCount > 0)
            status = 'failed';
        else if (cancelledCount > 0)
            status = 'cancelled';
        const sum = (key) => subItems.reduce((acc, i) => acc + (i[key] || 0), 0);
        const totalBytes = summary ? summary.filesize : sum('filesize');
        const transferredBytes = summary ? summary.transferred_bytes : sum('transferred_bytes');
        const totalSpeed = summary ? summary.speed_bps : sum('speed_bps');
        const totalPeers = sum('peer_count');
        const groupName = subItems[0].group_name || 'Folder Download';
        const groupType = subItems[0].group_type || 'folder';
        // A folder's waiting files have no size yet, so its progress counts files, not bytes
        const countFiles = summary && groupType !== 'file';
        let progress = 0;
        if (totalBytes > 0 && !countFiles) {
            progress = Math.min(100, Math.round((transferredBytes / totalBytes) * 1000) / 10);
        }
        else if (totalCount > 0) {
            progress = Math.min(100, Math.round((completedCount / totalCount) * 1000) / 10);
        }
        const destPath = subItems[0].destination_path || '/Home';
        const cooldownItem = subItems.find(i => i.cooldown_until);
        const cooldownUntil = cooldownItem?.cooldown_until || summary?.resumes_at;
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
            phase = groupType === 'file' ? `Completed and assembled (${totalCount} parts)` : `Completed all ${totalCount} file(s)`;
        }
        else if (status === 'downloading' || status === 'uploading_tg') {
            const activeSub = subItems.find(i => i.status === 'downloading' || i.status === 'uploading_tg');
            phase = groupType === 'file'
                ? `Multi-node leeching [${completedCount}/${totalCount} parts done]`
                : `Leeching [${completedCount + 1}/${totalCount}]: ${activeSub?.filename || ''}`;
        }
        else if (status === 'failed') {
            // Say why (the server sends the latest reason), not only how many
            const reason = summary?.error || subItems.find(i => i.status === 'failed' && i.error_message)?.error_message;
            phase = `${failedCount} of ${totalCount} ${groupType === 'file' ? 'parts' : 'files'} failed${reason ? `: ${reason}` : ''}`;
        }
        else if (status === 'cancelled') {
            phase = groupType === 'file' ? 'File transfer cancelled' : 'Folder transfer cancelled';
        }
        else {
            phase = groupType === 'file' ? `Queued (${totalCount} parts)` : `Queued (${totalCount} files)`;
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
            totalCount,
            startTime: subItems[0].startTime
        });
    });
    return { groupedRemoteItems, singleRemoteItems };
}

const ACTIVE_REMOTE = ['queued', 'downloading', 'uploading_tg', 'discovering', 'paused_quota'];

const RUNNING_REMOTE = ['downloading', 'uploading_tg', 'discovering'];

// Active, completed and failed remote tasks: a folder leech's rows are only a sample of its files,
// so its summary is counted once instead. Of the active ones: running, waiting, and paused by
// Google Drive's daily limit (which aren't running, so they aren't shown as such)
export function countRemoteTasks(remoteTransfers) {
    const counts = { active: 0, completed: 0, failed: 0, running: 0, waiting: 0, pausedQuota: 0 };
    const add = (status, n) => {
        if (RUNNING_REMOTE.includes(status)) counts.running += n;
        else if (status === 'queued') counts.waiting += n;
        else if (status === 'paused_quota') counts.pausedQuota += n;
    };
    const seenGroups = new Set();
    remoteTransfers.forEach(r => {
        const summary = r.group_id && r.group_summary;
        if (summary) {
            if (seenGroups.has(r.group_id))
                return;
            seenGroups.add(r.group_id);
            ACTIVE_REMOTE.forEach(s => { counts.active += summary.counts[s] || 0; add(s, summary.counts[s] || 0); });
            counts.completed += summary.counts.completed || 0;
            counts.failed += summary.counts.failed || 0;
            return;
        }
        if (ACTIVE_REMOTE.includes(r.status)) {
            counts.active += 1;
            add(r.status, 1);
        }
        else if (r.status === 'completed')
            counts.completed += 1;
        else if (r.status === 'failed')
            counts.failed += 1;
    });
    return counts;
}
