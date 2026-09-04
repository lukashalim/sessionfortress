import assert from "node:assert/strict";
import { nextRecoveryState } from "../src/lib/recovery";
import { exportSessionJson, exportVaultJson, parseImportedJson } from "../src/lib/importExport";
import {
  applyKeepaliveBegin,
  applyKeepaliveEnd,
  isKeepaliveAlarmName,
  KEEPALIVE_PERIODIC,
  KEEPALIVE_SOON,
} from "../src/lib/keepalive";
import {
  computeAllowEmptyWrite,
  nextAllowEmptyMirrorAfterAttempt,
  shouldRefuseEmptyOverwrite,
  vaultHasRestoreableContent,
} from "../src/lib/mirrorGuard";
import { isProtectedUiUrl, windowCreateExtras, windowStateAfterCreate } from "../src/lib/restore";
import { DEFAULT_META, DEFAULT_RECOVERY, type Session, type WindowRecord } from "../src/lib/types";
import {
  datedBackupFilename,
  isDatedBackupName,
  isSkippableSystemUrl,
  sanitizeSessionsForMirror,
} from "../src/lib/util";

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
  assert.equal(isDatedBackupName("session-fortress-2026-09-04T074500.json"), true);
  assert.equal(isDatedBackupName("session-fortress-latest.json"), false);
  assert.match(datedBackupFilename(new Date("2026-09-04T12:34:56")), /session-fortress-2026-09-04T/);

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

  const hollow = [{ windows: [] }];
  assert.equal(vaultHasRestoreableContent(hollow), false);
  assert.equal(vaultHasRestoreableContent([]), false);
  assert.equal(vaultHasRestoreableContent(mixed), true);
  assert.equal(
    shouldRefuseEmptyOverwrite({
      allowEmpty: false,
      incomingHasContent: vaultHasRestoreableContent(hollow),
      existingHasContent: true,
    }),
    true,
  );

  let allowEmptyMirror = true;
  const incomingHasContent = false;
  const firstAllowEmpty = computeAllowEmptyWrite(allowEmptyMirror, incomingHasContent);
  assert.equal(firstAllowEmpty, true);
  assert.equal(
    shouldRefuseEmptyOverwrite({
      allowEmpty: firstAllowEmpty,
      incomingHasContent,
      existingHasContent: true,
    }),
    false,
  );

  allowEmptyMirror = nextAllowEmptyMirrorAfterAttempt({
    allowEmptyMirror,
    incomingHasContent,
  });
  assert.equal(allowEmptyMirror, false);

  const retryAllowEmpty = computeAllowEmptyWrite(allowEmptyMirror, incomingHasContent);
  assert.equal(retryAllowEmpty, false);
  assert.equal(
    shouldRefuseEmptyOverwrite({
      allowEmpty: retryAllowEmpty,
      incomingHasContent,
      existingHasContent: true,
    }),
    true,
  );

  assert.equal(computeAllowEmptyWrite(true, false), true);
  assert.equal(
    shouldRefuseEmptyOverwrite({
      allowEmpty: false,
      incomingHasContent: false,
      existingHasContent: true,
    }),
    true,
  );
  assert.equal(
    shouldRefuseEmptyOverwrite({
      allowEmpty: true,
      incomingHasContent: false,
      existingHasContent: true,
    }),
    false,
  );
  assert.equal(
    shouldRefuseEmptyOverwrite({
      allowEmpty: false,
      incomingHasContent: false,
      existingHasContent: false,
    }),
    false,
  );

  const emptyRecovery = nextRecoveryState({
    hotEmpty: true,
    replicaRestored: false,
    folderKnown: true,
    previous: DEFAULT_RECOVERY,
    replicaRestoredCount: 0,
    folderExportedAt: 1_700_000_000_000,
  });
  assert.equal(emptyRecovery.active, true);
  assert.equal(emptyRecovery.reason, "empty-or-corrupt");

  const healthyRecovery = nextRecoveryState({
    hotEmpty: false,
    replicaRestored: false,
    folderKnown: true,
    previous: emptyRecovery,
    replicaRestoredCount: 0,
    folderExportedAt: 1_700_000_000_000,
  });
  assert.equal(healthyRecovery.active, false);
  assert.equal(healthyRecovery.reason, null);

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

  const exportMixed = JSON.parse(
    exportVaultJson(mixed, DEFAULT_META, false),
  ) as { sessions: Session[] };
  assert.equal(exportMixed.sessions.length, 1);
  assert.equal(exportMixed.sessions[0]?.windows.every((w) => !w.incognito), true);
  const exportOne = JSON.parse(exportSessionJson(mixed[0], DEFAULT_META, false)) as { sessions: Session[] };
  assert.equal(exportOne.sessions[0]?.windows.some((w) => w.incognito), false);
  const exportWithIncognito = JSON.parse(
    exportVaultJson(mixed, DEFAULT_META, true),
  ) as { sessions: Session[] };
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
}
