/** ZIP building in the browser (fflate) — for "download this project/folder". */
import { zip } from 'fflate';
import { blobToArrayBuffer } from './blob';

export async function zipBlobs(
  entries: { path: string; blob: Blob }[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Blob> {
  const data: Record<string, Uint8Array> = {};
  let done = 0;
  for (const entry of entries) {
    data[entry.path] = new Uint8Array(await blobToArrayBuffer(entry.blob));
    done += 1;
    onProgress?.(done, entries.length);
  }
  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(data, { level: 6 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
  return new Blob([zipped as unknown as BlobPart], { type: 'application/zip' });
}
