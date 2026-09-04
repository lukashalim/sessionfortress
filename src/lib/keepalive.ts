export const KEEPALIVE_PERIODIC = "critical-keepalive";
export const KEEPALIVE_SOON = "critical-keepalive-soon";
export const KEEPALIVE_SOON_MS = 25_000;

export function isKeepaliveAlarmName(name: string): boolean {
  return name === KEEPALIVE_PERIODIC || name === KEEPALIVE_SOON;
}

export function applyKeepaliveBegin(depth: number): { depth: number; start: boolean } {
  return { depth: depth + 1, start: depth === 0 };
}

export function applyKeepaliveEnd(depth: number): { depth: number; stop: boolean } {
  if (depth <= 0) return { depth: 0, stop: false };
  const next = depth - 1;
  return { depth: next, stop: next === 0 };
}

let depth = 0;

export function keepaliveDepth(): number {
  return depth;
}

async function refreshSoonAlarm(): Promise<void> {
  await chrome.alarms.create(KEEPALIVE_SOON, { when: Date.now() + KEEPALIVE_SOON_MS });
}

async function startKeepaliveAlarms(): Promise<void> {
  await chrome.alarms.create(KEEPALIVE_PERIODIC, { periodInMinutes: 1 });
  await refreshSoonAlarm();
}

async function clearKeepaliveAlarms(): Promise<void> {
  await chrome.alarms.clear(KEEPALIVE_PERIODIC);
  await chrome.alarms.clear(KEEPALIVE_SOON);
}

export async function beginCriticalWork(): Promise<void> {
  const result = applyKeepaliveBegin(depth);
  depth = result.depth;
  if (!result.start) return;
  try {
    await startKeepaliveAlarms();
  } catch (error) {
    depth = applyKeepaliveEnd(depth).depth;
    throw error;
  }
}

export async function endCriticalWork(): Promise<void> {
  const result = applyKeepaliveEnd(depth);
  depth = result.depth;
  if (result.stop) {
    await clearKeepaliveAlarms();
  }
}

export async function withCriticalWork<T>(work: () => Promise<T>): Promise<T> {
  await beginCriticalWork();
  try {
    return await work();
  } finally {
    await endCriticalWork();
  }
}

export async function onKeepaliveTick(): Promise<void> {
  if (depth > 0) {
    await refreshSoonAlarm();
    return;
  }
  await clearKeepaliveAlarms();
}

export async function clearStaleKeepaliveAlarms(): Promise<void> {
  if (depth > 0) return;
  await clearKeepaliveAlarms();
}
