import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../src/profile/memory';
import { DEFAULT_PROFILE, ProfileStore, sanitizeProfile } from '../src/profile/store';

describe('ProfileStore', () => {
  it('starts with no instrument and background effects on', async () => {
    const store = new ProfileStore(new MemoryStorage());
    expect(await store.load()).toEqual(DEFAULT_PROFILE);
  });

  it('persists the instrument and settings across loads', async () => {
    const storage = new MemoryStorage();
    const a = new ProfileStore(storage);
    await a.load();
    await a.setInstrument('bass5');
    await a.setSettings({ backgroundEffects: false });
    const b = new ProfileStore(storage);
    const p = await b.load();
    expect(p.instrument).toBe('bass5');
    expect(p.settings.backgroundEffects).toBe(false);
  });

  it('keeps progress separate per instrument', async () => {
    const store = new ProfileStore(new MemoryStorage());
    await store.load();
    await store.saveProgress('guitar', { stars: { pulse: 3 } });
    await store.saveProgress('bass4', { stars: {} });
    expect(await store.getProgress('guitar')).toEqual({ stars: { pulse: 3 } });
    expect(await store.getProgress('bass5')).toBeUndefined();
    await store.clearProgress('guitar');
    expect(await store.getProgress('guitar')).toBeUndefined();
    expect(await store.getProgress('bass4')).toEqual({ stars: {} });
  });

  it('does not alias stored values', async () => {
    const storage = new MemoryStorage();
    const store = new ProfileStore(storage);
    const blob = { n: 1 };
    await store.saveProgress('guitar', blob);
    blob.n = 2;
    expect(await store.getProgress('guitar')).toEqual({ n: 1 });
  });

  it('recovers from corrupt stored data', () => {
    expect(sanitizeProfile('basura')).toEqual(DEFAULT_PROFILE);
    expect(sanitizeProfile({ instrument: 'banjo', settings: { backgroundEffects: 'si' } })).toEqual(DEFAULT_PROFILE);
    expect(sanitizeProfile({ instrument: 'bass4', settings: { backgroundEffects: false } })).toEqual({
      version: 1,
      instrument: 'bass4',
      settings: { backgroundEffects: false },
    });
  });
});
