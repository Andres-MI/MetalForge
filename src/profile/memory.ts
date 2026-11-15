import type { KeyValueStorage } from './store';

/** Storage in memory: the fake used by tests, and the fallback when IndexedDB is unavailable. */
export class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, unknown>();

  async get(key: string): Promise<unknown | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : structuredClone(v);
  }
  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}
