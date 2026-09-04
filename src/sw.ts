import { applyBadge } from "./lib/badge";
import { captureWindows, closeWindowAfterStash } from "./lib/capture";
import { nextRecoveryState } from "./lib/recovery";
import { runHealthCheck, type FolderPeek } from "./lib/health";
import { applyImport, exportSessionJson, exportVaultJson, parseImportedJson } from "./lib/importExport";
import type { ClientRequest, ClientResponse, OffscreenRequest } from "./lib/messages";
import { restoreSession } from "./lib/restore";
import {
  buildFolderVault,
  loadAll,
  saveLastAdd,
  saveMeta,
  saveRecovery,
  saveSessions,
  saveSettings,
  setAllowEmptyMirror,
  setPendingBackup,
} from "./lib/store";
import {
  DEFAULT_RECOVERY,
  DEFAULT_SETTINGS,
  FOLDER_WRITE_DEBOUNCE_MS,
  type Bootstrap,
  type FolderStatus,
  type Session,
  type VaultMeta,
} from "./lib/types";
import { cloneSession, isValidSession } from "./lib/util";
import {
  computeAllowEmptyWrite,
  shouldDisarmAllowEmptyMirror,
  vaultHasRestoreableContent,
} from "./lib/mirrorGuard";
import {
  clearStaleKeepaliveAlarms,
  isKeepaliveAlarmName,
  onKeepaliveTick,
  withCriticalWork,
} from "./lib/keepalive";

let writeTimer: ReturnType<typeof setTimeout> | null = null;

function isOffscreenMessage(msg: unknown): msg is OffscreenRequest {
  return Boolean(msg && typeof msg === "object" && (msg as { target?: string }).target === "offscreen");
}

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts?.({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts && contexts.length > 0) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: "Write session vault JSON to the user-chosen backup folder.",
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.toLowerCase().includes("exists")) return;
    throw error;
  }
}

async function offscreenCall<T>(msg: OffscreenRequest): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await ensureOffscreen();
    try {
      const result = (await chrome.runtime.sendMessage(msg)) as T | undefined;
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Offscreen document did not respond.");
}

async function peekFolder(): Promise<FolderPeek> {
  try {
    return await offscreenCall<FolderPeek>({ target: "offscreen", type: "PEEK_LATEST" });
  } catch {
    return {
      status: "unknown",
      folderName: null,
      available: false,
      exportedAt: null,
      sessionCount: 0,
      error: "Offscreen folder peek failed.",
    };
  }
}

async function buildBootstrap(folderStatus?: FolderStatus): Promise<Bootstrap> {
  const all = await loadAll();
  let status = folderStatus;
  if (!status) {
    if (!all.meta.folderName) status = "no-folder";
    else if (all.meta.lastBackupError?.toLowerCase().includes("permission")) status = "permission-expired";
    else if (all.meta.lastBackupOk) status = "ok";
    else if (all.meta.lastBackupError) status = "failed";
    else status = "unknown";
  }
  await applyBadge(status, all.meta);
  return {
    sessions: all.sessions,
    meta: all.meta,
    settings: all.settings,
    recovery: all.recovery,
    folderStatus: status,
    lastBackupAgeMs: all.meta.lastBackupAt ? Date.now() - all.meta.lastBackupAt : null,
  };
}

async function persistAndMirror(
  sessions: Session[],
  metaPatch?: Partial<VaultMeta>,
  folderWrite: "debounce" | "flush" = "debounce",
): Promise<Bootstrap> {
  const run = async (): Promise<Bootstrap> => {
    await saveSessions(sessions, metaPatch);
    if (sessions.length > 0) {
      const all = await loadAll();
      if (!all.storageCorrupt) {
        await saveRecovery(
          nextRecoveryState({
            hotEmpty: false,
            replicaRestored: false,
            folderKnown: Boolean(all.meta.folderName),
            previous: all.recovery,
            replicaRestoredCount: 0,
            folderExportedAt: all.recovery.folderExportedAt,
          }),
        );
      }
    }
    if (folderWrite === "flush") {
      await cancelScheduledFolderWrite();
      await setPendingBackup(true);
      await flushFolderWrite();
    } else {
      await scheduleFolderWrite();
    }
    return buildBootstrap();
  };
  if (folderWrite === "flush") {
    return withCriticalWork(run);
  }
  return run();
}

async function cancelScheduledFolderWrite(): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    await chrome.alarms.clear("folder-backup");
  } catch {
    // Ignore.
  }
}

async function scheduleFolderWrite(): Promise<void> {
  await setPendingBackup(true);
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void flushFolderWrite();
  }, FOLDER_WRITE_DEBOUNCE_MS);
  await chrome.alarms.create("folder-backup", { when: Date.now() + Math.max(FOLDER_WRITE_DEBOUNCE_MS, 1000) });
}

async function flushFolderWrite(): Promise<void> {
  await withCriticalWork(async () => {
    const all = await loadAll();
    if (!all.meta.folderName) {
      await setPendingBackup(false);
      await applyBadge("no-folder", all.meta);
      return;
    }

    const vault = await buildFolderVault(all.sessions, all.meta, all.settings);
    const incomingHasContent = vaultHasRestoreableContent(vault.sessions);
    const allowEmpty = computeAllowEmptyWrite(all.allowEmptyMirror, incomingHasContent);

    let result: { ok: boolean; error: string | null; exportedAt: number | null };
    try {
      result = await offscreenCall({
        target: "offscreen",
        type: "WRITE_VAULT",
        json: JSON.stringify(vault),
        retention: all.settings.retention,
        allowEmpty,
      });
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : "Folder write failed.",
        exportedAt: null,
      };
    }

    const meta: VaultMeta = {
      ...all.meta,
      lastBackupAt: result.ok ? result.exportedAt ?? Date.now() : all.meta.lastBackupAt,
      lastBackupOk: result.ok,
      lastBackupError: result.ok ? null : result.error,
      backupGeneration: result.ok ? all.meta.backupGeneration + 1 : all.meta.backupGeneration,
    };
    await saveMeta(meta);
    await setPendingBackup(false);
    if (shouldDisarmAllowEmptyMirror(all.allowEmptyMirror, incomingHasContent)) {
      await setAllowEmptyMirror(false);
    }

    const status: FolderStatus = result.ok
      ? "ok"
      : result.error?.toLowerCase().includes("permission")
        ? "permission-expired"
        : "failed";
    await applyBadge(status, meta);
  });
}

async function saveFromCapture(
  scope: "current" | "all",
  source: Session["source"],
  stash: boolean,
): Promise<{ capture: import("./lib/types").CaptureResult; bootstrap: Bootstrap }> {
  const current = await chrome.windows.getCurrent();
  const captured = await captureWindows(scope, source);
  if (captured.session.windows.length === 0) {
    throw new Error("Nothing to save. System pages are skipped.");
  }
  const all = await loadAll();
  const sessions = [captured.session, ...all.sessions];
  if (stash) {
    return withCriticalWork(async () => {
      const bootstrap = await persistAndMirror(sessions, undefined, "flush");
      if (current.id != null) {
        await closeWindowAfterStash(current.id);
      }
      return { capture: captured, bootstrap };
    });
  }
  const bootstrap = await persistAndMirror(sessions, undefined, "debounce");
  return { capture: captured, bootstrap };
}

async function openManager(): Promise<void> {
  const url = chrome.runtime.getURL("manager.html");
  const existing = await chrome.tabs.query({ url });
  if (existing[0]?.id != null) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId != null) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url, active: true });
}

async function handleRequest(msg: ClientRequest, sender: chrome.runtime.MessageSender): Promise<ClientResponse> {
  switch (msg.type) {
    case "GET_BOOTSTRAP":
      return { ok: true, bootstrap: await buildBootstrap() };
    case "SAVE_WINDOW": {
      const result = await saveFromCapture("current", "manual", false);
      return { ok: true, capture: result.capture, bootstrap: result.bootstrap };
    }
    case "SAVE_ALL": {
      const result = await saveFromCapture("all", "manual", false);
      return { ok: true, capture: result.capture, bootstrap: result.bootstrap };
    }
    case "STASH": {
      const result = await saveFromCapture("current", "stash", true);
      return { ok: true, capture: result.capture, bootstrap: result.bootstrap };
    }
    case "RENAME": {
      const all = await loadAll();
      const sessions = all.sessions.map((s) =>
        s.id === msg.sessionId ? { ...s, name: msg.name.trim() || s.name, updatedAt: Date.now() } : s,
      );
      return { ok: true, bootstrap: await persistAndMirror(sessions) };
    }
    case "DUPLICATE": {
      const all = await loadAll();
      const target = all.sessions.find((s) => s.id === msg.sessionId);
      if (!target) throw new Error("Session not found.");
      return { ok: true, bootstrap: await persistAndMirror([cloneSession(target), ...all.sessions]) };
    }
    case "DELETE": {
      const all = await loadAll();
      const sessions = all.sessions.filter((s) => s.id !== msg.sessionId);
      if (sessions.length === 0 && all.sessions.length > 0) {
        return withCriticalWork(async () => {
          await setAllowEmptyMirror(true);
          return { ok: true, bootstrap: await persistAndMirror(sessions, undefined, "flush") };
        });
      }
      return { ok: true, bootstrap: await persistAndMirror(sessions) };
    }
    case "RESTORE": {
      return withCriticalWork(async () => {
        const all = await loadAll();
        const session = all.sessions.find((s) => s.id === msg.sessionId);
        if (!session) throw new Error("Session not found.");
        const restore = await restoreSession(
          session,
          msg.mode,
          sender.tab?.windowId,
          Boolean(msg.duplicateConfirmed),
        );
        if (restore.askedDuplicate) {
          return { ok: true, restore, bootstrap: await buildBootstrap(), needsDuplicateConfirm: true };
        }
        if (msg.mode === "add" && sender.tab?.windowId != null) {
          await saveLastAdd({ sessionId: session.id, windowId: sender.tab.windowId, at: Date.now() });
        }
        return { ok: true, restore, bootstrap: await buildBootstrap() };
      });
    }
    case "EXPORT_ALL": {
      const all = await loadAll();
      return {
        ok: true,
        json: exportVaultJson(all.sessions, all.meta, all.settings.includeIncognitoInBackup),
        filename: "session-fortress-export.json",
      };
    }
    case "EXPORT_ONE": {
      const all = await loadAll();
      const session = all.sessions.find((s) => s.id === msg.sessionId);
      if (!session) throw new Error("Session not found.");
      const safe = session.name.replace(/[^\w\-]+/g, "-").slice(0, 40);
      return {
        ok: true,
        json: exportSessionJson(session, all.meta, all.settings.includeIncognitoInBackup),
        filename: `session-fortress-${safe || "session"}.json`,
      };
    }
    case "IMPORT": {
      const parsed = parseImportedJson(msg.json);
      if (parsed.sessions.length === 0) {
        throw new Error(parsed.warnings[0] || "No sessions found in that file.");
      }
      const all = await loadAll();
      const applied = applyImport(all.sessions, parsed.sessions, msg.strategy);
      const bootstrap = await persistAndMirror(
        applied.sessions,
        undefined,
        msg.strategy === "replace" ? "flush" : "debounce",
      );
      return {
        ok: true,
        import: {
          ...applied,
          warnings: [...applied.warnings, ...parsed.warnings],
          sourceFormat: parsed.sourceFormat,
        },
        bootstrap,
      };
    }
    case "FOLDER_PICKED": {
      const all = await loadAll();
      await saveMeta({ ...all.meta, folderName: msg.folderName, lastBackupError: null });
      const peek = await peekFolder();
      const latest = await loadAll();
      if (latest.sessions.length === 0 && peek.sessionCount > 0) {
        await saveRecovery({
          active: true,
          reason: "empty-or-corrupt",
          folderAvailable: true,
          folderExportedAt: peek.exportedAt,
          replicaRestoredCount: 0,
          dismissed: false,
        });
        return { ok: true, bootstrap: await buildBootstrap(peek.status), folderStatus: peek.status };
      }
      await scheduleFolderWrite();
      return { ok: true, bootstrap: await buildBootstrap("ok"), folderStatus: "ok" };
    }
    case "FOLDER_CLEARED": {
      const all = await loadAll();
      await saveMeta({
        ...all.meta,
        folderName: null,
        lastBackupOk: false,
        lastBackupError: null,
        lastBackupAt: null,
      });
      return { ok: true, bootstrap: await buildBootstrap("no-folder"), folderStatus: "no-folder" };
    }
    case "WRITE_FOLDER_NOW": {
      await flushFolderWrite();
      return { ok: true, bootstrap: await buildBootstrap() };
    }
    case "RESTORE_FROM_FOLDER": {
      const incoming = msg.vault.sessions.filter(isValidSession);
      if (incoming.length === 0) throw new Error("That backup file has no sessions.");
      const meta = { ...msg.vault.meta, schemaVersion: 1 as const };
      const bootstrap = await persistAndMirror(incoming, meta, "flush");
      await saveRecovery({ ...DEFAULT_RECOVERY, dismissed: true });
      return { ok: true, bootstrap: { ...bootstrap, recovery: { ...DEFAULT_RECOVERY, dismissed: true } } };
    }
    case "DISMISS_RECOVERY": {
      const all = await loadAll();
      await saveRecovery({ ...all.recovery, active: false, dismissed: true });
      return { ok: true, bootstrap: await buildBootstrap() };
    }
    case "SET_SETTINGS": {
      const all = await loadAll();
      const next = { ...all.settings, ...msg.settings };
      await saveSettings(next);
      await scheduleFolderWrite();
      return { ok: true, bootstrap: await buildBootstrap() };
    }
    case "RESET_SETTINGS": {
      await saveSettings(DEFAULT_SETTINGS);
      return { ok: true, bootstrap: await buildBootstrap() };
    }
    case "OPEN_MANAGER":
      await openManager();
      return { ok: true };
    case "OPEN_OPTIONS":
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case "HEALTH_CHECK": {
      const peek = await peekFolder();
      await runHealthCheck(peek);
      const latest = await loadAll();
      if (latest.pendingBackup) await flushFolderWrite();
      return { ok: true, bootstrap: await buildBootstrap(peek.status) };
    }
    default:
      throw new Error("Unknown message.");
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
  if (isOffscreenMessage(msg)) return;
  const request = msg as ClientRequest;
  handleRequest(request, sender)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Request failed.";
      sendResponse({ ok: false, error: message } satisfies ClientResponse);
    });
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    if (command === "save-window") await saveFromCapture("current", "manual", false);
    if (command === "save-all") await saveFromCapture("all", "manual", false);
    if (command === "stash") await saveFromCapture("current", "stash", true);
    if (command === "open-manager") await openManager();
  })();
});

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await clearStaleKeepaliveAlarms();
    const peek = await peekFolder();
    await runHealthCheck(peek);
    const all = await loadAll();
    await applyBadge(peek.status, all.meta);
    if (details.reason === "install") {
      await openManager();
    }
    if (all.pendingBackup) await flushFolderWrite();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await clearStaleKeepaliveAlarms();
    const peek = await peekFolder();
    await runHealthCheck(peek);
    const all = await loadAll();
    await applyBadge(peek.status, all.meta);
    if (all.pendingBackup) await flushFolderWrite();
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (isKeepaliveAlarmName(alarm.name)) {
    void onKeepaliveTick();
    return;
  }
  if (alarm.name === "folder-backup") {
    void flushFolderWrite();
  }
});
