import type {
  Bootstrap,
  CaptureResult,
  ImportSummary,
  RestoreMode,
  RestoreResult,
  Settings,
} from "./types";

export type ClientRequest =
  | { type: "GET_BOOTSTRAP" }
  | { type: "SAVE_WINDOW" }
  | { type: "SAVE_ALL" }
  | { type: "STASH" }
  | { type: "RENAME"; sessionId: string; name: string }
  | { type: "DUPLICATE"; sessionId: string }
  | { type: "DELETE"; sessionId: string }
  | { type: "RESTORE"; sessionId: string; mode: RestoreMode; duplicateConfirmed?: boolean }
  | { type: "EXPORT_ALL" }
  | { type: "EXPORT_ONE"; sessionId: string }
  | { type: "IMPORT"; json: string }
  | { type: "MARK_EXPORTED" }
  | { type: "DISMISS_EXPORT_REMINDER" }
  | { type: "DISMISS_RECOVERY" }
  | { type: "SET_SETTINGS"; settings: Partial<Settings> }
  | { type: "RESET_SETTINGS" }
  | { type: "OPEN_MANAGER" }
  | { type: "OPEN_OPTIONS" }
  | { type: "HEALTH_CHECK" };

export type ClientResponse =
  | { ok: true; bootstrap: Bootstrap }
  | { ok: true; capture: CaptureResult; bootstrap: Bootstrap }
  | { ok: true; restore: RestoreResult; bootstrap: Bootstrap; needsDuplicateConfirm?: boolean }
  | { ok: true; json: string; filename: string }
  | { ok: true; import: ImportSummary; bootstrap: Bootstrap }
  | { ok: true }
  | { ok: false; error: string };

export async function sendRequest<T extends ClientResponse>(msg: ClientRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(msg)) as T | undefined;
  if (!response) throw new Error("No response from Session Fortress.");
  return response;
}

export function toastSkipped(saved: number, skipped: number): string {
  if (skipped <= 0) return `Saved ${saved} tab${saved === 1 ? "" : "s"}.`;
  return `Saved ${saved} tab${saved === 1 ? "" : "s"}, skipped ${skipped} system page${skipped === 1 ? "" : "s"}.`;
}
