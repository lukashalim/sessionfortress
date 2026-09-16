import { downloadJsonFile } from "./lib/download";
import { sendRequest } from "./lib/messages";
import { SUPPORT_EMAIL, type Bootstrap } from "./lib/types";
import { importToast, MARK_SVG, showToast, statusLabel } from "./lib/ui";

const brand = document.getElementById("brand") as HTMLElement;
brand.innerHTML = `${MARK_SVG}<h1>Session Fortress settings</h1>`;

const exportStatus = document.getElementById("export-status") as HTMLElement;
const health = document.getElementById("health") as HTMLInputElement;
const incognito = document.getElementById("incognito") as HTMLInputElement;
const remind = document.getElementById("remind") as HTMLInputElement;
const importFile = document.getElementById("import-file") as HTMLInputElement;
const support = document.getElementById("support") as HTMLElement;
support.textContent = SUPPORT_EMAIL;

let bootstrap: Bootstrap | null = null;

function paint(): void {
  if (!bootstrap) return;
  const info = statusLabel(bootstrap);
  exportStatus.className = `banner ${info.kind === "ok" ? "" : info.kind}`.trim();
  exportStatus.textContent = `${info.text}. Sessions stay in this Chrome profile until you export JSON.`;
  health.checked = bootstrap.settings.startupHealthCheck;
  incognito.checked = bootstrap.settings.includeIncognitoInBackup;
  remind.checked = bootstrap.settings.remindExportWeekly;
}

async function load(): Promise<void> {
  const response = await sendRequest({ type: "GET_BOOTSTRAP" });
  if (response.ok && "bootstrap" in response) {
    bootstrap = response.bootstrap;
    paint();
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
    if (marked.ok && "bootstrap" in marked) {
      bootstrap = marked.bootstrap;
      paint();
    }
    showToast("Export started.");
  } catch (error) {
    if (error instanceof Error && /canceled|cancelled/i.test(error.message)) return;
    showToast(error instanceof Error ? error.message : "Export failed.");
  }
}

document.getElementById("export-all")?.addEventListener("click", () => void exportAll());
document.getElementById("import")?.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
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
  if ("bootstrap" in response) {
    bootstrap = response.bootstrap;
    paint();
  }
  if ("import" in response) showToast(importToast(response.import));
});
document.getElementById("reset")?.addEventListener("click", async () => {
  const response = await sendRequest({ type: "RESET_SETTINGS" });
  if (response.ok && "bootstrap" in response) {
    bootstrap = response.bootstrap;
    paint();
  }
});
document.getElementById("open-manager")?.addEventListener("click", () => {
  void sendRequest({ type: "OPEN_MANAGER" });
});
document.getElementById("shortcuts")?.addEventListener("click", (event) => {
  event.preventDefault();
  showToast("Open chrome://extensions/shortcuts in a tab — Chrome blocks that link from extensions.");
});

async function saveSettings(): Promise<void> {
  const response = await sendRequest({
    type: "SET_SETTINGS",
    settings: {
      startupHealthCheck: health.checked,
      includeIncognitoInBackup: incognito.checked,
      remindExportWeekly: remind.checked,
    },
  });
  if (response.ok && "bootstrap" in response) {
    bootstrap = response.bootstrap;
    paint();
  }
}

health.addEventListener("change", () => void saveSettings());
incognito.addEventListener("change", () => void saveSettings());
remind.addEventListener("change", () => void saveSettings());

void load();
