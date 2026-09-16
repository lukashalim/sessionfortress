import { DEFAULT_RECOVERY, type RecoveryState } from "./types";

export function nextRecoveryState(args: {
  hotEmpty: boolean;
  replicaRestored: boolean;
  previous: RecoveryState;
  replicaRestoredCount: number;
}): RecoveryState {
  if (args.replicaRestored) {
    return {
      active: true,
      reason: "replica-restored",
      folderAvailable: false,
      folderExportedAt: null,
      replicaRestoredCount: args.replicaRestoredCount,
      dismissed: false,
    };
  }
  if (!args.hotEmpty) {
    return { ...DEFAULT_RECOVERY };
  }
  return {
    ...args.previous,
    active: false,
    reason: null,
  };
}
