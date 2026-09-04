import type { FolderStatus, VaultMeta } from "./types";

export async function applyBadge(status: FolderStatus, meta: VaultMeta): Promise<void> {
  const failed =
    status === "permission-expired" ||
    status === "failed" ||
    (Boolean(meta.folderName) && meta.lastBackupOk === false);
  const text = failed ? "!" : "";
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: "#b85c4c" });
  }
}

export function folderStatusFromMeta(meta: VaultMeta, handleExists: boolean, permission: PermissionState | "missing"): FolderStatus {
  if (!handleExists || permission === "missing") return "no-folder";
  if (permission !== "granted") return "permission-expired";
  if (meta.lastBackupError && !meta.lastBackupOk) return "failed";
  if (meta.lastBackupOk) return "ok";
  return "unknown";
}
