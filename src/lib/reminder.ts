import { EXPORT_REMINDER_MS } from "./types";

export function isExportReminderDue(args: {
  remind: boolean;
  hasSessions: boolean;
  lastExportAt: number | null;
  lastSavedAt: number | null;
  lastExportReminderAt: number | null;
  now?: number;
}): boolean {
  if (!args.remind || !args.hasSessions) return false;
  const now = args.now ?? Date.now();
  const anchor = args.lastExportAt ?? args.lastSavedAt;
  if (anchor == null) return false;
  if (now - anchor < EXPORT_REMINDER_MS) return false;
  if (args.lastExportReminderAt != null && now - args.lastExportReminderAt < EXPORT_REMINDER_MS) {
    return false;
  }
  return true;
}
