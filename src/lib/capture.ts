import {
  type CaptureResult,
  type GroupRecord,
  type Session,
  type SessionSource,
  type TabRecord,
  type WindowRecord,
} from "./types";
import { defaultSessionName, normalizeGroupColor, shouldCaptureUrl } from "./util";

// Incognito windows are captured into the hot store. Folder mirror and JSON
// export omit them unless Settings includes incognito. Save toasts therefore
// only report savedTabs + skippedSystem — not a fake skippedIncognito count.

const NONE = chrome.tabGroups.TAB_GROUP_ID_NONE;

async function captureWindow(win: chrome.windows.Window): Promise<{
  record: WindowRecord | null;
  savedTabs: number;
  skippedSystem: number;
}> {
  if (win.type && win.type !== "normal") {
    return { record: null, savedTabs: 0, skippedSystem: 0 };
  }
  const tabs = (win.tabs ?? []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const chromeGroupIds = new Set<number>();
  let skippedSystem = 0;
  const kept: chrome.tabs.Tab[] = [];

  for (const tab of tabs) {
    if (!shouldCaptureUrl(tab.url)) {
      skippedSystem += 1;
      continue;
    }
    kept.push(tab);
    if (tab.groupId != null && tab.groupId !== NONE) {
      chromeGroupIds.add(tab.groupId);
    }
  }

  if (kept.length === 0) {
    return { record: null, savedTabs: 0, skippedSystem };
  }

  const groupMap = new Map<number, GroupRecord>();
  for (const chromeGroupId of chromeGroupIds) {
    try {
      const g = await chrome.tabGroups.get(chromeGroupId);
      groupMap.set(chromeGroupId, {
        id: crypto.randomUUID(),
        title: g.title ?? "",
        color: normalizeGroupColor(g.color),
        collapsed: Boolean(g.collapsed),
      });
    } catch {
      // Group vanished while capturing.
    }
  }

  const tabRecords: TabRecord[] = kept.map((tab, index) => {
    const group =
      tab.groupId != null && tab.groupId !== NONE ? groupMap.get(tab.groupId) : undefined;
    return {
      url: tab.url ?? "",
      title: tab.title ?? tab.url ?? "",
      pinned: Boolean(tab.pinned),
      index,
      groupId: group?.id ?? null,
      discarded: tab.discarded,
    };
  });

  const usedGroupIds = new Set(tabRecords.map((t) => t.groupId).filter(Boolean));
  const groups = [...groupMap.values()].filter((g) => usedGroupIds.has(g.id));

  const record: WindowRecord = {
    id: crypto.randomUUID(),
    focused: Boolean(win.focused),
    incognito: Boolean(win.incognito),
    left: win.left,
    top: win.top,
    width: win.width,
    height: win.height,
    state: win.state,
    groups,
    tabs: tabRecords,
  };

  return { record, savedTabs: tabRecords.length, skippedSystem };
}

export async function captureWindows(
  windowIds: number[] | "all" | "current",
  source: SessionSource,
): Promise<CaptureResult> {
  let windows: chrome.windows.Window[] = [];
  if (windowIds === "all") {
    windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  } else if (windowIds === "current") {
    const current = await chrome.windows.getCurrent({ populate: true });
    windows = [current];
  } else {
    windows = await Promise.all(
      windowIds.map((id) => chrome.windows.get(id, { populate: true })),
    );
  }

  const records: WindowRecord[] = [];
  let savedTabs = 0;
  let skippedSystem = 0;

  for (const win of windows) {
    const captured = await captureWindow(win);
    skippedSystem += captured.skippedSystem;
    if (!captured.record) continue;
    records.push(captured.record);
    savedTabs += captured.savedTabs;
  }

  const now = Date.now();
  const session: Session = {
    id: crypto.randomUUID(),
    name: defaultSessionName(records, source, new Date(now)),
    createdAt: now,
    updatedAt: now,
    source,
    windows: records,
  };

  return { session, savedTabs, skippedSystem };
}

export async function closeWindowAfterStash(windowId: number): Promise<void> {
  const all = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const others = all.filter((w) => w.id !== windowId);
  if (others.length === 0) {
    await chrome.windows.create({
      url: chrome.runtime.getURL("manager.html"),
      focused: true,
    });
  }
  try {
    await chrome.windows.remove(windowId);
  } catch {
    // Window already gone.
  }
}
