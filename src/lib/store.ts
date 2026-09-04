import { loadReplica, saveReplica } from "./idb";
import {
  APP_ID,
  DEFAULT_META,
  DEFAULT_RECOVERY,
  DEFAULT_SETTINGS,
  SCHEMA_VERSION,
  STORAGE_ALLOW_EMPTY_MIRROR,
  STORAGE_LAST_ADD,
  STORAGE_META,
  STORAGE_PENDING_BACKUP,
  STORAGE_RECOVERY,
  STORAGE_SESSIONS,
  STORAGE_SETTINGS,
  type FolderVault,
  type LastAddRestore,
  type RecoveryState,
  type Session,
  type Settings,
  type VaultMeta,
} from "./types";
import { clampRetention, isValidSession, sanitizeSessionsForMirror } from "./util";

interface StorageShape {
  [STORAGE_SESSIONS]?: Session[];
  [STORAGE_META]?: VaultMeta;
  [STORAGE_SETTINGS]?: Settings;
  [STORAGE_RECOVERY]?: RecoveryState;
  [STORAGE_PENDING_BACKUP]?: boolean;
  [STORAGE_ALLOW_EMPTY_MIRROR]?: boolean;
  [STORAGE_LAST_ADD]?: LastAddRestore | null;
}

function normalizeSettings(raw: Settings | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  merged.retention = clampRetention(merged.retention);
  merged.startupHealthCheck = Boolean(merged.startupHealthCheck);
  merged.includeIncognitoInBackup = Boolean(merged.includeIncognitoInBackup);
  return merged;
}

function normalizeMeta(raw: VaultMeta | undefined): VaultMeta {
  return {
    ...DEFAULT_META,
    ...raw,
    schemaVersion: SCHEMA_VERSION,
  };
}

export function isSessionsCorrupt(sessions: unknown): boolean {
  if (sessions == null) return true;
  if (!Array.isArray(sessions)) return true;
  return sessions.some((s) => !isValidSession(s));
}

export async function loadAll(): Promise<{
  sessions: Session[];
  meta: VaultMeta;
  settings: Settings;
  recovery: RecoveryState;
  pendingBackup: boolean;
  allowEmptyMirror: boolean;
  lastAdd: LastAddRestore | null;
  storageEmpty: boolean;
  storageCorrupt: boolean;
}> {
  const data = (await chrome.storage.local.get([
    STORAGE_SESSIONS,
    STORAGE_META,
    STORAGE_SETTINGS,
    STORAGE_RECOVERY,
    STORAGE_PENDING_BACKUP,
    STORAGE_ALLOW_EMPTY_MIRROR,
    STORAGE_LAST_ADD,
  ])) as StorageShape;

  const storageEmpty = data[STORAGE_SESSIONS] == null;
  const storageCorrupt = isSessionsCorrupt(data[STORAGE_SESSIONS]);
  const sessions = Array.isArray(data[STORAGE_SESSIONS])
    ? data[STORAGE_SESSIONS]!.filter(isValidSession)
    : [];

  return {
    sessions,
    meta: normalizeMeta(data[STORAGE_META]),
    settings: normalizeSettings(data[STORAGE_SETTINGS]),
    recovery: { ...DEFAULT_RECOVERY, ...data[STORAGE_RECOVERY] },
    pendingBackup: Boolean(data[STORAGE_PENDING_BACKUP]),
    allowEmptyMirror: Boolean(data[STORAGE_ALLOW_EMPTY_MIRROR]),
    lastAdd: data[STORAGE_LAST_ADD] ?? null,
    storageEmpty,
    storageCorrupt,
  };
}

export async function saveSessions(sessions: Session[], metaPatch?: Partial<VaultMeta>): Promise<VaultMeta> {
  const current = await loadAll();
  const meta: VaultMeta = { ...current.meta, ...metaPatch };
  await chrome.storage.local.set({
    [STORAGE_SESSIONS]: sessions,
    [STORAGE_META]: meta,
  });
  await writeReplica(sessions, meta);
  return meta;
}

export async function saveMeta(meta: VaultMeta): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_META]: meta });
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_SETTINGS]: normalizeSettings(settings) });
}

export async function saveRecovery(recovery: RecoveryState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_RECOVERY]: recovery });
}

export async function setPendingBackup(pending: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_PENDING_BACKUP]: pending });
}

export async function setAllowEmptyMirror(allow: boolean): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_ALLOW_EMPTY_MIRROR]: allow });
}

export async function saveLastAdd(lastAdd: LastAddRestore | null): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_LAST_ADD]: lastAdd });
}

export async function writeReplica(sessions: Session[], meta: VaultMeta): Promise<FolderVault> {
  const replica: FolderVault = {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    sessions,
    meta,
  };
  await saveReplica(replica);
  return replica;
}

export async function buildFolderVault(
  sessions: Session[],
  meta: VaultMeta,
  settings: Settings,
): Promise<FolderVault> {
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    sessions: sanitizeSessionsForMirror(sessions, settings.includeIncognitoInBackup),
    meta: { ...meta, schemaVersion: SCHEMA_VERSION },
  };
}

export async function restoreFromReplicaIfNeeded(): Promise<{
  restored: boolean;
  sessions: Session[];
}> {
  const current = await loadAll();
  if (!current.storageEmpty && !current.storageCorrupt && current.sessions.length > 0) {
    return { restored: false, sessions: current.sessions };
  }
  const replica = await loadReplica();
  const replicaSessions = replica?.sessions?.filter(isValidSession) ?? [];
  if (replicaSessions.length === 0) {
    return { restored: false, sessions: current.sessions };
  }
  const meta = replica?.meta ? { ...DEFAULT_META, ...replica.meta } : current.meta;
  await chrome.storage.local.set({
    [STORAGE_SESSIONS]: replicaSessions,
    [STORAGE_META]: meta,
  });
  return { restored: true, sessions: replicaSessions };
}

export { loadReplica };
