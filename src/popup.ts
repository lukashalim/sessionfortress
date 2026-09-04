import { sendRequest, toastSkipped } from "./lib/messages";
import { MARK_SVG, renderPill, showToast } from "./lib/ui";
import type { Bootstrap } from "./lib/types";
import { relativeTime } from "./lib/util";

const brand = document.getElementById("brand") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const banner = document.getElementById("banner") as HTMLElement;

brand.innerHTML = `${MARK_SVG}<h1>Session Fortress</h1>`;

function paint(bootstrap: Bootstrap): void {
  renderPill(statusEl, bootstrap);
  if (bootstrap.folderStatus === "permission-expired") {
    banner.className = "banner bad";
    banner.classList.remove("hidden");
    banner.textContent = "Click to re-allow folder access in the manager.";
  } else if (bootstrap.folderStatus === "no-folder") {
    banner.className = "banner warn";
    banner.classList.remove("hidden");
    banner.textContent = "No off-profile backup. Pick a folder in the manager.";
  } else if (bootstrap.folderStatus === "failed") {
    banner.className = "banner bad";
    banner.classList.remove("hidden");
    const detail = bootstrap.meta.lastBackupError || "Last backup failed.";
    banner.textContent = `${detail} Open manager to retry.`;
  } else if (bootstrap.recovery.active && bootstrap.recovery.reason === "empty-or-corrupt") {
    banner.className = "banner bad";
    banner.classList.remove("hidden");
    const when = bootstrap.recovery.folderExportedAt
      ? relativeTime(bootstrap.recovery.folderExportedAt)
      : "earlier";
    banner.textContent = `Local data looks empty or damaged. A backup folder copy from ${when} is available.`;
  } else {
    banner.classList.add("hidden");
  }
}

async function act(type: "SAVE_WINDOW" | "SAVE_ALL" | "STASH"): Promise<void> {
  const response = await sendRequest({ type });
  if (!response.ok) {
    showToast(response.error);
    return;
  }
  if ("capture" in response) {
    paint(response.bootstrap);
    showToast(toastSkipped(response.capture.savedTabs, response.capture.skippedSystem));
  }
}

document.getElementById("save-window")?.addEventListener("click", () => void act("SAVE_WINDOW"));
document.getElementById("save-all")?.addEventListener("click", () => void act("SAVE_ALL"));
document.getElementById("stash")?.addEventListener("click", () => void act("STASH"));
document.getElementById("open-manager")?.addEventListener("click", () => {
  void sendRequest({ type: "OPEN_MANAGER" });
});

void (async () => {
  const response = await sendRequest({ type: "GET_BOOTSTRAP" });
  if (response.ok && "bootstrap" in response) paint(response.bootstrap);
})();
