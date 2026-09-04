import {
  APP_ID,
  type FolderVault,
  type GroupRecord,
  type Session,
  type TabGroupColor,
  type TabRecord,
  type WindowRecord,
} from "./types";

export function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

export function isFileUrl(url: string): boolean {
  return url.startsWith("file://");
}

export function isThisExtensionUrl(url: string): boolean {
  try {
    const extOrigin = chrome.runtime.getURL("");
    return url.startsWith(extOrigin);
  } catch {
    return false;
  }
}

export function isSkippableSystemUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (
    lower.startsWith("chrome://") ||
    lower.startsWith("edge://") ||
    lower.startsWith("about:") ||
    lower.startsWith("brave://") ||
    lower.startsWith("opera://") ||
    lower.startsWith("vivaldi://")
  ) {
    return true;
  }
  if (lower.startsWith("chrome-extension://") && !isThisExtensionUrl(url)) {
    return true;
  }
  if (
    lower.includes("chrome.google.com/webstore") ||
    lower.includes("chromewebstore.google.com")
  ) {
    return true;
  }
  return false;
}

export function shouldCaptureUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (isSkippableSystemUrl(url)) return false;
  if (isHttpUrl(url) || isFileUrl(url) || isThisExtensionUrl(url)) return true;
  return false;
}

export function clampRetention(n: number): number {
  if (!Number.isFinite(n)) return 20;
  return Math.min(50, Math.max(5, Math.round(n)));
}

export function datedBackupFilename(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  const ss = String(at.getSeconds()).padStart(2, "0");
  return `session-fortress-${y}-${m}-${d}T${hh}${mm}${ss}.json`;
}

export function isDatedBackupName(name: string): boolean {
  return /^session-fortress-\d{4}-\d{2}-\d{2}T\d{6}\.json$/.test(name);
}

export function defaultSessionName(windows: WindowRecord[], source: string, at: Date): string {
  const tabs = windows.reduce((n, w) => n + w.tabs.length, 0);
  const stamp = formatStamp(at);
  if (source === "stash") return `Stash — ${stamp}`;
  if (windows.length <= 1) return `Window — ${tabs} tabs — ${stamp}`;
  return `${windows.length} windows — ${tabs} tabs — ${stamp}`;
}

export function formatStamp(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  const hh = String(at.getHours()).padStart(2, "0");
  const mm = String(at.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export function relativeTime(from: number, now = Date.now()): string {
  const delta = Math.max(0, now - from);
  const sec = Math.round(delta / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  return formatStamp(new Date(from));
}

export function sessionTabCount(session: Session): number {
  return session.windows.reduce((n, w) => n + w.tabs.length, 0);
}

export function sessionGroupCount(session: Session): number {
  return session.windows.reduce((n, w) => n + w.groups.length, 0);
}

export function matchesQuery(session: Session, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  if (session.name.toLowerCase().includes(q)) return true;
  for (const win of session.windows) {
    for (const tab of win.tabs) {
      if (tab.title.toLowerCase().includes(q) || tab.url.toLowerCase().includes(q)) {
        return true;
      }
    }
    for (const group of win.groups) {
      if (group.title.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

export function sanitizeSessionsForMirror(
  sessions: Session[],
  includeIncognito: boolean,
): Session[] {
  return sessions
    .map((session) => ({
      ...session,
      windows: session.windows.filter(
        (w) => (includeIncognito || !w.incognito) && w.tabs.length > 0,
      ),
    }))
    .filter((session) => session.windows.length > 0);
}

export function isValidVaultShape(value: unknown): value is FolderVault {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.app !== APP_ID) return false;
  if (typeof v.schemaVersion !== "number") return false;
  if (!Array.isArray(v.sessions)) return false;
  return true;
}

export function isValidSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const s = value as Session;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    typeof s.createdAt === "number" &&
    Array.isArray(s.windows)
  );
}

export function cloneSession(session: Session, name?: string): Session {
  const now = Date.now();
  return {
    ...structuredClone(session),
    id: crypto.randomUUID(),
    name: name ?? `Copy of ${session.name}`,
    createdAt: now,
    updatedAt: now,
    source: "manual",
  };
}

export function normalizeGroupColor(color: string | undefined): TabGroupColor {
  const allowed: TabGroupColor[] = [
    "grey",
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange",
  ];
  if (color && (allowed as string[]).includes(color)) {
    return color as TabGroupColor;
  }
  return "grey";
}

export function emptyWindowRecord(partial?: Partial<WindowRecord>): WindowRecord {
  return {
    id: crypto.randomUUID(),
    incognito: false,
    groups: [],
    tabs: [],
    ...partial,
  };
}

export function asTabRecord(tab: Partial<TabRecord> & { url: string }): TabRecord {
  return {
    url: tab.url,
    title: tab.title ?? tab.url,
    pinned: Boolean(tab.pinned),
    index: tab.index ?? 0,
    groupId: tab.groupId ?? null,
    discarded: tab.discarded,
  };
}

export function asGroupRecord(group: Partial<GroupRecord> & { id: string }): GroupRecord {
  return {
    id: group.id,
    title: group.title ?? "",
    color: normalizeGroupColor(group.color),
    collapsed: Boolean(group.collapsed),
  };
}
