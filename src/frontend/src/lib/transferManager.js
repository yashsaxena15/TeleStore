import { uploadManager } from './uploadManager';
import { downloadManager } from './downloadManager';
export class TransferManager {
    pauseAll() {
        uploadManager.pauseAll();
        downloadManager.pauseAll();
    }
    resumeAll() {
        uploadManager.resumeAll();
        downloadManager.resumeAll();
    }
    cancelAll() {
        uploadManager.cancelAll();
        downloadManager.cancelAll();
    }
    clearCompleted() {
        uploadManager.clearCompleted();
        downloadManager.clearCompleted();
    }
    hasActiveTransfers() {
        const hasUploading = uploadManager.getUploads().some(u => u.status === 'uploading');
        const hasDownloading = downloadManager.getDownloads().some(d => d.status === 'downloading');
        return hasUploading || hasDownloading;
    }
}
export const transferManager = new TransferManager();
export { uploadManager, downloadManager };
// Global protective alert when user tries to refresh/leave while transfers are active
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (e) => {
        if (transferManager.hasActiveTransfers()) {
            e.preventDefault();
            e.returnValue = 'Transfers are currently in progress. Leaving or refreshing will interrupt your uploads/downloads.';
            return e.returnValue;
        }
    });
}
