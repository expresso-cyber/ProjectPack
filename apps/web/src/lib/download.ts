/**
 * Downloads a file via fetch → blob → object URL so the caller knows exactly
 * when the transfer finished (used to fire the "download complete" snackbar).
 * Falls back to the server's Content-Disposition filename when present.
 */

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header) ?? /filename="?([^";]+)"?/i.exec(header);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function downloadFromUrl(url: string, fallbackName: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const name = filenameFromDisposition(response.headers.get('content-disposition')) ?? fallbackName;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  return name;
}

/** Downloads text content directly (no server round-trip), e.g. a generated prompt. */
export function downloadText(text: string, fileName: string, mimeType = 'text/plain'): string {
  const blob = new Blob([text], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
  return fileName;
}
