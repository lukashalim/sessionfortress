import type { FolderVault } from "./types";

const REPLICA_DB = "session-fortress-hot";
const FOLDER_DB = "session-fortress-folder";
const STORE = "kv";
const REPLICA_KEY = "replica";
const HANDLE_KEY = "dirHandle";

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function idbGet<T>(dbName: string, key: string): Promise<T | undefined> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
    tx.oncomplete = () => db.close();
  });
}

async function idbSet<T>(dbName: string, key: string, value: T): Promise<void> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed"));
  });
}

async function idbDelete(dbName: string, key: string): Promise<void> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
}

export async function saveReplica(vault: FolderVault): Promise<void> {
  await idbSet(REPLICA_DB, REPLICA_KEY, vault);
}

export async function loadReplica(): Promise<FolderVault | undefined> {
  return idbGet<FolderVault>(REPLICA_DB, REPLICA_KEY);
}

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await idbSet(FOLDER_DB, HANDLE_KEY, handle);
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return idbGet<FileSystemDirectoryHandle>(FOLDER_DB, HANDLE_KEY);
}

export async function clearDirectoryHandle(): Promise<void> {
  await idbDelete(FOLDER_DB, HANDLE_KEY);
}
