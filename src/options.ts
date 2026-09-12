import { clearDirectoryHandle } from "./lib/idb";
import { pickBackupFolder, requestFolderPermission } from "./lib/folder";
import { sendRequest } from "./lib/messages";
import { SUPPORT_EMAIL, type Bootstrap } from "./lib/types";
import { MARK_SVG, showToast, statusLabel } from "./lib/ui";
import { clampRetention } from "./lib/util";

const brand = document.getElementById("brand") as HTMLElement;
brand.innerHTML = `${MARK_SVG}<h1>Session Fortress settings</h1>`;

const folderStatus = document.getElementById("folder-status") as HTMLElement;
const retention = document.getElementById("retention") as HTMLInputElement;
const health = document.getElementById("health") as HTMLInputElement;
const incognito = document.getElementById("incognito") as HTMLInputElement;
const support = document.getElementById("support") as HTMLElement;
support.textContent = SUPPORT_EMAIL;

let bootstrap: Bootstrap | null = null;

function paint(): void {
  if (!bootstrap) return;
  const info = statusLabel(bootstrap.folderStatus, bootstrap);
  folderStatus.className = `banner ${info.kind === "ok" ? "" : info.kind}`.trim();
  const folder = bootstrap.meta.folderName ? `Folder: ${bootstrap.meta.folderName}. ` : "";
  folderStatus.textContent = `${folder}${info.text}`;
  retention.value = String(bootstrap.settings.retention);
  health.checked = bootstrap.settings.startupHealthCheck;
  incognito.checked = bootstrap.settings.includeIncognitoInBackup;
}

async function load(): Promise<void> {
  const response = await sendRequest({ type: "GET_BOOTSTRAP" });
  if (response.ok && "bootstrap" in response) {
    bootstrap = response.bootstrap;
    paint();
    await tryAutoRestorePermission();
  }
}

async function tryAutoRestorePermission(): Promise<void> {
  if (!bootstrap || bootstrap.folderStatus !== "permission-expired") return;
  try {
    const perm = await requestFolderPermission();
    if (perm === "granted") {
      const response = await sendRequest({ type: "WRITE_FOLDER_NOW" });
      if (response.ok && "bootstrap" in response) {
        bootstrap = response.bootstrap;
        paint();
      }
    }
  } catch {
    // User dismissed or error occurred; status will show permission-expired
  }
}

async function chooseFolder(): Promise<void> {
  try {
    const picked = await pickBackupFolder();
    const response = await sendRequest({ type: "FOLDER_PICKED", folderName: picked.folderName });
    if (response.ok && "bootstrap" in response) {
      bootstrap = response.bootstrap;
      paint();
    }
    showToast(`Backup folder set to ${picked.folderName}.`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    showToast(error instanceof Error ? error.message : "Folder picker failed.");
  }
}

document.getElementById("pick-folder")?.addEventListener("click", () => void chooseFolder());
document.getElementById("reallow")?.addEventListener("click", async () => {
  const perm = await requestFolderPermission();
  if (perm === "granted") {
    const response = await sendRequest({ type: "WRITE_FOLDER_NOW" });
    if (response.ok && "bootstrap" in response) {
      bootstrap = response.bootstrap;
      paint();
    }
    showToast("Folder access restored.");
    return;
  }
  showToast("Folder access was not granted.");
});
document.getElementById("clear-folder")?.addEventListener("click", async () => {
  if (!window.confirm("Stop writing to the backup folder? Existing files are left on disk.")) return;
  await clearDirectoryHandle();
  const response = await sendRequest({ type: "FOLDER_CLEARED" });
  if (response.ok && "bootstrap" in response) {
    bootstrap = response.bootstrap;
    paint();
  }
});
document.getElementById("reset")?.addEventListener("click", async () => {
  const response = await sendRequest({ type: "RESET_SETTINGS" });
  if (response.ok && "bootstrap" in response) {
    bootstrap = response.bootstrap;
    paint();
  }
});
document.getElementById("open-manager")?.addEventListener("click", () => {
  void (async () => {
    try {
      const url = chrome.runtime.getURL("manager.html");
      const existing = await chrome.tabs.query({ url, currentWindow: false });
      if (existing[0]?.id != null) {
        await chrome.tabs.update(existing[0].id, { active: true });
        if (existing[0].windowId != null) {
          await chrome.windows.update(existing[0].windowId, { focused: true });
        }
      } else {
        await chrome.tabs.create({ url, active: true });
      }
    } catch (error) {
      await chrome.tabs.create({ url: chrome.runtime.getURL("manager.html"), active: true });
    }
  })();
});
document.getElementById("shortcuts")?.addEventListener("click", (event) => {
  event.preventDefault();
  showToast("Open chrome://extensions/shortcuts in a tab — Chrome blocks that link from extensions.");
});

async function saveSettings(): Promise<void> {
  const response = await sendRequest({
    type: "SET_SETTINGS",
    settings: {
      retention: clampRetention(Number(retention.value)),
      startupHealthCheck: health.checked,
      includeIncognitoInBackup: incognito.checked,
    },
  });
  if (response.ok && "bootstrap" in response) {
    bootstrap = response.bootstrap;
    paint();
  }
}

retention.addEventListener("change", () => void saveSettings());
health.addEventListener("change", () => void saveSettings());
incognito.addEventListener("change", () => void saveSettings());

void load();
