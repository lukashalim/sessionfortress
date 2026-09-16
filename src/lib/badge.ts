import type { RecoveryState } from "./types";

export async function applyBadge(recovery: RecoveryState): Promise<void> {
  const text = recovery.active && !recovery.dismissed ? "!" : "";
  await chrome.action.setBadgeText({ text });
  if (text) {
    await chrome.action.setBadgeBackgroundColor({ color: "#c4a35a" });
  }
}
