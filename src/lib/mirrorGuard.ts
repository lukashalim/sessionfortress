export function vaultHasRestoreableContent(sessions: unknown): boolean {
  if (!Array.isArray(sessions)) return false;
  return sessions.some((session) => {
    if (!session || typeof session !== "object") return false;
    const windows = (session as { windows?: unknown }).windows;
    if (!Array.isArray(windows)) return false;
    return windows.some((win) => {
      if (!win || typeof win !== "object") return false;
      const tabs = (win as { tabs?: unknown }).tabs;
      return Array.isArray(tabs) && tabs.length > 0;
    });
  });
}

export function computeAllowEmptyWrite(allowEmptyMirror: boolean, incomingHasContent: boolean): boolean {
  return allowEmptyMirror && !incomingHasContent;
}

export function shouldDisarmAllowEmptyMirror(
  allowEmptyMirror: boolean,
  incomingHasContent: boolean,
): boolean {
  return allowEmptyMirror && !incomingHasContent;
}

export function shouldRefuseEmptyOverwrite(args: {
  allowEmpty: boolean;
  incomingHasContent: boolean;
  existingHasContent: boolean;
}): boolean {
  return !args.allowEmpty && !args.incomingHasContent && args.existingHasContent;
}

export function nextAllowEmptyMirrorAfterAttempt(args: {
  allowEmptyMirror: boolean;
  incomingHasContent: boolean;
}): boolean {
  if (shouldDisarmAllowEmptyMirror(args.allowEmptyMirror, args.incomingHasContent)) return false;
  return args.allowEmptyMirror;
}
