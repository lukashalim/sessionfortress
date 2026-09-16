import { nextRecoveryState } from "./recovery";
import { loadAll, restoreFromReplicaIfNeeded, saveRecovery } from "./store";

export type HealthReport = {
  recovery: import("./types").RecoveryState;
  replicaRestored: boolean;
};

export { nextRecoveryState };

export async function runHealthCheck(): Promise<HealthReport> {
  const before = await loadAll();
  const skipReplica = !before.settings.startupHealthCheck && !before.storageEmpty && !before.storageCorrupt;

  const replicaResult = skipReplica
    ? { restored: false, sessions: before.sessions }
    : await restoreFromReplicaIfNeeded();
  const after = await loadAll();
  const replicaRestored = replicaResult.restored;
  const hotEmpty = after.sessions.length === 0 || after.storageCorrupt;

  const recovery = nextRecoveryState({
    hotEmpty,
    replicaRestored,
    previous: after.recovery,
    replicaRestoredCount: replicaResult.sessions.length,
  });

  await saveRecovery(recovery);
  return { recovery, replicaRestored };
}
