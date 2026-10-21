// The selection bar's batch actions: one request per item, one summary toast, one refresh.
import { toast } from "sonner";
import { api } from "@/lib/api";
import { planMove } from "../lib/explorerItems";
import { isItemStarred } from "../lib/fileCardHelpers";
import { isSystemProtectedFolder } from "../lib/fileKeyboardNavigation";

export function createBatchActions({ isCloudMode, cloudAccountId, currentPath, currentApiPath, refetch, moveItem }) {
const plural = (n) => `${n} item${n === 1 ? "" : "s"}`;
const runForEach = async (list, fn, done) => {
    if (list.length === 0)
        return;
    const results = await Promise.allSettled(list.map(fn));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected");
    if (ok > 0) {
        toast.success(done(ok));
        refetch();
    }
    if (failed.length > 0)
        toast.error(`${plural(failed.length)} failed: ${failed[0].reason?.message || "unknown error"}`);
};
const withoutSystemFolders = (list) => {
    const kept = list.filter((it) => !isSystemProtectedFolder(it, currentPath));
    if (kept.length < list.length)
        toast.error("Default system folders can't be moved");
    return kept;
};
return {
    setStarred: (list, on) => runForEach(list.filter((it) => isItemStarred(it) !== on), (it) => (isCloudMode
        ? api.starCloudFile(cloudAccountId || it.cloud_account_id, it.cloud_file_id || it.id, on)
        : api.toggleStar(it.id, on)), (n) => (on ? `Starred ${plural(n)}` : `Removed ${plural(n)} from Starred`)),
    toVault: (list) => runForEach(withoutSystemFolders(list), (it) => api.moveIntoVault(it.id), (n) => `Moved ${plural(n)} to the vault`),
    toHome: (list) => runForEach(list, (it) => api.moveOutOfVault(it.id), (n) => `Moved ${plural(n)} to Home`),
    restore: (list) => runForEach(list, (it) => (isCloudMode
        ? api.restoreCloudFile(cloudAccountId || it.cloud_account_id, it.cloud_file_id || it.id)
        : api.restoreFile(it.id)), (n) => `Restored ${plural(n)}`),
    moveTo: async (list, targetPath) => {
        const target = (targetPath || "/Home").replace(/\/+/g, "/").replace(/(.)\/$/, "$1");
        const { moves, skipped } = planMove(withoutSystemFolders(list), target, { fallbackPath: currentApiPath || "/Home" });
        if (moves.length === 0) {
            if (skipped.length > 0)
                toast.info(skipped.some((x) => x.reason === "into-itself") ? "A folder can't be moved into itself" : "Already in that folder");
            return;
        }
        await runForEach(moves, ({ item, via }) => (via === "vault-in" ? api.moveIntoVault(item.id, target)
            : via === "vault-out" ? api.moveOutOfVault(item.id, target)
                : moveItem(item, target, item.file_path || currentApiPath || "/Home")), (n) => `Moved ${plural(n)} to ${target}`);
    },
};
}
