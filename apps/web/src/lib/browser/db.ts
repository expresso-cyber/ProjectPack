/**
 * Local storage for Browser Mode: IndexedDB holds the project index and the
 * mirrored files (blobs). Nothing leaves the machine, and the data survives a
 * server restart because the server is not involved at all.
 */
import type { BrowserFile, BrowserProject } from './types';

const DB_NAME = 'projectpack-browser';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB — Browser Mode is unavailable here.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('files')) {
        const files = db.createObjectStore('files', { keyPath: 'id' });
        files.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the local database'));
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Local database request failed'));
  });
}

async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => Promise<T> | T,
): Promise<T> {
  const db = await openDb();
  try {
    const tx = db.transaction(store, mode);
    const result = await fn(tx.objectStore(store));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Local database transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Local database transaction aborted'));
    });
    return result;
  } finally {
    db.close();
  }
}

export function listProjects(): Promise<BrowserProject[]> {
  return withStore('projects', 'readonly', async (s) => {
    const all = await done(s.getAll() as IDBRequest<BrowserProject[]>);
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export function getProject(id: string): Promise<BrowserProject | undefined> {
  return withStore('projects', 'readonly', (s) =>
    done(s.get(id) as IDBRequest<BrowserProject | undefined>),
  );
}

export function putProject(project: BrowserProject): Promise<void> {
  return withStore('projects', 'readwrite', async (s) => {
    await done(s.put(project));
  });
}

export function deleteProject(id: string): Promise<void> {
  return withStore('files', 'readwrite', async (files) => {
    const keys = await done(files.index('projectId').getAllKeys(id) as IDBRequest<IDBValidKey[]>);
    for (const key of keys) await done(files.delete(key));
  }).then(() =>
    withStore('projects', 'readwrite', async (s) => {
      await done(s.delete(id));
    }),
  );
}

export function listFiles(projectId: string): Promise<BrowserFile[]> {
  return withStore('files', 'readonly', async (s) => {
    const all = await done(s.index('projectId').getAll(projectId) as IDBRequest<BrowserFile[]>);
    return all.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  });
}

export function getFile(id: string): Promise<BrowserFile | undefined> {
  return withStore('files', 'readonly', (s) => done(s.get(id) as IDBRequest<BrowserFile | undefined>));
}

/** Store files in chunks so a huge project does not open one giant transaction. */
export async function putFiles(files: BrowserFile[], chunkSize = 100): Promise<void> {
  for (let i = 0; i < files.length; i += chunkSize) {
    const chunk = files.slice(i, i + chunkSize);
    await withStore('files', 'readwrite', async (s) => {
      for (const file of chunk) await done(s.put(file));
    });
  }
}
