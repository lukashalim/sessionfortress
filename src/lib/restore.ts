import {
  LARGE_SESSION_TAB_THRESHOLD,
  RESTORE_BATCH_SIZE,
  RESTORE_BATCH_YIELD_MS,
  type RestoreMode,
  type RestoreResult,
  type Session,
  type TabRecord,
  type WindowRecord,
} from "./types";

export function isProtectedUiUrl(url: string | undefined, extensionBaseUrl: string): boolean {
  if (!url) return false;
  const manager = `${extensionBaseUrl}manager.html`;
  const options = `${extensionBaseUrl}options.html`;
  return (
    url === manager ||
    url.startsWith(`${manager}?`) ||
    url === options ||
    url.startsWith(`${options}?`)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTab(
  windowId: number,
  tab: TabRecord,
  active: boolean,
): Promise<chrome.tabs.Tab> {
  const created = await chrome.tabs.create({
    windowId,
    url: tab.url,
    pinned: tab.pinned,
    active,
    index: tab.index,
  });
  return created;
}

async function recreateGroups(
  windowId: number,
  record: WindowRecord,
  created: { record: TabRecord; tab: chrome.tabs.Tab }[],
): Promise<number> {
  let groupsCreated = 0;
  for (const group of record.groups) {
    const tabIds = created
      .filter((row) => row.record.groupId === group.id && row.tab.id != null)
      .map((row) => row.tab.id as number);
    if (tabIds.length === 0) continue;
    try {
      const chromeGroupId = await chrome.tabs.group({
        tabIds,
        createProperties: { windowId },
      });
      await chrome.tabGroups.update(chromeGroupId, {
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
      });
      groupsCreated += 1;
    } catch {
      // Continue remaining groups.
    }
  }
  return groupsCreated;
}

async function reapplyPinsAndOrder(
  created: { record: TabRecord; tab: chrome.tabs.Tab }[],
): Promise<void> {
  const sorted = created
    .filter((row) => row.tab.id != null)
    .slice()
    .sort((a, b) => a.record.index - b.record.index);

  for (const row of sorted) {
    const id = row.tab.id as number;
    try {
      await chrome.tabs.move(id, { index: row.record.index });
    } catch {
      // Ignore shuffle failures.
    }
    if (row.record.pinned) {
      try {
        await chrome.tabs.update(id, { pinned: true });
      } catch {
        // Ignore.
      }
    }
  }
}

async function discardHeavy(created: { tab: chrome.tabs.Tab }[]): Promise<void> {
  if (created.length < LARGE_SESSION_TAB_THRESHOLD) return;
  for (const row of created.slice(1)) {
    if (row.tab.id == null) continue;
    try {
      await chrome.tabs.discard(row.tab.id);
    } catch {
      // Discard is best-effort.
    }
  }
}

async function restoreTabsIntoWindow(
  windowId: number,
  record: WindowRecord,
  replaceExistingIds: number[] | null,
): Promise<{ tabsCreated: number; groupsCreated: number }> {
  const tabs = record.tabs.slice().sort((a, b) => a.index - b.index);
  if (tabs.length === 0) {
    return { tabsCreated: 0, groupsCreated: 0 };
  }

  const created: { record: TabRecord; tab: chrome.tabs.Tab }[] = [];

  for (let i = 0; i < tabs.length; i += 1) {
    const tab = tabs[i];
    const made = await createTab(windowId, tab, i === 0 && replaceExistingIds == null);
    created.push({ record: tab, tab: made });
    if ((i + 1) % RESTORE_BATCH_SIZE === 0) {
      await delay(RESTORE_BATCH_YIELD_MS);
    }
  }

  const groupsCreated = await recreateGroups(windowId, record, created);
  await reapplyPinsAndOrder(created);
  await discardHeavy(created);

  if (replaceExistingIds && replaceExistingIds.length > 0) {
    const createdIds = new Set(created.map((r) => r.tab.id));
    const toClose = replaceExistingIds.filter((id) => !createdIds.has(id));
    if (toClose.length > 0) {
      try {
        await chrome.tabs.remove(toClose);
      } catch {
        // Some tabs may already be gone.
      }
    }
  }

  return { tabsCreated: created.length, groupsCreated };
}

export function windowCreateExtras(record: WindowRecord): chrome.windows.CreateData {
  const extras: chrome.windows.CreateData = { focused: Boolean(record.focused), type: "normal" };
  const applyBounds = record.state !== "maximized" && record.state !== "fullscreen" && record.state !== "locked-fullscreen";
  if (applyBounds) {
    if (typeof record.left === "number") extras.left = record.left;
    if (typeof record.top === "number") extras.top = record.top;
    if (typeof record.width === "number") extras.width = record.width;
    if (typeof record.height === "number") extras.height = record.height;
  }
  return extras;
}

export function windowStateAfterCreate(
  state: WindowRecord["state"],
): "maximized" | "fullscreen" | null {
  if (state === "maximized" || state === "fullscreen") return state;
  if (state === "locked-fullscreen") return "fullscreen";
  return null;
}

async function applyRecordedWindowState(windowId: number, record: WindowRecord): Promise<void> {
  const state = windowStateAfterCreate(record.state);
  if (!state) return;
  try {
    await chrome.windows.update(windowId, { state });
  } catch {
    // Linux and some builds reject state; keep the restored window.
  }
}

async function restoreWindowNew(record: WindowRecord): Promise<{
  tabsCreated: number;
  groupsCreated: number;
}> {
  const tabs = record.tabs.slice().sort((a, b) => a.index - b.index);
  if (tabs.length === 0) return { tabsCreated: 0, groupsCreated: 0 };

  const first = tabs[0];
  const createdWin = await chrome.windows.create({
    ...windowCreateExtras(record),
    url: first.url,
  });
  const windowId = createdWin.id;
  if (windowId == null) return { tabsCreated: 0, groupsCreated: 0 };
  await applyRecordedWindowState(windowId, record);

  const seedTab = createdWin.tabs?.[0];
  if (seedTab?.id != null) {
    if (first.pinned) {
      try {
        await chrome.tabs.update(seedTab.id, { pinned: true });
      } catch {
        // Ignore.
      }
    }
  }

  const rest = tabs.slice(1);
  const created: { record: TabRecord; tab: chrome.tabs.Tab }[] = [];
  if (seedTab) created.push({ record: first, tab: seedTab });

  for (let i = 0; i < rest.length; i += 1) {
    const tab = rest[i];
    const made = await createTab(windowId, tab, false);
    created.push({ record: tab, tab: made });
    if ((i + 1) % RESTORE_BATCH_SIZE === 0) {
      await delay(RESTORE_BATCH_YIELD_MS);
    }
  }

  const groupsCreated = await recreateGroups(windowId, record, created);
  await reapplyPinsAndOrder(created);
  await discardHeavy(created);
  return { tabsCreated: created.length, groupsCreated };
}

function restorableWindows(session: Session): { keep: WindowRecord[]; skippedIncognito: number } {
  const keep: WindowRecord[] = [];
  let skippedIncognito = 0;
  for (const win of session.windows) {
    if (win.incognito) {
      skippedIncognito += 1;
      continue;
    }
    if (win.tabs.length === 0) continue;
    keep.push(win);
  }
  return { keep, skippedIncognito };
}

export async function restoreSession(
  session: Session,
  mode: RestoreMode,
  currentWindowId: number | undefined,
  duplicateConfirmed: boolean,
): Promise<RestoreResult> {
  const { keep, skippedIncognito } = restorableWindows(session);
  const empty: RestoreResult = {
    windowsCreated: 0,
    tabsCreated: 0,
    groupsCreated: 0,
    skippedIncognitoWindows: skippedIncognito,
    askedDuplicate: false,
    cancelled: false,
  };

  if (keep.length === 0) return empty;

  if ((mode === "add" || mode === "replace") && currentWindowId != null && !duplicateConfirmed) {
    const already = await windowLooksLikeSession(currentWindowId, session);
    if (already) {
      return { ...empty, askedDuplicate: true };
    }
  }

  if (mode === "new" || currentWindowId == null) {
    let tabsCreated = 0;
    let groupsCreated = 0;
    let windowsCreated = 0;
    for (const win of keep) {
      const result = await restoreWindowNew(win);
      tabsCreated += result.tabsCreated;
      groupsCreated += result.groupsCreated;
      windowsCreated += 1;
    }
    return {
      windowsCreated,
      tabsCreated,
      groupsCreated,
      skippedIncognitoWindows: skippedIncognito,
      askedDuplicate: false,
      cancelled: false,
    };
  }

  const existingTabs = await chrome.tabs.query({ windowId: currentWindowId });
  const extensionBase = chrome.runtime.getURL("");
  const existingIds = existingTabs
    .filter((t) => t.id != null && !isProtectedUiUrl(t.url, extensionBase))
    .map((t) => t.id as number);

  let tabsCreated = 0;
  let groupsCreated = 0;

  const [first, ...rest] = keep;
  const firstResult = await restoreTabsIntoWindow(
    currentWindowId,
    first,
    mode === "replace" ? existingIds : null,
  );
  tabsCreated += firstResult.tabsCreated;
  groupsCreated += firstResult.groupsCreated;

  for (const win of rest) {
    const extra = await restoreWindowNew(win);
    tabsCreated += extra.tabsCreated;
    groupsCreated += extra.groupsCreated;
  }

  return {
    windowsCreated: 1 + rest.length,
    tabsCreated,
    groupsCreated,
    skippedIncognitoWindows: skippedIncognito,
    askedDuplicate: false,
    cancelled: false,
  };
}

async function windowLooksLikeSession(windowId: number, session: Session): Promise<boolean> {
  const tabs = await chrome.tabs.query({ windowId });
  const urls = new Set(tabs.map((t) => t.url).filter(Boolean) as string[]);
  const sessionUrls = session.windows.flatMap((w) => w.tabs.map((t) => t.url));
  if (sessionUrls.length === 0) return false;
  const overlap = sessionUrls.filter((u) => urls.has(u)).length;
  return overlap >= Math.min(sessionUrls.length, Math.max(3, Math.floor(sessionUrls.length * 0.7)));
}
