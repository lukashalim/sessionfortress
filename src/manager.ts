import { downloadJsonFile } from "./lib/download";
import { sendRequest, toastSkipped } from "./lib/messages";
import type { Bootstrap, RestoreMode, Session } from "./lib/types";
import { escapeHtml, importToast, MARK_SVG, renderPill, showToast } from "./lib/ui";
import { matchesQuery, relativeTime, sessionGroupCount, sessionTabCount } from "./lib/util";

const brand = document.getElementById("brand") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const recoveryEl = document.getElementById("recovery") as HTMLElement;
const reminderEl = document.getElementById("reminder") as HTMLElement;
const listEl = document.getElementById("list") as HTMLElement;
const searchEl = document.getElementById("search") as HTMLInputElement;
const importFile = document.getElementById("import-file") as HTMLInputElement;

brand.innerHTML = `${MARK_SVG}<div><h1>Session Fortress</h1><div class="sub">Named sessions saved in this browser</div></div>`;

let bootstrap: Bootstrap | null = null;
let query = "";

function sessions(): Session[] {
  return bootstrap?.sessions ?? [];
}

function paint(): void {
  if (!bootstrap) return;
  renderPill(statusEl, bootstrap);
  paintRecovery();
  paintReminder();
  paintList();
}

function paintRecovery(): void {
  if (!bootstrap) return;
  const rec = bootstrap.recovery;
  if (!rec.active || rec.dismissed || rec.reason !== "replica-restored") {
    recoveryEl.classList.add("hidden");
    return;
  }
  recoveryEl.classList.remove("hidden");
  recoveryEl.className = "banner warn";
  recoveryEl.innerHTML = `
    <div class="stack">
      <div>Restored ${rec.replicaRestoredCount} session${rec.replicaRestoredCount === 1 ? "" : "s"} from the local replica. Export JSON if you want a copy that survives a profile reset.</div>
      <div class="row">
        <button class="btn btn-primary" id="recovery-export" type="button">Export JSON</button>
        <button class="btn btn-ghost" id="dismiss-recovery" type="button">Dismiss</button>
      </div>
    </div>`;
  document.getElementById("recovery-export")?.addEventListener("click", () => void exportAll());
  document.getElementById("dismiss-recovery")?.addEventListener("click", () => void dismissRecovery());
}

function paintReminder(): void {
  if (!bootstrap) return;
  if (!bootstrap.exportReminderDue) {
    reminderEl.classList.add("hidden");
    reminderEl.replaceChildren();
    return;
  }
  reminderEl.className = "banner warn";
  reminderEl.classList.remove("hidden");
  reminderEl.innerHTML = `<div class="spread"><span>It’s been a week since the last export. Save a JSON copy to survive a reset or a new computer.</span><div class="row"><button class="btn btn-primary" id="remind-export" type="button">Export JSON</button><button class="btn" id="remind-dismiss" type="button">Later</button></div></div>`;
  document.getElementById("remind-export")?.addEventListener("click", () => void exportAll());
  document.getElementById("remind-dismiss")?.addEventListener("click", () => void dismissReminder());
}

function paintList(): void {
  const items = sessions().filter((s) => matchesQuery(s, query));
  if (items.length === 0) {
    listEl.innerHTML =
      sessions().length === 0
        ? `<div class="empty">No sessions yet. Save a window. Export JSON to survive a Chrome reset or a new computer.</div>`
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

async function exportAll(): Promise<void> {
  const response = await sendRequest({ type: "EXPORT_ALL" });
  if (!response.ok || !("json" in response)) {
    showToast(response.ok ? "Export failed." : response.error);
    return;
  }
  try {
    await downloadJsonFile(response.filename, response.json);
    const marked = await sendRequest({ type: "MARK_EXPORTED" });
    if (marked.ok && "bootstrap" in marked) await applyBootstrap(marked.bootstrap);
    showToast("Export started.");
  } catch (error) {
    if (error instanceof Error && /canceled|cancelled/i.test(error.message)) return;
    showToast(error instanceof Error ? error.message : "Export failed.");
  }
}

async function dismissReminder(): Promise<void> {
  const response = await sendRequest({ type: "DISMISS_EXPORT_REMINDER" });
  if (response.ok && "bootstrap" in response) await applyBootstrap(response.bootstrap);
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
      if (response.ok && "json" in response) {
        try {
          await downloadJsonFile(response.filename, response.json);
          const marked = await sendRequest({ type: "MARK_EXPORTED" });
          if (marked.ok && "bootstrap" in marked) await applyBootstrap(marked.bootstrap);
        } catch (error) {
          if (error instanceof Error && /canceled|cancelled/i.test(error.message)) return;
          showToast(error instanceof Error ? error.message : "Export failed.");
        }
      }
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
  const card = document.querySelector(`[data-id="${sessionId}"]`) as HTMLElement | null;
  if (!card) return;
  const nameEl = card.querySelector(".session-name") as HTMLElement | null;
  if (!nameEl) return;

  const current = sessions().find((s) => s.id === sessionId);
  const originalName = current?.name ?? "";

  const input = document.createElement("input");
  input.type = "text";
  input.value = originalName;
  input.className = "input rename-input";
  input.style.fontSize = "14px";
  input.style.fontWeight = "600";
  input.style.padding = "4px 8px";
  input.style.margin = "0";

  const finish = async (saveChange: boolean): Promise<void> => {
    const newName = input.value.trim();
    nameEl.textContent = originalName;
    nameEl.style.display = "";
    input.remove();

    if (saveChange && newName && newName !== originalName) {
      const response = await sendRequest({ type: "RENAME", sessionId, name: newName });
      if (response.ok && "bootstrap" in response) await applyBootstrap(response.bootstrap);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      void finish(false);
    }
  });

  input.addEventListener("blur", () => void finish(true));

  nameEl.style.display = "none";
  nameEl.after(input);
  input.focus();
  input.select();
}

async function removeSession(sessionId: string): Promise<void> {
  const current = sessions().find((s) => s.id === sessionId);
  const ok = window.confirm(`Delete “${current?.name ?? "this session"}”?`);
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
document.getElementById("open-options")?.addEventListener("click", () => void sendRequest({ type: "OPEN_OPTIONS" }));
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
  if ("bootstrap" in response) await applyBootstrap(response.bootstrap);
  if ("import" in response) showToast(importToast(response.import));
});

void (async () => {
  await sendRequest({ type: "HEALTH_CHECK" });
  await refresh();
})();
