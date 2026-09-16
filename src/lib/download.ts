export async function downloadJsonFile(filename: string, json: string): Promise<number> {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    return await chrome.downloads.download({
      url,
      filename,
      saveAs: true,
    });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }
}
