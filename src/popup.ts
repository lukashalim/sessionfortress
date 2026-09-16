import { downloadJsonFile } from "./lib/download";
import { sendRequest, toastSkipped } from "./lib/messages";
import { importToast, MARK_SVG, renderPill, showToast } from "./lib/ui";
import type { Bootstrap } from "./lib/types";

const brand = document.getElementById("brand") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const banner = document.getElementById("banner") as HTMLElement;
const importFile = document.getElementById("import-file") as HTMLInputElement;

brand.innerHTML = `${MARK_SVG}<h1>Session Fortress</h1>`;

function paint(bootstrap: Bootstrap): void {
  renderPill(statusEl, bootstrap);
  if (bootstrap.recovery.active && !bootstrap.recovery.dismissed && bootstrap.recovery.reason === "replica-restored") {
    banner.className = "banner warn";
    banner.classList.remove("hidden");
    banner.textContent = `Restored ${bootstrap.recovery.replicaRestoredCount} session${bootstrap.recovery.replicaRestoredCount === 1 ? "" : "s"} from a recovery copy in this browser. Export JSON to keep a backup outside Chrome.`;
    return;
  }
  if (bootstrap.exportReminderDue) {
    banner.className = "banner warn";
    banner.classList.remove("hidden");
    banner.innerHTML = `<div class="stack"><span>It's been a week since your last export. Export JSON to keep a backup if Chrome resets or you move to another computer.</span><div class="row"><button class="btn btn-primary" id="remind-export" type="button">Export now</button><button class="btn btn-ghost" id="remind-dismiss" type="button">Later</button></div></div>`;
    document.getElementById("remind-export")?.addEventListener("click", () => void exportAll());
    document.getElementById("remind-dismiss")?.addEventListener("click", () => void dismissReminder());
    return;
  }
  banner.classList.add("hidden");
  banner.replaceChildren();
}

async function applyPaint(response: { ok: boolean; bootstrap?: Bootstrap; error?: string }): Promise<void> {
  if (response.ok && response.bootstrap) paint(response.bootstrap);
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

async function exportAll(): Promise<void> {
  const response = await sendRequest({ type: "EXPORT_ALL" });
  if (!response.ok || !("json" in response)) {
    showToast(response.ok ? "Export failed." : response.error);
    return;
  }
  try {
    await downloadJsonFile(response.filename, response.json);
    const marked = await sendRequest({ type: "MARK_EXPORTED" });
    if (marked.ok && "bootstrap" in marked) paint(marked.bootstrap);
    showToast("Export saved.");
  } catch (error) {
    if (error instanceof Error && /canceled|cancelled/i.test(error.message)) return;
    showToast(error instanceof Error ? error.message : "Export failed.");
  }
}

async function dismissReminder(): Promise<void> {
  const response = await sendRequest({ type: "DISMISS_EXPORT_REMINDER" });
  if (response.ok && "bootstrap" in response) paint(response.bootstrap);
}

async function importFromFile(file: File): Promise<void> {
  let json: string;
  try {
    json = await file.text();
  } catch {
    showToast("Could not read that file.");
    return;
  }
  const response = await sendRequest({ type: "IMPORT", json });
  if (!response.ok) {
    showToast(response.error);
    return;
  }
  if ("bootstrap" in response) paint(response.bootstrap);
  if ("import" in response) showToast(importToast(response.import));
}

document.getElementById("save-window")?.addEventListener("click", () => void act("SAVE_WINDOW"));
document.getElementById("save-all")?.addEventListener("click", () => void act("SAVE_ALL"));
document.getElementById("stash")?.addEventListener("click", () => void act("STASH"));
document.getElementById("export-all")?.addEventListener("click", () => void exportAll());
document.getElementById("import")?.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (file) void importFromFile(file);
});
document.getElementById("open-manager")?.addEventListener("click", () => {
  void sendRequest({ type: "OPEN_MANAGER" });
});

void (async () => {
  const response = await sendRequest({ type: "HEALTH_CHECK" });
  await applyPaint(response);
})();
