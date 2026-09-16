import { applyBadge } from "./lib/badge";
import { captureWindows, closeWindowAfterStash } from "./lib/capture";
import { runHealthCheck } from "./lib/health";
import { applyImport, exportSessionJson, exportVaultJson, parseImportedJson } from "./lib/importExport";
import type { ClientRequest, ClientResponse } from "./lib/messages";
import { isExportReminderDue } from "./lib/reminder";
import { restoreSession } from "./lib/restore";
import { nextRecoveryState } from "./lib/recovery";
import {
  loadAll,
  saveLastAdd,
  saveMeta,
  saveRecovery,
  saveSessions,
  saveSettings,
} from "./lib/store";
import { DEFAULT_SETTINGS, type Bootstrap, type Session, type VaultMeta } from "./lib/types";
import { cloneSession, exportFilename } from "./lib/util";
import {
  clearStaleKeepaliveAlarms,
  isKeepaliveAlarmName,
  onKeepaliveTick,
  withCriticalWork,
} from "./lib/keepalive";

async function buildBootstrap(): Promise<Bootstrap> {
  const all = await loadAll();
  const exportReminderDue = isExportReminderDue({
    remind: all.settings.remindExportWeekly,
    hasSessions: all.sessions.length > 0,
    lastExportAt: all.meta.lastExportAt,
    lastSavedAt: all.meta.lastSavedAt,
    lastExportReminderAt: all.meta.lastExportReminderAt,
  });
  await applyBadge(all.recovery);
  return {
    sessions: all.sessions,
    meta: all.meta,
    settings: all.settings,
    recovery: all.recovery,
    exportReminderDue,
    lastExportAgeMs: all.meta.lastExportAt ? Date.now() - all.meta.lastExportAt : null,
  };
}

async function persistSessions(sessions: Session[], metaPatch?: Partial<VaultMeta>): Promise<Bootstrap> {
  await saveSessions(sessions, metaPatch);
  if (sessions.length > 0) {
    const all = await loadAll();
    if (!all.storageCorrupt) {
      await saveRecovery(
        nextRecoveryState({
          hotEmpty: false,
          replicaRestored: false,
          previous: all.recovery,
          replicaRestoredCount: 0,
        }),
      );
    }
  }
  return buildBootstrap();
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
      const bootstrap = await persistSessions(sessions);
      if (current.id != null) {
        await closeWindowAfterStash(current.id);
      }
      return { capture: captured, bootstrap };
    });
  }
  const bootstrap = await persistSessions(sessions);
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
      return { ok: true, bootstrap: await persistSessions(sessions) };
    }
    case "DUPLICATE": {
      const all = await loadAll();
      const target = all.sessions.find((s) => s.id === msg.sessionId);
      if (!target) throw new Error("Session not found.");
      return { ok: true, bootstrap: await persistSessions([cloneSession(target), ...all.sessions]) };
    }
    case "DELETE": {
      const all = await loadAll();
      const sessions = all.sessions.filter((s) => s.id !== msg.sessionId);
      return { ok: true, bootstrap: await persistSessions(sessions) };
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
        filename: exportFilename(),
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
        filename: `${safe || "session"}-${exportFilename()}`,
      };
    }
    case "IMPORT": {
      let parsed: ReturnType<typeof parseImportedJson>;
      try {
        parsed = parseImportedJson(msg.json);
      } catch {
        throw new Error("That file is not valid JSON.");
      }
      if (parsed.sessions.length === 0) {
        throw new Error(parsed.warnings[0] || "No sessions found in that file.");
      }
      const all = await loadAll();
      const applied = applyImport(all.sessions, parsed.sessions);
      const bootstrap = await persistSessions(applied.sessions);
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
    case "MARK_EXPORTED": {
      const all = await loadAll();
      await saveMeta({
        ...all.meta,
        lastExportAt: Date.now(),
        lastExportReminderAt: Date.now(),
      });
      return { ok: true, bootstrap: await buildBootstrap() };
    }
    case "DISMISS_EXPORT_REMINDER": {
      const all = await loadAll();
      await saveMeta({ ...all.meta, lastExportReminderAt: Date.now() });
      return { ok: true, bootstrap: await buildBootstrap() };
    }
    case "DISMISS_RECOVERY": {
      const all = await loadAll();
      await saveRecovery({ ...all.recovery, active: false, dismissed: true });
      return { ok: true, bootstrap: await buildBootstrap() };
    }
    case "SET_SETTINGS": {
      const all = await loadAll();
      await saveSettings({ ...all.settings, ...msg.settings });
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
      await runHealthCheck();
      return { ok: true, bootstrap: await buildBootstrap() };
    }
    default:
      throw new Error("Unknown message.");
  }
}

chrome.runtime.onMessage.addListener((msg: unknown, sender, sendResponse) => {
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
    await runHealthCheck();
    const bootstrap = await buildBootstrap();
    await applyBadge(bootstrap.recovery);
    if (details.reason === "install") {
      await openManager();
    }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await clearStaleKeepaliveAlarms();
    await runHealthCheck();
    const bootstrap = await buildBootstrap();
    await applyBadge(bootstrap.recovery);
  })();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (isKeepaliveAlarmName(alarm.name)) {
    void onKeepaliveTick();
  }
});
