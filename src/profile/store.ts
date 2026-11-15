/** Player profile behind a tiny async storage interface, so tests can use a fake. No browser APIs here. */
import { INSTRUMENTS, type InstrumentId } from '../model/instrument';

/** The only thing the profile needs from a database: opaque JSON values by key. */
export interface KeyValueStorage {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Settings {
  /** Night-aquarium background effects (drift, colour cycling, wobble). */
  backgroundEffects: boolean;
  /** Calibrated total latency in seconds (input + output + habit). Absent until calibrated. */
  latencyOffset?: number;
  /** Metronome volume 0..1 (absent = default 0.6). */
  metronomeVolume?: number;
  /** Metronome on in timed games (absent = on). */
  metronomeOn?: boolean;
}

export interface Profile {
  version: 1;
  /** null until the player has picked one (first run). */
  instrument: InstrumentId | null;
  settings: Settings;
}

export const DEFAULT_PROFILE: Profile = { version: 1, instrument: null, settings: { backgroundEffects: true } };

const PROFILE_KEY = 'profile';
const progressKey = (id: InstrumentId) => `progress:${id}`;

/** Accepts whatever was stored and returns a valid profile (unknown or corrupt fields fall back to defaults). */
export function sanitizeProfile(raw: unknown): Profile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const s = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>;
  const instrument = typeof r.instrument === 'string' && r.instrument in INSTRUMENTS ? (r.instrument as InstrumentId) : null;
  const settings: Settings = {
    backgroundEffects: typeof s.backgroundEffects === 'boolean' ? s.backgroundEffects : DEFAULT_PROFILE.settings.backgroundEffects,
  };
  // Optional settings only appear when valid, so a fresh profile still equals DEFAULT_PROFILE.
  if (typeof s.latencyOffset === 'number' && Number.isFinite(s.latencyOffset) && Math.abs(s.latencyOffset) < 2) settings.latencyOffset = s.latencyOffset;
  if (typeof s.metronomeVolume === 'number' && Number.isFinite(s.metronomeVolume)) settings.metronomeVolume = Math.min(1, Math.max(0, s.metronomeVolume));
  if (typeof s.metronomeOn === 'boolean') settings.metronomeOn = s.metronomeOn;
  return { version: 1, instrument, settings };
}

export class ProfileStore {
  private current: Profile = structuredClone(DEFAULT_PROFILE);

  constructor(private readonly storage: KeyValueStorage) {}

  /** The profile as last loaded or saved; scenes read this synchronously after `load()`. */
  get profile(): Profile {
    return this.current;
  }

  async load(): Promise<Profile> {
    this.current = sanitizeProfile(await this.storage.get(PROFILE_KEY));
    return this.current;
  }

  async setInstrument(id: InstrumentId): Promise<void> {
    this.current = { ...this.current, instrument: id };
    await this.save();
  }

  async setSettings(patch: Partial<Settings>): Promise<void> {
    this.current = { ...this.current, settings: { ...this.current.settings, ...patch } };
    await this.save();
  }

  /** Per-instrument progress: an opaque JSON blob owned by the progress module. */
  async getProgress(id: InstrumentId): Promise<unknown | undefined> {
    return this.storage.get(progressKey(id));
  }

  async saveProgress(id: InstrumentId, blob: unknown): Promise<void> {
    await this.storage.set(progressKey(id), blob);
  }

  async clearProgress(id: InstrumentId): Promise<void> {
    await this.storage.delete(progressKey(id));
  }

  private async save(): Promise<void> {
    await this.storage.set(PROFILE_KEY, this.current);
  }
}
