import { downloadJson, pickBackupFolder, readLatestVault, requestFolderPermission } from "./lib/folder";
import { sendRequest, toastSkipped } from "./lib/messages";
import type { Bootstrap, RestoreMode, Session } from "./lib/types";
import { escapeHtml, MARK_SVG, renderPill, showToast } from "./lib/ui";
import { matchesQuery, relativeTime, sessionGroupCount, sessionTabCount } from "./lib/util";

const brand = document.getElementById("brand") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const recoveryEl = document.getElementById("recovery") as HTMLElement;
const folderBanner = document.getElementById("folder-banner") as HTMLElement;
const listEl = document.getElementById("list") as HTMLElement;
const searchEl = document.getElementById("search") as HTMLInputElement;
const importFile = document.getElementById("import-file") as HTMLInputElement;

brand.innerHTML = `${MARK_SVG}<div><h1>Session Fortress</h1><div class="sub">Named sessions that survive a Chrome wipe</div></div>`;

let bootstrap: Bootstrap | null = null;
let query = "";

function sessions(): Session[] {
  return bootstrap?.sessions ?? [];
}

function paint(): void {
  if (!bootstrap) return;
  renderPill(statusEl, bootstrap);
  paintRecovery();
  paintFolderBanner();
  paintList();
}

function paintRecovery(): void {
  if (!bootstrap) return;
  const rec = bootstrap.recovery;
  if (!rec.active || rec.dismissed) {
    recoveryEl.classList.add("hidden");
    return;
  }
  recoveryEl.classList.remove("hidden");
  const when = rec.folderExportedAt ? relativeTime(rec.folderExportedAt) : "earlier";
  const lead =
    rec.reason === "replica-restored"
      ? `Restored ${rec.replicaRestoredCount} session${rec.replicaRestoredCount === 1 ? "" : "s"} from the local replica. A folder copy from ${when} is also available.`
      : `Local data looks empty or damaged. A backup folder copy from ${when} is available.`;
  recoveryEl.innerHTML = `
    <div class="stack">
      <div>${escapeHtml(lead)}</div>
      <div class="row">
        <button class="btn btn-primary" id="restore-folder" type="button">Restore from folder</button>
        <button class="btn" id="download-folder" type="button">Download that file</button>
        <button class="btn btn-ghost" id="dismiss-recovery" type="button">Dismiss</button>
      </div>
    </div>`;
  document.getElementById("restore-folder")?.addEventListener("click", () => void restoreFromFolder());
  document.getElementById("download-folder")?.addEventListener("click", () => void downloadLatest());
  document.getElementById("dismiss-recovery")?.addEventListener("click", () => void dismissRecovery());
}

function paintFolderBanner(): void {
  if (!bootstrap) return;
  if (bootstrap.folderStatus === "permission-expired") {
    folderBanner.className = "banner bad";
    folderBanner.classList.remove("hidden");
    folderBanner.innerHTML = `<div class="spread"><span>Click to re-allow folder access. Backups are paused until you do.</span><button class="btn btn-primary" id="reallow" type="button">Re-allow folder</button></div>`;
    document.getElementById("reallow")?.addEventListener("click", () => void reallowFolder());
    return;
  }
  if (bootstrap.folderStatus === "no-folder") {
    folderBanner.className = "banner warn";
    folderBanner.classList.remove("hidden");
    folderBanner.innerHTML = `<div class="spread"><span>Pick a backup folder (recommended). Dropbox / Drive / iCloud / Documents all work if that folder is on disk.</span><button class="btn btn-primary" id="pick-now" type="button">Pick folder</button></div>`;
    document.getElementById("pick-now")?.addEventListener("click", () => void chooseFolder());
    return;
  }
  if (bootstrap.folderStatus === "failed" && bootstrap.meta.lastBackupError) {
    folderBanner.className = "banner bad";
    folderBanner.classList.remove("hidden");
    folderBanner.innerHTML = `<div class="spread"><span>${escapeHtml(bootstrap.meta.lastBackupError)}</span><button class="btn" id="retry-write" type="button">Retry backup</button></div>`;
    document.getElementById("retry-write")?.addEventListener("click", () => void retryWrite());
    return;
  }
  folderBanner.classList.add("hidden");
}

function paintList(): void {
  const items = sessions().filter((s) => matchesQuery(s, query));
  if (items.length === 0) {
    listEl.innerHTML =
      sessions().length === 0
        ? `<div class="empty">No sessions yet. Save a window, or pick a backup folder first so a crash can’t wipe you.</div>`
        : `<div class="empty">No sessions match that search.</div>`;
    return;
  }
  listEl.innerHTML = items
    .map((session) => {
      const tabs = sessionTabCount(session);
      const groups = sessionGroupCount(session);
      const chips = session.windows
        .flatMap((w) => w.groups)
        .slice(0, 12)
        .map((g) => `<span class="chip ${escapeHtml(g.color)}">${escapeHtml(g.title || "Untitled")}</span>`)
        .join("");
      return `<article class="session" data-id="${escapeHtml(session.id)}">
        <div class="session-head">
          <div>
            <div class="session-name">${escapeHtml(session.name)}</div>
            <div class="meta-line">${escapeHtml(relativeTime(session.updatedAt))} · ${session.windows.length} window${session.windows.length === 1 ? "" : "s"} · ${tabs} tab${tabs === 1 ? "" : "s"} · ${groups} group${groups === 1 ? "" : "s"} · ${escapeHtml(session.source)}</div>
            <div class="groups">${chips}</div>
          </div>
          <div class="actions">
            <select class="select restore-mode" data-act="mode" aria-label="Restore mode">
              <option value="new">New window(s)</option>
              <option value="replace">Replace this window</option>
              <option value="add">Add to this window</option>
            </select>
            <button class="btn btn-primary" data-act="restore" type="button">Restore</button>
            <button class="btn" data-act="rename" type="button">Rename</button>
            <button class="btn" data-act="duplicate" type="button">Duplicate</button>
            <button class="btn" data-act="export" type="button">Export</button>
            <button class="btn btn-danger" data-act="delete" type="button">Delete</button>
          </div>
        </div>
      </article>`;
    })
    .join("");
}

async function refresh(): Promise<void> {
  const response = await sendRequest({ type: "GET_BOOTSTRAP" });
  if (response.ok && "bootstrap" in response) {
    bootstrap = response.bootstrap;
    paint();
  }
}

async function applyBootstrap(next: Bootstrap): Promise<void> {
  bootstrap = next;
  paint();
}

async function chooseFolder(): Promise<void> {
  try {
    const picked = await pickBackupFolder();
    const response = await sendRequest({ type: "FOLDER_PICKED", folderName: picked.folderName });
    if (response.ok && "bootstrap" in response) await applyBootstrap(response.bootstrap);
    showToast(`Backup folder set to ${picked.folderName}.`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    showToast(error instanceof Error ? error.message : "Folder picker failed.");
  }
}

async function reallowFolder(): Promise<void> {
  const perm = await requestFolderPermission();
  if (perm === "granted") {
    const response = await sendRequest({ type: "WRITE_FOLDER_NOW" });
    if (response.ok && "bootstrap" in response) await applyBootstrap(response.bootstrap);
    showToast("Folder access restored. Backup written.");
    return;
  }
  if (perm === "missing") {
    await chooseFolder();
    return;
  }
  showToast("Folder access was not granted.");
}

async function retryWrite(): Promise<void> {
  const response = await sendRequest({ type: "WRITE_FOLDER_NOW" });
  if (response.ok && "bootstrap" in response) await applyBootstrap(response.bootstrap);
}

async function restoreFromFolder(): Promise<void> {
  const perm = await requestFolderPermission();
  if (perm !== "granted") {
    showToast("Re-allow folder access first.");
    return;
  }
  const latest = await readLatestVault();
  if (!latest.vault) {
    showToast(latest.error || "No backup file found.");
    return;
  }
  const response = await sendRequest({ type: "RESTORE_FROM_FOLDER", vault: latest.vault });
  if (!response.ok) {
    showToast(response.error);
    return;
  }
  if ("bootstrap" in response) await applyBootstrap(response.bootstrap);
  showToast("Sessions restored from the backup folder.");
}

async function downloadLatest(): Promise<void> {
  const perm = await requestFolderPermission();
  if (perm !== "granted") {
    showToast("Re-allow folder access first.");
    return;
  }
  const latest = await readLatestVault();
  if (!latest.vault) {
    showToast(latest.error || "No backup file found.");
    return;
  }
  downloadJson("session-fortress-latest.json", `${JSON.stringify(latest.vault, null, 2)}\n`);
}

async function dismissRecovery(): Promise<void> {
  const response = await sendRequest({ type: "DISMISS_RECOVERY" });
  if (response.ok && "bootstrap" in response) await applyBootstrap(response.bootstrap);
}

async function save(type: "SAVE_WINDOW" | "SAVE_ALL"): Promise<void> {
  const response = await sendRequest({ type });
  if (!response.ok) {
    showToast(response.error);
    return;
  }
  if ("bootstrap" in response) await applyBootstrap(response.bootstrap);
  if ("capture" in response) showToast(toastSkipped(response.capture.savedTabs, response.capture.skippedSystem));
}

listEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button[data-act]") as HTMLButtonElement | null;
  if (!button) return;
  const card = button.closest("[data-id]") as HTMLElement | null;
  if (!card) return;
  const id = card.dataset.id;
  if (!id) return;
  const act = button.dataset.act;
  void (async () => {
    if (act === "restore") {
      const mode = (card.querySelector(".restore-mode") as HTMLSelectElement).value as RestoreMode;
      await restore(id, mode, false);
    }
    if (act === "rename") await rename(id);
    if (act === "duplicate") {
      const response = await sendRequest({ type: "DUPLICATE", sessionId: id });
      if (response.ok && "bootstrap" in response) await applyBootstrap(response.bootstrap);
    }
    if (act === "export") {
      const response = await sendRequest({ type: "EXPORT_ONE", sessionId: id });
      if (response.ok && "json" in response) downloadJson(response.filename, response.json);
    }
    if (act === "delete") await removeSession(id);
  })();
});

async function restore(sessionId: string, mode: RestoreMode, duplicateConfirmed: boolean): Promise<void> {
  const response = await sendRequest({ type: "RESTORE", sessionId, mode, duplicateConfirmed });
  if (!response.ok) {
    showToast(response.error);
    return;
  }
  if ("needsDuplicateConfirm" in response && response.needsDuplicateConfirm) {
    const again = window.confirm("This window already looks like that session. Add the groups and tabs again?");
    if (again) await restore(sessionId, mode, true);
    return;
  }
  if ("restore" in response) {
    const r = response.restore;
    const extra = r.skippedIncognitoWindows
      ? ` Skipped ${r.skippedIncognitoWindows} incognito window${r.skippedIncognitoWindows === 1 ? "" : "s"}.`
      : "";
    showToast(`Restored ${r.tabsCreated} tabs in ${r.windowsCreated} window${r.windowsCreated === 1 ? "" : "s"}.${extra}`);
  }
}

async function rename(sessionId: string): Promise<void> {
  const current = sessions().find((s) => s.id === sessionId);
  const name = window.prompt("Rename session", current?.name ?? "");
  if (name == null) return;
  const response = await sendRequest({ type: "RENAME", sessionId, name });
  if (response.ok && "bootstrap" in response) await applyBootstrap(response.bootstrap);
}

async function removeSession(sessionId: string): Promise<void> {
  const current = sessions().find((s) => s.id === sessionId);
  const last = sessions().length === 1;
  const ok = window.confirm(
    last
      ? `Delete “${current?.name ?? "this session"}”? This is the last session. Confirming allows one attempt to empty the folder mirror. If that write fails, the on-disk copy is left alone.`
      : `Delete “${current?.name ?? "this session"}”?`,
  );
  if (!ok) return;
  const response = await sendRequest({ type: "DELETE", sessionId });
  if (response.ok && "bootstrap" in response) await applyBootstrap(response.bootstrap);
}

searchEl.addEventListener("input", () => {
  query = searchEl.value;
  paintList();
});

document.getElementById("save-window")?.addEventListener("click", () => void save("SAVE_WINDOW"));
document.getElementById("save-all")?.addEventListener("click", () => void save("SAVE_ALL"));
document.getElementById("pick-folder")?.addEventListener("click", () => void chooseFolder());
document.getElementById("open-options")?.addEventListener("click", () => void sendRequest({ type: "OPEN_OPTIONS" }));
document.getElementById("export-all")?.addEventListener("click", async () => {
  const response = await sendRequest({ type: "EXPORT_ALL" });
  if (response.ok && "json" in response) downloadJson(response.filename, response.json);
});
document.getElementById("import")?.addEventListener("click", () => importFile.click());
importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  importFile.value = "";
  if (!file) return;
  const json = await file.text();
  const replace = window.confirm("Replace all sessions with this file?\n\nOK = replace\nCancel = merge (skip duplicate ids)");
  const response = await sendRequest({ type: "IMPORT", json, strategy: replace ? "replace" : "merge" });
  if (!response.ok) {
    showToast(response.error);
    return;
  }
  if ("bootstrap" in response) await applyBootstrap(response.bootstrap);
  if ("import" in response) {
    const summary = response.import;
    const warn = summary.warnings[0] ? ` ${summary.warnings[0]}` : "";
    showToast(`Imported ${summary.added} session${summary.added === 1 ? "" : "s"} from ${summary.sourceFormat}. Skipped ${summary.skippedDuplicateIds} duplicate ids.${warn}`);
  }
});

void (async () => {
  await sendRequest({ type: "HEALTH_CHECK" });
  await refresh();
})();
