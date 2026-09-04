import {
  APP_ID,
  SCHEMA_VERSION,
  type FolderVault,
  type GroupRecord,
  type ImportStrategy,
  type ImportSummary,
  type Session,
  type TabRecord,
  type VaultMeta,
  type WindowRecord,
} from "./types";
import { asGroupRecord, asTabRecord, isValidSession, isValidVaultShape, normalizeGroupColor, sanitizeSessionsForMirror } from "./util";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return Boolean(value);
}

function looksLikeFortress(value: unknown): boolean {
  return isValidVaultShape(value) || (asObject(value)?.app === APP_ID);
}

function looksLikeSessionBuddy(value: unknown): boolean {
  const obj = asObject(value);
  if (!obj) return false;
  if (obj.sessions && Array.isArray(obj.sessions)) return true;
  if (obj.data && asObject(obj.data)?.sessions) return true;
  const keys = Object.keys(obj);
  return keys.includes("saved") || keys.includes("current") || keys.includes("sb_sessions");
}

function looksLikeTsm(value: unknown): boolean {
  const obj = asObject(value);
  if (!obj) return false;
  if (Array.isArray(obj)) return false;
  if ("sessionName" in obj || "windowsNumber" in obj) return true;
  if (obj.windows && (Array.isArray(obj.windows) || typeof obj.windows === "object")) {
    if ("name" in obj || "tabsNumber" in obj || "date" in obj) return true;
  }
  if (Array.isArray(obj.sessions) && obj.sessions[0] && asObject(obj.sessions[0])?.windows) {
    return Boolean(asObject(obj.sessions[0])?.tabsNumber != null || asObject(obj.sessions[0])?.sessionName);
  }
  return false;
}

function tabsFromUnknown(value: unknown): TabRecord[] {
  const tabs: TabRecord[] = [];
  const list = Array.isArray(value) ? value : Object.values(asObject(value) ?? {});
  list.forEach((item, index) => {
    const t = asObject(item);
    if (!t) return;
    const url = str(t.url || t.href);
    if (!url) return;
    tabs.push(
      asTabRecord({
        url,
        title: str(t.title, url),
        pinned: bool(t.pinned),
        index: num(t.index, index),
        groupId: typeof t.groupId === "string" ? t.groupId : null,
      }),
    );
  });
  return tabs;
}

function groupsFromUnknown(value: unknown): GroupRecord[] {
  const groups: GroupRecord[] = [];
  const list = Array.isArray(value) ? value : Object.values(asObject(value) ?? {});
  for (const item of list) {
    const g = asObject(item);
    if (!g) continue;
    const id = str(g.id, crypto.randomUUID());
    groups.push(
      asGroupRecord({
        id,
        title: str(g.title ?? g.name),
        color: normalizeGroupColor(str(g.color, "grey")),
        collapsed: bool(g.collapsed),
      }),
    );
  }
  return groups;
}

function windowFromUnknown(value: unknown): WindowRecord | null {
  const w = asObject(value);
  if (!w) return null;
  const tabs = tabsFromUnknown(w.tabs ?? w.tabList);
  if (tabs.length === 0) return null;
  return {
    id: str(w.id, crypto.randomUUID()),
    focused: bool(w.focused),
    incognito: bool(w.incognito),
    left: typeof w.left === "number" ? w.left : undefined,
    top: typeof w.top === "number" ? w.top : undefined,
    width: typeof w.width === "number" ? w.width : undefined,
    height: typeof w.height === "number" ? w.height : undefined,
    state: typeof w.state === "string" ? (w.state as import("./types").WindowState) : undefined,
    groups: groupsFromUnknown(w.groups ?? w.tabGroups),
    tabs,
  };
}

function sessionFromUnknown(value: unknown, source: Session["source"]): Session | null {
  const s = asObject(value);
  if (!s) return null;
  const windowsRaw = s.windows ?? s.win ?? s.browserWindows;
  const windows: WindowRecord[] = [];
  if (Array.isArray(windowsRaw)) {
    for (const w of windowsRaw) {
      const rec = windowFromUnknown(w);
      if (rec) windows.push(rec);
    }
  } else if (windowsRaw && typeof windowsRaw === "object") {
    for (const w of Object.values(windowsRaw as Record<string, unknown>)) {
      const rec = windowFromUnknown(w);
      if (rec) windows.push(rec);
    }
  } else if (s.tabs) {
    const tabs = tabsFromUnknown(s.tabs);
    if (tabs.length) {
      windows.push({
        id: crypto.randomUUID(),
        incognito: false,
        groups: groupsFromUnknown(s.groups),
        tabs,
      });
    }
  }
  if (windows.length === 0) return null;
  const now = Date.now();
  return {
    id: str(s.id, crypto.randomUUID()),
    name: str(s.name ?? s.sessionName ?? s.title, "Imported session"),
    createdAt: num(s.createdAt ?? s.created ?? s.date, now),
    updatedAt: num(s.updatedAt ?? s.modified ?? s.date, now),
    source,
    windows,
  };
}

function parseFortress(value: unknown): Session[] {
  if (isValidVaultShape(value)) {
    return value.sessions.filter(isValidSession);
  }
  const obj = asObject(value);
  if (obj && Array.isArray(obj.sessions)) {
    return obj.sessions.map((s) => sessionFromUnknown(s, "imported")).filter((s): s is Session => Boolean(s));
  }
  const single = sessionFromUnknown(value, "imported");
  return single ? [single] : [];
}

function parseSessionBuddy(value: unknown): { sessions: Session[]; warnings: string[] } {
  const warnings = ["Session Buddy import is best-effort. Tab Groups may be missing."];
  const obj = asObject(value);
  if (!obj) return { sessions: [], warnings };
  const candidates = [
    asArray(obj.sessions),
    asArray(asObject(obj.data)?.sessions),
    asArray(obj.saved),
    asArray(obj.sb_sessions),
  ];
  const rawSessions = candidates.find((list) => list.length > 0) ?? [];

  const sessions: Session[] = [];
  const list = rawSessions.length ? rawSessions : [obj];
  for (const item of list) {
    const rec = sessionFromUnknown(item, "imported");
    if (rec) sessions.push(rec);
  }
  return { sessions, warnings };
}

function parseTsm(value: unknown): { sessions: Session[]; warnings: string[] } {
  const warnings: string[] = [];
  const obj = asObject(value);
  if (!obj) return { sessions: [], warnings };
  const raw = Array.isArray(obj.sessions) ? obj.sessions : [obj];
  const sessions: Session[] = [];
  for (const item of raw) {
    const rec = sessionFromUnknown(item, "imported");
    if (rec) {
      const hasGroups = rec.windows.some((w) => w.groups.length > 0);
      if (!hasGroups) {
        warnings.push("Tab Session Manager import mapped windows and tabs. Groups were missing or not recognized.");
      }
      sessions.push(rec);
    }
  }
  return { sessions, warnings: [...new Set(warnings)] };
}

export function parseImportedJson(text: string): {
  sessions: Session[];
  sourceFormat: ImportSummary["sourceFormat"];
  warnings: string[];
} {
  const parsed: unknown = JSON.parse(text);
  if (looksLikeFortress(parsed)) {
    return { sessions: parseFortress(parsed), sourceFormat: "session-fortress", warnings: [] };
  }
  if (looksLikeTsm(parsed) && !looksLikeSessionBuddy(parsed)) {
    const r = parseTsm(parsed);
    return { ...r, sourceFormat: "tab-session-manager" };
  }
  if (looksLikeSessionBuddy(parsed)) {
    const r = parseSessionBuddy(parsed);
    return { ...r, sourceFormat: "session-buddy" };
  }
  const fallback = parseFortress(parsed);
  if (fallback.length) {
    return { sessions: fallback, sourceFormat: "session-fortress", warnings: [] };
  }
  const generic = sessionFromUnknown(parsed, "imported");
  return {
    sessions: generic ? [generic] : [],
    sourceFormat: "unknown",
    warnings: generic ? ["Imported an unrecognized JSON shape. Mapped what we could."] : ["No sessions found in that file."],
  };
}

export function applyImport(
  existing: Session[],
  incoming: Session[],
  strategy: ImportStrategy,
): ImportSummary & { sessions: Session[] } {
  if (strategy === "replace") {
    return {
      sessions: incoming.map((s) => ({ ...s, source: "imported" as const, id: s.id || crypto.randomUUID() })),
      added: incoming.length,
      skippedDuplicateIds: 0,
      replaced: existing.length,
      warnings: [],
      sourceFormat: "session-fortress",
    };
  }

  const ids = new Set(existing.map((s) => s.id));
  const added: Session[] = [];
  let skippedDuplicateIds = 0;
  for (const session of incoming) {
    const id = session.id || crypto.randomUUID();
    if (ids.has(id)) {
      skippedDuplicateIds += 1;
      continue;
    }
    ids.add(id);
    added.push({ ...session, id, source: "imported" });
  }
  return {
    sessions: [...added, ...existing],
    added: added.length,
    skippedDuplicateIds,
    replaced: 0,
    warnings: [],
    sourceFormat: "session-fortress",
  };
}

export function exportVaultJson(
  sessions: Session[],
  meta: VaultMeta,
  includeIncognitoInBackup = false,
): string {
  const vault: FolderVault = {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    sessions: sanitizeSessionsForMirror(sessions, includeIncognitoInBackup),
    meta,
  };
  return `${JSON.stringify(vault, null, 2)}\n`;
}

export function exportSessionJson(
  session: Session,
  meta: VaultMeta,
  includeIncognitoInBackup = false,
): string {
  return exportVaultJson([session], meta, includeIncognitoInBackup);
}
