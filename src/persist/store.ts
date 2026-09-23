/** Local profile persistence with explicit schema versioning and migration.
 *
 *  Everything a player earns lives here. The store is deliberately the only
 *  code that knows about localStorage, and it validates and repairs what it
 *  reads: a corrupt or half-written save loads as a fresh profile rather than
 *  crashing the game on boot.
 */
import { SCHEMA_VERSION, RULES_VERSION, divisionFor } from '../data/rules';
import { DEFAULT_LOADOUT, partById, type SlotId } from '../data/parts';
import { UNLOCK_EVERYTHING } from '../data/rules';
import { TRACKS } from '../data/tracks';
import { AXIES } from '../data/axies';
import { KARTS } from '../data/karts';
import { DEFAULT_MIX, type MixSettings } from '../audio/audio';
import type { LoadoutParts } from '../sim/loadout';

const KEY = 'lunaprix.profile.v3';
const LEGACY_KEYS = ['lunaprix.profile.v2', 'lunaprix.profile.v1'];

export interface LapRecord {
  trackId: string;
  rulesVersion: string;
  bestLap: number;
  bestTotal: number;
  axieId: string;
  kartId: string;
  at: number;
}

export interface BonusRecord {
  eventId: string;
  rulesVersion: string;
  best: number;
  medal: 'none' | 'bronze' | 'silver' | 'gold';
  attempts: number;
  at: number;
}

export interface Settings {
  mix: MixSettings;
  /** Reduced camera motion, speed lines and shake. */
  comfort: boolean;
  assists: { autoAccel: boolean; steerAssist: boolean; recoveryAssist: boolean };
  quality: 'low' | 'medium' | 'high' | 'auto';
  /** Hold to drift, or tap to toggle. */
  driftToggle: boolean;
  /** Flip left/right. Some people read a chase camera the other way round,
   *  and arguing with them about handedness is not a feature. */
  invertSteering: boolean;
  /** Colour-blind-safe palette for hazards and route cues. */
  highContrast: boolean;
  hudScale: number;
  steerSensitivity: number;
  deadzone: number;
  showTutorialPrompts: boolean;
  keybinds: Record<string, string>;
}

export interface Profile {
  schemaVersion: number;
  playerId: string;
  alias: string;
  coins: number;
  rating: number;
  races: number;
  wins: number;
  podiums: number;
  /** partId -> owned level. */
  owned: Record<string, number>;
  axieId: string;
  kartId: string;
  parts: Record<SlotId, { partId: string; level: number }>;
  unlockedTracks: string[];
  records: LapRecord[];
  bonus: BonusRecord[];
  settings: Settings;
  tutorialDone: boolean;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_KEYBINDS: Record<string, string> = {
  accelerate: 'KeyW',
  brake: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  drift: 'Space',
  boost: 'ShiftLeft',
  special: 'KeyE',
  item: 'KeyF',
  lookBack: 'KeyQ',
  reset: 'KeyR',
  pause: 'Escape',
};

function defaultParts(): Profile['parts'] {
  const out = {} as Profile['parts'];
  for (const k of Object.keys(DEFAULT_LOADOUT) as SlotId[]) out[k] = { partId: DEFAULT_LOADOUT[k], level: 1 };
  return out;
}

export function newProfile(): Profile {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    playerId: `p-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    alias: 'Rookie',
    coins: 0,
    rating: 1000,
    races: 0,
    wins: 0,
    podiums: 0,
    owned: Object.fromEntries(Object.values(DEFAULT_LOADOUT).map((id) => [id, 1])),
    axieId: AXIES[0].id,
    kartId: AXIES[0].defaultKart,   // Bing in the Dartwing
    parts: defaultParts(),
    unlockedTracks: ['canopy'],
    records: [],
    bonus: [],
    settings: {
      mix: { ...DEFAULT_MIX },
      comfort: false,
      assists: { autoAccel: false, steerAssist: false, recoveryAssist: true },
      quality: 'auto',
      driftToggle: false,
      invertSteering: false,
      highContrast: false,
      hudScale: 1,
      steerSensitivity: 1,
      deadzone: 0.12,
      showTutorialPrompts: true,
      keybinds: { ...DEFAULT_KEYBINDS },
    },
    tutorialDone: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Bring an older save forward. Each step is explicit and additive, so a
 *  profile from any shipped version keeps its coins and its records. */
function migrate(raw: Record<string, unknown>): Profile {
  const base = newProfile();
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  const p: Profile = { ...base, ...(raw as Partial<Profile>) } as Profile;

  if (v < 2) {
    // v1 had no bonus events and no assists block.
    p.bonus = [];
    p.settings = { ...base.settings, ...(p.settings ?? {}) };
  }
  if (v < 3) {
    // v2 stored parts as bare ids; v3 stores level with them.
    const legacy = raw.parts as Record<string, unknown> | undefined;
    if (legacy && typeof Object.values(legacy)[0] === 'string') {
      const fixed = defaultParts();
      for (const [slot, id] of Object.entries(legacy)) {
        if (typeof id === 'string') fixed[slot as SlotId] = { partId: id, level: 1 };
      }
      p.parts = fixed;
    }
  }
  p.schemaVersion = SCHEMA_VERSION;
  return p;
}

/** Repair anything that references content that no longer exists. A part that
 *  was removed in a balance pass must not brick a save. */
function validate(p: Profile): Profile {
  const base = newProfile();
  p.settings = {
    ...base.settings,
    ...p.settings,
    mix: { ...base.settings.mix, ...(p.settings?.mix ?? {}) },
    assists: { ...base.settings.assists, ...(p.settings?.assists ?? {}) },
    keybinds: { ...DEFAULT_KEYBINDS, ...(p.settings?.keybinds ?? {}) },
  };
  // A driver that no longer exists (Buba became Bing) resets the entry to
  // the default pairing: Bing in the Dartwing.
  if (!AXIES.some((a) => a.id === p.axieId)) { p.axieId = base.axieId; p.kartId = base.kartId; }
  if (!KARTS.some((k) => k.id === p.kartId)) p.kartId = base.kartId;
  const parts = defaultParts();
  for (const slot of Object.keys(parts) as SlotId[]) {
    const fitted = p.parts?.[slot];
    if (!fitted) continue;
    try {
      const def = partById(fitted.partId);
      if (def.slot === slot) {
        parts[slot] = { partId: fitted.partId, level: Math.max(1, Math.min(def.maxLevel, fitted.level | 0)) };
      }
    } catch { /* removed part: fall back to the stock item for that slot */ }
  }
  p.parts = parts;
  p.owned = p.owned ?? {};
  for (const id of Object.values(DEFAULT_LOADOUT)) p.owned[id] = Math.max(1, p.owned[id] ?? 1);
  for (const id of Object.keys(p.owned)) {
    try { partById(id); } catch { delete p.owned[id]; }
  }
  p.coins = Math.max(0, Math.floor(p.coins || 0));
  p.rating = Math.max(0, Math.floor(p.rating || 1000));
  p.records = Array.isArray(p.records) ? p.records.filter((r) => r && typeof r.trackId === 'string') : [];
  p.bonus = Array.isArray(p.bonus) ? p.bonus.filter((r) => r && typeof r.eventId === 'string') : [];
  p.unlockedTracks = Array.isArray(p.unlockedTracks) && p.unlockedTracks.length ? p.unlockedTracks : ['canopy'];
  // Binds added after a profile was saved get their defaults.
  if (p.settings && p.settings.keybinds) for (const [k, v] of Object.entries(DEFAULT_KEYBINDS)) if (!p.settings.keybinds[k]) p.settings.keybinds[k] = v;
  // The review build opens everything, including profiles saved before it.
  if (UNLOCK_EVERYTHING) for (const t of TRACKS) if (!p.unlockedTracks.includes(t.id)) p.unlockedTracks.push(t.id);
  return p;
}

export function loadProfile(): Profile {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      for (const k of LEGACY_KEYS) {
        const legacy = localStorage.getItem(k);
        if (legacy) { raw = legacy; break; }
      }
    }
    if (!raw) return newProfile();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return validate(migrate(parsed));
  } catch {
    // A corrupt save is not worth crashing over; start clean.
    return newProfile();
  }
}

export function saveProfile(p: Profile): void {
  try {
    p.updatedAt = Date.now();
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* storage full or blocked: the session still plays */ }
}

export function resetProfile(): Profile {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return newProfile();
}

// ---- helpers ---------------------------------------------------------------

export function toLoadoutParts(p: Profile): LoadoutParts {
  return p.parts as LoadoutParts;
}

export function ownedLevel(p: Profile, partId: string): number {
  return p.owned[partId] ?? 0;
}

export function recordFor(p: Profile, trackId: string): LapRecord | undefined {
  return p.records.find((r) => r.trackId === trackId && r.rulesVersion === RULES_VERSION);
}

/** Store a lap/total if it beats what is there. Returns what improved. */
export function submitRecord(
  p: Profile, trackId: string, bestLap: number, total: number, axieId: string, kartId: string,
): { lap: boolean; total: boolean } {
  let rec = p.records.find((r) => r.trackId === trackId && r.rulesVersion === RULES_VERSION);
  if (!rec) {
    // 0 means "nothing set yet". Infinity survives in memory but JSON.stringify
    // writes it as null, and `41.2 < null` is false, so that track's best lap
    // could never be set again.
    rec = { trackId, rulesVersion: RULES_VERSION, bestLap: 0, bestTotal: 0, axieId, kartId, at: Date.now() };
    p.records.push(rec);
  }
  const unset = (v: number) => !(v > 0) || !isFinite(v);
  const out = { lap: false, total: false };
  if (bestLap > 0 && (unset(rec.bestLap) || bestLap < rec.bestLap)) { rec.bestLap = bestLap; rec.axieId = axieId; rec.kartId = kartId; out.lap = true; }
  if (total > 0 && (unset(rec.bestTotal) || total < rec.bestTotal)) { rec.bestTotal = total; out.total = true; }
  if (out.lap || out.total) rec.at = Date.now();
  return out;
}

export function bonusFor(p: Profile, eventId: string): BonusRecord | undefined {
  return p.bonus.find((b) => b.eventId === eventId && b.rulesVersion === RULES_VERSION);
}

export function submitBonus(
  p: Profile, eventId: string, score: number, medal: BonusRecord['medal'], higherIsBetter: boolean,
): boolean {
  let rec = p.bonus.find((b) => b.eventId === eventId && b.rulesVersion === RULES_VERSION);
  if (!rec) {
    rec = { eventId, rulesVersion: RULES_VERSION, best: higherIsBetter ? -Infinity : Infinity, medal: 'none', attempts: 0, at: Date.now() };
    p.bonus.push(rec);
  }
  rec.attempts++;
  const better = higherIsBetter ? score > rec.best : score < rec.best;
  if (better) {
    rec.best = score;
    rec.at = Date.now();
    const order = ['none', 'bronze', 'silver', 'gold'];
    if (order.indexOf(medal) > order.indexOf(rec.medal)) rec.medal = medal;
  }
  return better;
}

export function divisionName(p: Profile): string {
  return divisionFor(p.rating).name;
}
