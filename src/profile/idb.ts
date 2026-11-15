/** IndexedDB implementation of the profile storage. The only file in profile/ that touches the browser. */
import { MemoryStorage } from './memory';
import type { KeyValueStorage } from './store';

const DB_NAME = 'metalforge';
const STORE = 'kv';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IdbStorage implements KeyValueStorage {
  private constructor(private readonly db: IDBDatabase) {}

  static async create(): Promise<IdbStorage> {
    return new IdbStorage(await open());
  }

  get(key: string): Promise<unknown | undefined> {
    return request(this.db, 'readonly', (s) => s.get(key));
  }
  async set(key: string, value: unknown): Promise<void> {
    await request(this.db, 'readwrite', (s) => s.put(value, key));
  }
  async delete(key: string): Promise<void> {
    await request(this.db, 'readwrite', (s) => s.delete(key));
  }
}

/** IndexedDB when it works; otherwise memory (private windows can refuse it), so the game still runs. */
export async function openStorage(): Promise<KeyValueStorage> {
  try {
    return await IdbStorage.create();
  } catch {
    return new MemoryStorage();
  }
}
