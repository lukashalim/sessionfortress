export const APP_ID = "session-fortress" as const;
export const SCHEMA_VERSION = 1 as const;
export const SUPPORT_EMAIL = "lukas.halim@gmail.com";

export const EXPORT_REMINDER_MS = 7 * 24 * 60 * 60 * 1000;
export const REPLICA_WRITE_DEBOUNCE_MS = 800;
export const RESTORE_BATCH_SIZE = 10;
export const RESTORE_BATCH_YIELD_MS = 40;
export const LARGE_SESSION_TAB_THRESHOLD = 50;

export const STORAGE_SESSIONS = "sessions";
export const STORAGE_META = "vaultMeta";
export const STORAGE_SETTINGS = "settings";
export const STORAGE_RECOVERY = "recovery";
export const STORAGE_LAST_ADD = "lastAddRestore";

export type TabGroupColor =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "cyan"
  | "orange";

export type WindowState = "normal" | "minimized" | "maximized" | "fullscreen" | "locked-fullscreen";

export type TabRecord = {
  url: string;
  title: string;
  pinned: boolean;
  index: number;
  groupId: string | null;
  discarded?: boolean;
};

export type GroupRecord = {
  id: string;
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
};

export type WindowRecord = {
  id: string;
  focused?: boolean;
  incognito: boolean;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  state?: WindowState;
  groups: GroupRecord[];
  tabs: TabRecord[];
};

export type SessionSource = "manual" | "stash" | "autosave-close" | "imported";

export type Session = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  source: SessionSource;
  windows: WindowRecord[];
};

export type VaultMeta = {
  schemaVersion: typeof SCHEMA_VERSION;
  lastSavedAt: number | null;
  lastExportAt: number | null;
  lastExportReminderAt: number | null;
  lastBackupAt?: number | null;
  lastBackupOk?: boolean;
  lastBackupError?: string | null;
  backupGeneration?: number;
  folderName?: string | null;
};

export type Settings = {
  startupHealthCheck: boolean;
  includeIncognitoInBackup: boolean;
  remindExportWeekly: boolean;
};

export type RecoveryState = {
  active: boolean;
  reason: "empty-or-corrupt" | "replica-restored" | null;
  folderAvailable: boolean;
  folderExportedAt: number | null;
  replicaRestoredCount: number;
  dismissed: boolean;
};

export type RestoreMode = "new" | "replace" | "add";

export type FolderVault = {
  app: typeof APP_ID;
  schemaVersion: number;
  exportedAt: number;
  sessions: Session[];
  meta: VaultMeta;
};

export type CaptureResult = {
  session: Session;
  savedTabs: number;
  skippedSystem: number;
};

export type RestoreResult = {
  windowsCreated: number;
  tabsCreated: number;
  groupsCreated: number;
  skippedIncognitoWindows: number;
  askedDuplicate: boolean;
  cancelled: boolean;
};

export type ImportSummary = {
  added: number;
  skipped: number;
  renamed: number;
  warnings: string[];
  sourceFormat: "session-fortress" | "session-buddy" | "tab-session-manager" | "unknown";
};

export type LastAddRestore = {
  sessionId: string;
  windowId: number;
  at: number;
};

export type Bootstrap = {
  sessions: Session[];
  meta: VaultMeta;
  settings: Settings;
  recovery: RecoveryState;
  exportReminderDue: boolean;
  lastExportAgeMs: number | null;
};

export const DEFAULT_SETTINGS: Settings = {
  startupHealthCheck: true,
  includeIncognitoInBackup: false,
  remindExportWeekly: true,
};

export const DEFAULT_META: VaultMeta = {
  schemaVersion: SCHEMA_VERSION,
  lastSavedAt: null,
  lastExportAt: null,
  lastExportReminderAt: null,
};

export const DEFAULT_RECOVERY: RecoveryState = {
  active: false,
  reason: null,
  folderAvailable: false,
  folderExportedAt: null,
  replicaRestoredCount: 0,
  dismissed: false,
};
