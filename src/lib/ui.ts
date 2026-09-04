import type { Bootstrap, FolderStatus } from "./types";
import { relativeTime } from "./util";

export function statusLabel(status: FolderStatus, bootstrap: Bootstrap): { text: string; kind: "ok" | "warn" | "bad" } {
  if (status === "no-folder") return { text: "No off-profile backup", kind: "warn" };
  if (status === "permission-expired") return { text: "Permission expired", kind: "bad" };
  if (status === "failed") return { text: "Last backup failed", kind: "bad" };
  if (status === "ok" && bootstrap.meta.lastBackupAt) {
    return { text: `Backup OK · ${relativeTime(bootstrap.meta.lastBackupAt)}`, kind: "ok" };
  }
  if (status === "ok") return { text: "Backup folder ready", kind: "ok" };
  return { text: "Backup status unknown", kind: "warn" };
}

export function renderPill(el: HTMLElement, bootstrap: Bootstrap): void {
  const info = statusLabel(bootstrap.folderStatus, bootstrap);
  el.className = `pill ${info.kind}`;
  el.innerHTML = `<span class="dot"></span><span>${escapeHtml(info.text)}</span>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function showToast(message: string): void {
  let host = document.querySelector(".toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "toast-host";
    document.body.appendChild(host);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

export const MARK_SVG = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="12" fill="#2a3038" stroke="#b08d57" stroke-width="1.5"/><path d="M4 8V6h3v2h3V6h4v2h3V6h3v2" fill="#b08d57"/><rect x="11" y="13" width="2" height="7" fill="#b08d57"/></svg>`;
