import { DEFAULT_RECOVERY, type RecoveryState } from "./types";

export function nextRecoveryState(args: {
  hotEmpty: boolean;
  replicaRestored: boolean;
  folderKnown: boolean;
  previous: RecoveryState;
  replicaRestoredCount: number;
  folderExportedAt: number | null;
}): RecoveryState {
  if (args.replicaRestored) {
    return {
      active: true,
      reason: "replica-restored",
      folderAvailable: args.folderKnown,
      folderExportedAt: args.folderExportedAt,
      replicaRestoredCount: args.replicaRestoredCount,
      dismissed: false,
    };
  }
  if (args.hotEmpty && args.folderKnown) {
    return {
      active: true,
      reason: "empty-or-corrupt",
      folderAvailable: true,
      folderExportedAt: args.folderExportedAt,
      replicaRestoredCount: 0,
      dismissed: false,
    };
  }
  if (!args.hotEmpty) {
    return {
      ...DEFAULT_RECOVERY,
      folderAvailable: args.folderKnown || args.previous.folderAvailable,
      folderExportedAt: args.previous.folderExportedAt ?? args.folderExportedAt,
    };
  }
  return {
    ...args.previous,
    active: false,
    reason: null,
  };
}
