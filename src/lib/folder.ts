import { loadDirectoryHandle, saveDirectoryHandle } from "./idb";
import {
  LATEST_FILENAME,
  TMP_FILENAME,
  type FolderStatus,
  type FolderVault,
} from "./types";
import { datedBackupFilename, isDatedBackupName, isValidVaultShape } from "./util";
import { shouldRefuseEmptyOverwrite, vaultHasRestoreableContent } from "./mirrorGuard";

export async function pickBackupFolder(): Promise<{
  folderName: string;
  handle: FileSystemDirectoryHandle;
}> {
  const handle = await window.showDirectoryPicker({
    id: "session-fortress-backup",
    mode: "readwrite",
    startIn: "documents",
  });
  await saveDirectoryHandle(handle);
  return { folderName: handle.name, handle };
}

export async function queryFolderPermission(
  handle?: FileSystemDirectoryHandle,
): Promise<PermissionState | "missing"> {
  const dir = handle ?? (await loadDirectoryHandle());
  if (!dir) return "missing";
  if (typeof dir.queryPermission !== "function") return "granted";
  return dir.queryPermission({ mode: "readwrite" });
}

export async function requestFolderPermission(): Promise<PermissionState | "missing"> {
  const dir = await loadDirectoryHandle();
  if (!dir) return "missing";
  if (typeof dir.requestPermission !== "function") return "granted";
  return dir.requestPermission({ mode: "readwrite" });
}

export async function folderStatusFromHandle(): Promise<{
  status: FolderStatus;
  folderName: string | null;
}> {
  const handle = await loadDirectoryHandle();
  if (!handle) return { status: "no-folder", folderName: null };
  const perm = await queryFolderPermission(handle);
  if (perm === "granted") return { status: "ok", folderName: handle.name };
  if (perm === "prompt" || perm === "denied") {
    return { status: "permission-expired", folderName: handle.name };
  }
  return { status: "unknown", folderName: handle.name };
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, contents: string): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(contents);
  await writable.close();
}

async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  try {
    const file = await dir.getFileHandle(name);
    const blob = await file.getFile();
    return blob.text();
  } catch {
    return null;
  }
}

export async function readLatestVault(): Promise<{
  vault: FolderVault | null;
  error: string | null;
  permission: PermissionState | "missing";
}> {
  const handle = await loadDirectoryHandle();
  if (!handle) return { vault: null, error: null, permission: "missing" };
  const perm = await queryFolderPermission(handle);
  if (perm !== "granted") {
    return { vault: null, error: null, permission: perm };
  }
  const text = await readFile(handle, LATEST_FILENAME);
  if (!text) return { vault: null, error: "No latest backup file in that folder.", permission: perm };
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isValidVaultShape(parsed)) {
      return { vault: null, error: "Backup file is not a Session Fortress vault.", permission: perm };
    }
    return { vault: parsed, error: null, permission: perm };
  } catch {
    return { vault: null, error: "Backup file is not valid JSON.", permission: perm };
  }
}

export async function writeVaultToFolder(
  json: string,
  retention: number,
  allowEmpty: boolean,
): Promise<{ ok: boolean; error: string | null; exportedAt: number | null }> {
  const handle = await loadDirectoryHandle();
  if (!handle) return { ok: false, error: "No backup folder selected.", exportedAt: null };

  const perm = await queryFolderPermission(handle);
  if (perm !== "granted") {
    return { ok: false, error: "Folder permission expired.", exportedAt: null };
  }

  let parsed: FolderVault;
  try {
    parsed = JSON.parse(json) as FolderVault;
  } catch {
    return { ok: false, error: "Vault payload is not JSON.", exportedAt: null };
  }

  const incomingHasContent = vaultHasRestoreableContent(parsed.sessions);
  if (!allowEmpty && !incomingHasContent) {
    const existingText = await readFile(handle, LATEST_FILENAME);
    if (existingText) {
      try {
        const existing = JSON.parse(existingText) as FolderVault;
        if (
          shouldRefuseEmptyOverwrite({
            allowEmpty,
            incomingHasContent,
            existingHasContent: vaultHasRestoreableContent(existing.sessions),
          })
        ) {
          return {
            ok: false,
            error: "Refused to overwrite a non-empty backup with an empty vault.",
            exportedAt: existing.exportedAt ?? null,
          };
        }
      } catch {
        // Existing latest is unreadable; a write is acceptable.
      }
    }
  }

  const datedName = datedBackupFilename(new Date(parsed.exportedAt || Date.now()));

  try {
    await writeFile(handle, TMP_FILENAME, json);

    const tmpHandle = await handle.getFileHandle(TMP_FILENAME);
    if (typeof tmpHandle.move === "function") {
      await tmpHandle.move(LATEST_FILENAME);
    } else {
      await writeFile(handle, datedName, json);
      await writeFile(handle, LATEST_FILENAME, json);
      try {
        await handle.removeEntry(TMP_FILENAME);
      } catch {
        // Leave tmp if remove fails.
      }
    }

    if (typeof tmpHandle.move === "function") {
      await writeFile(handle, datedName, json);
    }

    await pruneDatedBackups(handle, retention);
    return { ok: true, error: null, exportedAt: parsed.exportedAt ?? Date.now() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Folder write failed.",
      exportedAt: null,
    };
  }
}

async function pruneDatedBackups(dir: FileSystemDirectoryHandle, retention: number): Promise<void> {
  const names: string[] = [];
  for await (const [name, entry] of dir.entries()) {
    if (entry.kind === "file" && isDatedBackupName(name)) names.push(name);
  }
  names.sort();
  const extra = names.length - retention;
  if (extra <= 0) return;
  for (const name of names.slice(0, extra)) {
    try {
      await dir.removeEntry(name);
    } catch {
      // Keep going.
    }
  }
}

export function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
