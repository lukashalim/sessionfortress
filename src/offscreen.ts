import { folderStatusFromHandle, readLatestVault, writeVaultToFolder } from "./lib/folder";
import type { OffscreenRequest } from "./lib/messages";
import type { FolderStatus } from "./lib/types";
import { isValidSession } from "./lib/util";

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  const request = msg as OffscreenRequest;
  if (!request || request.target !== "offscreen") return;
  handle(request)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "Offscreen failed.",
      });
    });
  return true;
});

async function handle(request: OffscreenRequest): Promise<unknown> {
  if (request.type === "WRITE_VAULT") {
    return writeVaultToFolder(request.json, request.retention, request.allowEmpty);
  }
  if (request.type === "FOLDER_STATUS") {
    return folderStatusFromHandle();
  }
  if (request.type === "PEEK_LATEST") {
    const status = await folderStatusFromHandle();
    const latest = await readLatestVault();
    const sessions = latest.vault?.sessions.filter(isValidSession) ?? [];
    const folderStatus: FolderStatus =
      status.status === "ok" && latest.permission !== "granted"
        ? "permission-expired"
        : status.status;
    return {
      status: folderStatus,
      folderName: status.folderName,
      available: sessions.length > 0,
      exportedAt: latest.vault?.exportedAt ?? null,
      sessionCount: sessions.length,
      error: latest.error,
    };
  }
  return { ok: false, error: "Unknown offscreen request." };
}
