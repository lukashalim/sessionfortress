import { nextRecoveryState } from "./recovery";
import { loadAll, restoreFromReplicaIfNeeded, saveMeta, saveRecovery } from "./store";
import { type FolderStatus } from "./types";

export type FolderPeek = {
  status: FolderStatus;
  folderName: string | null;
  available: boolean;
  exportedAt: number | null;
  sessionCount: number;
  error: string | null;
};

export type HealthReport = {
  folderStatus: FolderStatus;
  recovery: import("./types").RecoveryState;
  replicaRestored: boolean;
};

export { nextRecoveryState };

export async function runHealthCheck(peek: FolderPeek): Promise<HealthReport> {
  const before = await loadAll();
  const skipReplica = !before.settings.startupHealthCheck && !before.storageEmpty && !before.storageCorrupt;

  const replicaResult = skipReplica
    ? { restored: false, sessions: before.sessions }
    : await restoreFromReplicaIfNeeded();
  const after = await loadAll();
  const replicaRestored = replicaResult.restored;
  const hotEmpty = after.sessions.length === 0 || after.storageCorrupt;
  const folderKnown =
    peek.available ||
    (Boolean(after.meta.folderName) && typeof after.meta.lastBackupAt === "number" && after.meta.lastBackupAt > 0);

  const recovery = nextRecoveryState({
    hotEmpty,
    replicaRestored,
    folderKnown,
    previous: after.recovery,
    replicaRestoredCount: replicaResult.sessions.length,
    folderExportedAt: peek.exportedAt ?? after.meta.lastBackupAt,
  });

  await saveRecovery(recovery);

  if (peek.status === "permission-expired") {
    await saveMeta({
      ...after.meta,
      lastBackupOk: false,
      lastBackupError: "Folder permission expired.",
    });
  }

  return { folderStatus: peek.status, recovery, replicaRestored };
}
