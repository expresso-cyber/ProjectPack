import { blobToArrayBuffer } from './blob';

/** SHA-256 via WebCrypto — the browser's own hashing, no server needed. */
export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let buffer: ArrayBuffer;
  if (data instanceof Blob) {
    buffer = await blobToArrayBuffer(data);
  } else if (data instanceof Uint8Array) {
    buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  } else {
    buffer = data;
  }
  // Copy into a fresh, plain ArrayBuffer-backed view: this both satisfies the
  // strict BufferSource type and avoids cross-realm ArrayBuffer rejections
  // (jsdom / workers hand back buffers from another realm).
  const source = data instanceof Uint8Array ? data : new Uint8Array(buffer);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
