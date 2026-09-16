import type { Bootstrap } from "./types";
import { relativeTime } from "./util";

export function statusLabel(bootstrap: Bootstrap): { text: string; kind: "ok" | "warn" | "bad" } {
  if (bootstrap.recovery.active && !bootstrap.recovery.dismissed) {
    return { text: "Recovery copy restored", kind: "warn" };
  }
  if (bootstrap.exportReminderDue) return { text: "Export recommended", kind: "warn" };
  if (bootstrap.meta.lastExportAt) {
    return { text: `Exported ${relativeTime(bootstrap.meta.lastExportAt)}`, kind: "ok" };
  }
  return { text: "In this browser · no export yet", kind: "ok" };
}

export function renderPill(el: HTMLElement, bootstrap: Bootstrap): void {
  const info = statusLabel(bootstrap);
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

export function importToast(summary: {
  added: number;
  skipped: number;
  renamed: number;
  warnings: string[];
  sourceFormat: string;
}): string {
  const parts = [
    `Imported ${summary.added} session${summary.added === 1 ? "" : "s"}`,
  ];
  if (summary.renamed) parts.push(`renamed ${summary.renamed}`);
  if (summary.skipped) parts.push(`skipped ${summary.skipped}`);
  const warn = summary.warnings[0] ? ` ${summary.warnings[0]}` : "";
  return `${parts.join(", ")} from ${summary.sourceFormat}.${warn}`;
}

export const MARK_SVG = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="12" fill="#2a3038" stroke="#b08d57" stroke-width="1.5"/><path d="M4 8V6h3v2h3V6h4v2h3V6h3v2" fill="#b08d57"/><rect x="11" y="13" width="2" height="7" fill="#b08d57"/></svg>`;
