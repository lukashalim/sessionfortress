import assert from "node:assert/strict";
import { nextRecoveryState } from "../src/lib/recovery";
import { applyImport, exportSessionJson, exportVaultJson, parseImportedJson, uniqueImportedName } from "../src/lib/importExport";
import {
  applyKeepaliveBegin,
  applyKeepaliveEnd,
  isKeepaliveAlarmName,
  KEEPALIVE_PERIODIC,
  KEEPALIVE_SOON,
} from "../src/lib/keepalive";
import { isExportReminderDue } from "../src/lib/reminder";
import { isProtectedUiUrl, windowCreateExtras, windowStateAfterCreate } from "../src/lib/restore";
import { DEFAULT_META, DEFAULT_RECOVERY, DEFAULT_SETTINGS, type Session, type WindowRecord } from "../src/lib/types";
import { exportFilename, isSkippableSystemUrl, sanitizeSessionsForMirror } from "../src/lib/util";

function windowRecord(partial: Partial<WindowRecord> & Pick<WindowRecord, "incognito" | "tabs">): WindowRecord {
  return {
    id: partial.id ?? "w",
    incognito: partial.incognito,
    groups: partial.groups ?? [],
    tabs: partial.tabs,
    focused: partial.focused,
    left: partial.left,
    top: partial.top,
    width: partial.width,
    height: partial.height,
    state: partial.state,
  };
}

function sessionRecord(partial: Partial<Session> & Pick<Session, "windows">): Session {
  return {
    id: partial.id ?? "s",
    name: partial.name ?? "Session",
    createdAt: partial.createdAt ?? 1,
    updatedAt: partial.updatedAt ?? 1,
    source: partial.source ?? "manual",
    windows: partial.windows,
  };
}

export function run(): void {
  assert.equal(isSkippableSystemUrl("chrome://settings"), true);
  assert.equal(isSkippableSystemUrl("https://example.com"), false);
  assert.equal(exportFilename(new Date("2026-09-16T12:34:56")), "session-fortress-2026-09-16.json");

  const fortress = parseImportedJson(
    JSON.stringify({
      app: "session-fortress",
      schemaVersion: 1,
      exportedAt: 1,
      sessions: [
        {
          id: "a",
          name: "Desk",
          createdAt: 1,
          updatedAt: 1,
          source: "manual",
          windows: [
            {
              id: "w",
              incognito: false,
              groups: [{ id: "g", title: "Work", color: "blue", collapsed: false }],
              tabs: [{ url: "https://example.com", title: "Ex", pinned: false, index: 0, groupId: "g" }],
            },
          ],
        },
      ],
      meta: {},
    }),
  );
  assert.equal(fortress.sourceFormat, "session-fortress");
  assert.equal(fortress.sessions.length, 1);
  assert.equal(fortress.sessions[0]?.windows[0]?.groups[0]?.title, "Work");

  const buddy = parseImportedJson(
    JSON.stringify({
      sessions: [
        {
          name: "Buddy",
          created: 2,
          windows: [{ tabs: [{ url: "https://a.example", title: "A", pinned: true }] }],
        },
      ],
    }),
  );
  assert.equal(buddy.sourceFormat, "session-buddy");
  assert.equal(buddy.sessions[0]?.windows[0]?.tabs[0]?.url, "https://a.example");

  const normalWin = windowRecord({
    id: "normal",
    incognito: false,
    tabs: [{ url: "https://example.com", title: "Ex", pinned: false, index: 0, groupId: null }],
  });
  const incognitoWin = windowRecord({
    id: "priv",
    incognito: true,
    tabs: [{ url: "https://secret.example", title: "Secret", pinned: false, index: 0, groupId: null }],
  });
  const mixed = [
    sessionRecord({
      id: "mixed",
      name: "Mixed",
      windows: [normalWin, incognitoWin],
    }),
  ];
  const mixedSanitized = sanitizeSessionsForMirror(mixed, false);
  assert.equal(mixedSanitized.length, 1);
  assert.equal(mixedSanitized[0]?.windows.length, 1);
  assert.equal(mixedSanitized[0]?.windows[0]?.incognito, false);
  assert.equal(mixedSanitized[0]?.windows[0]?.tabs[0]?.url, "https://example.com");

  const allIncognito = [
    sessionRecord({
      id: "incog",
      name: "Private only",
      windows: [incognitoWin],
    }),
  ];
  assert.deepEqual(sanitizeSessionsForMirror(allIncognito, false), []);
  assert.equal(sanitizeSessionsForMirror(allIncognito, true).length, 1);
  assert.equal(sanitizeSessionsForMirror(allIncognito, true)[0]?.windows[0]?.incognito, true);

  const existing = [
    sessionRecord({
      id: "keep",
      name: "Desk",
      windows: [normalWin],
    }),
  ];
  const incoming = [
    sessionRecord({
      id: "keep",
      name: "Desk",
      windows: [normalWin],
    }),
  ];
  const imported = applyImport(existing, incoming);
  assert.equal(imported.added, 1);
  assert.equal(imported.renamed, 1);
  assert.equal(imported.skipped, 0);
  assert.equal(imported.sessions.length, 2);
  assert.notEqual(imported.sessions[0]?.id, "keep");
  assert.equal(imported.sessions[0]?.name, "Desk (imported)");
  assert.equal(imported.sessions[1]?.id, "keep");

  const names = new Set(["desk", "desk (imported)"]);
  assert.equal(uniqueImportedName("Desk", names), "Desk (imported 2)");

  const replicaRecovery = nextRecoveryState({
    hotEmpty: true,
    replicaRestored: true,
    previous: DEFAULT_RECOVERY,
    replicaRestoredCount: 3,
  });
  assert.equal(replicaRecovery.active, true);
  assert.equal(replicaRecovery.reason, "replica-restored");
  assert.equal(replicaRecovery.replicaRestoredCount, 3);

  const emptyNoReplica = nextRecoveryState({
    hotEmpty: true,
    replicaRestored: false,
    previous: DEFAULT_RECOVERY,
    replicaRestoredCount: 0,
  });
  assert.equal(emptyNoReplica.active, false);

  const healthyRecovery = nextRecoveryState({
    hotEmpty: false,
    replicaRestored: false,
    previous: replicaRecovery,
    replicaRestoredCount: 0,
  });
  assert.equal(healthyRecovery.active, false);
  assert.equal(healthyRecovery.reason, null);

  const week = 8 * 24 * 60 * 60 * 1000;
  assert.equal(
    isExportReminderDue({
      remind: true,
      hasSessions: true,
      lastExportAt: null,
      lastSavedAt: Date.now() - week,
      lastExportReminderAt: null,
    }),
    true,
  );
  assert.equal(
    isExportReminderDue({
      remind: true,
      hasSessions: true,
      lastExportAt: Date.now(),
      lastSavedAt: Date.now() - week,
      lastExportReminderAt: null,
    }),
    false,
  );
  assert.equal(
    isExportReminderDue({
      remind: false,
      hasSessions: true,
      lastExportAt: null,
      lastSavedAt: Date.now() - week,
      lastExportReminderAt: null,
    }),
    false,
  );

  const origin = "chrome-extension://abcdef/";
  assert.equal(isProtectedUiUrl(`${origin}manager.html`, origin), true);
  assert.equal(isProtectedUiUrl(`${origin}options.html`, origin), true);
  assert.equal(isProtectedUiUrl("https://example.com", origin), false);

  const maxExtras = windowCreateExtras(
    windowRecord({
      incognito: false,
      tabs: [{ url: "https://example.com", title: "Ex", pinned: false, index: 0, groupId: null }],
      state: "maximized",
      left: 10,
      top: 20,
      width: 800,
      height: 600,
    }),
  );
  assert.equal(maxExtras.state, undefined);
  assert.equal(maxExtras.left, undefined);
  const normalExtras = windowCreateExtras(
    windowRecord({
      incognito: false,
      tabs: [{ url: "https://example.com", title: "Ex", pinned: false, index: 0, groupId: null }],
      state: "normal",
      left: 10,
      top: 20,
      width: 800,
      height: 600,
    }),
  );
  assert.equal(normalExtras.state, undefined);
  assert.equal(normalExtras.left, 10);
  assert.equal(windowStateAfterCreate("maximized"), "maximized");
  assert.equal(windowStateAfterCreate("fullscreen"), "fullscreen");
  assert.equal(windowStateAfterCreate("locked-fullscreen"), "fullscreen");
  assert.equal(windowStateAfterCreate("minimized"), null);
  assert.equal(windowStateAfterCreate("normal"), null);

  const exportMixed = JSON.parse(exportVaultJson(mixed, DEFAULT_META, false)) as {
    app: string;
    schemaVersion: number;
    exportedAt: number;
    sessions: Session[];
  };
  assert.equal(exportMixed.app, "session-fortress");
  assert.equal(exportMixed.schemaVersion, 1);
  assert.equal(typeof exportMixed.exportedAt, "number");
  assert.equal(exportMixed.sessions.length, 1);
  assert.equal(exportMixed.sessions[0]?.windows.every((w) => !w.incognito), true);
  const exportOne = JSON.parse(exportSessionJson(mixed[0], DEFAULT_META, false)) as { sessions: Session[] };
  assert.equal(exportOne.sessions[0]?.windows.some((w) => w.incognito), false);
  const exportWithIncognito = JSON.parse(exportVaultJson(mixed, DEFAULT_META, true)) as { sessions: Session[] };
  assert.equal(exportWithIncognito.sessions[0]?.windows.some((w) => w.incognito), true);

  assert.equal(isKeepaliveAlarmName(KEEPALIVE_PERIODIC), true);
  assert.equal(isKeepaliveAlarmName(KEEPALIVE_SOON), true);
  assert.equal(isKeepaliveAlarmName("folder-backup"), false);
  let depth = 0;
  const first = applyKeepaliveBegin(depth);
  assert.equal(first.start, true);
  depth = first.depth;
  const nested = applyKeepaliveBegin(depth);
  assert.equal(nested.start, false);
  depth = nested.depth;
  assert.equal(depth, 2);
  const innerEnd = applyKeepaliveEnd(depth);
  assert.equal(innerEnd.stop, false);
  depth = innerEnd.depth;
  const outerEnd = applyKeepaliveEnd(depth);
  assert.equal(outerEnd.stop, true);
  assert.equal(outerEnd.depth, 0);
  const extraEnd = applyKeepaliveEnd(0);
  assert.equal(extraEnd.stop, false);
  assert.equal(extraEnd.depth, 0);

  assert.equal(DEFAULT_SETTINGS.remindExportWeekly, true);
  assert.equal(DEFAULT_SETTINGS.startupHealthCheck, true);
}
